import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { network } from './network';

const db = new PrismaClient();
const app = express();
const SECRET = process.env.SESSION_SECRET || 'dev-only-change-me';
const SIM = process.env.PAYMENT_MODE === 'simulator';
const PORT = Number(process.env.PORT || 3000);

app.use(helmet({ contentSecurityPolicy: { directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), 'upgrade-insecure-requests': null } } }));
app.use(express.json({ limit: '10kb' }));

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const sign = (v: string) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const genCode = () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c = ''; for (const b of crypto.randomBytes(10)) c += A[b % 32]; return c.slice(0, 5) + '-' + c.slice(5); };
const audit = (actor: string, action: string, meta: object = {}) => db.auditLog.create({ data: { actor, action, meta: JSON.stringify(meta) } });
const h = (fn: (q: Request, s: Response) => Promise<any>) => (q: Request, s: Response, n: NextFunction) => fn(q, s).catch(n);
const intIn = (v: any, min: number, max: number) => Number.isInteger(v) && v >= min && v <= max;

function adminId(req: Request): number | null {
  const m = /(?:^|; )mz=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const [id, exp, sig] = m[1].split('.');
  if (!sig || sig.length !== 64) return null;
  const ok = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(`${id}.${exp}`)));
  return ok && Date.now() < Number(exp) ? Number(id) : null;
}
const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  const id = adminId(req);
  if (!id) return res.status(401).json({ error: 'Please sign in' });
  res.locals.admin = `admin:${id}`;
  next();
};
const loginLimit = rateLimit({ windowMs: 15 * 60e3, limit: 10, message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' } });
const redeemLimit = rateLimit({ windowMs: 10 * 60e3, limit: 20, message: { error: 'Too many voucher attempts. Wait a few minutes.' } });
const orderLimit = rateLimit({ windowMs: 10 * 60e3, limit: 30, message: { error: 'Too many requests. Wait a few minutes.' } });

app.get('/api/config', (_q, s) => { s.json({ simulator: SIM }); });
app.get('/api/packages', h(async (_q, s) => {
  s.json(await db.package.findMany({ where: { isActive: true }, orderBy: { priceTzs: 'asc' } }));
}));

app.post('/api/orders', orderLimit, h(async (q, s) => {
  const phone = String(q.body.phone || '').replace(/\s/g, '');
  if (!/^(\+?255|0)[67]\d{8}$/.test(phone)) return s.status(400).json({ error: 'Enter a valid Tanzanian phone number, e.g. 0712 345 678' });
  const pkg = await db.package.findFirst({ where: { id: Number(q.body.packageId), isActive: true } });
  if (!pkg) return s.status(404).json({ error: 'Package not available' });
  const order = await db.order.create({ data: {
    phone, packageId: pkg.id, priceTzsSnapshot: pkg.priceTzs, status: 'PENDING',
    payment: { create: { internalReference: 'MZ-' + crypto.randomBytes(6).toString('hex').toUpperCase(), amountTzs: pkg.priceTzs, status: 'PENDING' } },
  }, include: { payment: true } });
  s.json({ paymentId: order.payment!.id, reference: order.payment!.internalReference, amountTzs: pkg.priceTzs });
}));

app.get('/api/payments/:id', h(async (q, s) => {
  const p = await db.payment.findUnique({ where: { id: Number(q.params.id) } });
  if (!p) return s.status(404).json({ error: 'Payment not found' });
  s.json({ status: p.status, reference: p.internalReference });
}));

// DEV ONLY: stands in for the provider webhook. Disabled unless PAYMENT_MODE=simulator.
app.post('/api/dev/pay/:id', h(async (q, s) => {
  if (!SIM) return s.status(404).json({ error: 'Not found' });
  const outcome = q.body.outcome === 'fail' ? 'FAILED' : 'SUCCEEDED';
  const id = Number(q.params.id);
  const r = await db.$transaction(async (tx): Promise<any> => {
    const p = await tx.payment.findUnique({ where: { id }, include: { order: true } });
    if (!p) return { c: 404, body: { error: 'Payment not found' } };
    const claim = await tx.payment.updateMany({ where: { id, status: 'PENDING' }, data: { status: outcome, verifiedAt: new Date(), providerReference: 'SIM-' + p.internalReference } });
    if (claim.count === 0) return { c: 200, body: { status: p.status, duplicate: true } };
    if (outcome === 'FAILED') { await tx.order.update({ where: { id: p.orderId }, data: { status: 'FAILED' } }); return { c: 200, body: { status: 'FAILED' } }; }
    if (p.amountTzs !== p.order.priceTzsSnapshot) throw new Error('Amount mismatch');
    const code = genCode();
    await tx.order.update({ where: { id: p.orderId }, data: { status: 'PAID' } });
    await tx.voucher.create({ data: { codeHash: sha(code), packageId: p.order.packageId, orderId: p.orderId } });
    return { c: 200, body: { status: 'SUCCEEDED', code } };
  });
  if (r.body.code) await audit('system', 'payment.succeeded', { paymentId: id });
  s.status(r.c).json(r.body);
}));

app.post('/api/vouchers/redeem', redeemLimit, h(async (q, s) => {
  const code = String(q.body.code || '').trim().toUpperCase();
  const deviceId = String(q.body.deviceId || '').slice(0, 64);
  if (!/^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(code) || !deviceId) return s.status(400).json({ error: 'Enter the voucher code in the format XXXXX-XXXXX' });
  const out = await db.$transaction(async (tx): Promise<any> => {
    const v = await tx.voucher.findUnique({ where: { codeHash: sha(code) }, include: { package: true } });
    if (!v) return { c: 404, error: 'Voucher not found' };
    if (v.status === 'REVOKED') return { c: 403, error: 'This voucher was revoked' };
    const now = new Date();
    if (v.status === 'REDEEMED') {
      if (v.expiresAt && v.expiresAt <= now) { await tx.voucher.update({ where: { id: v.id }, data: { status: 'EXPIRED' } }); return { c: 403, error: 'This voucher has expired' }; }
      const active = await tx.session.findMany({ where: { voucherId: v.id, status: 'ACTIVE' } });
      const mine = active.find((x) => x.deviceId === deviceId);
      if (mine) return { session: mine };
      if (active.length >= v.package.maxDevices) return { c: 403, error: 'Device limit reached for this voucher' };
      return { session: await tx.session.create({ data: { voucherId: v.id, deviceId, expiresAt: v.expiresAt! } }), fresh: true };
    }
    if (v.status !== 'AVAILABLE') return { c: 403, error: 'This voucher has expired' };
    const exp = new Date(now.getTime() + v.package.durationSeconds * 1000);
    const claim = await tx.voucher.updateMany({ where: { id: v.id, status: 'AVAILABLE' }, data: { status: 'REDEEMED', redeemedAt: now, expiresAt: exp } });
    if (claim.count === 0) return { c: 409, error: 'Voucher is being redeemed. Try again.' };
    return { session: await tx.session.create({ data: { voucherId: v.id, deviceId, expiresAt: exp } }), fresh: true };
  });
  if (out.error) return s.status(out.c).json({ error: out.error });
  if (out.fresh) { await network.authorize({ deviceId, expiresAt: out.session.expiresAt }); await audit('customer', 'session.started', { sessionId: out.session.id }); }
  s.json({ expiresAt: out.session.expiresAt });
}));

app.get('/api/sessions/me', h(async (q, s) => {
  const sess = await db.session.findFirst({ where: { deviceId: String(q.query.deviceId || ''), status: 'ACTIVE', expiresAt: { gt: new Date() } }, orderBy: { id: 'desc' } });
  s.json(sess ? { active: true, expiresAt: sess.expiresAt } : { active: false });
}));

app.post('/api/admin/login', loginLimit, h(async (q, s) => {
  const u = await db.adminUser.findUnique({ where: { email: String(q.body.email || '').toLowerCase() } });
  if (!u || !(await bcrypt.compare(String(q.body.password || ''), u.passwordHash))) return s.status(401).json({ error: 'Wrong email or password' });
  const p = `${u.id}.${Date.now() + 8 * 3600e3}`;
  s.setHeader('Set-Cookie', `mz=${p}.${sign(p)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
  await audit(`admin:${u.id}`, 'admin.login');
  s.json({ ok: true });
}));
app.post('/api/admin/logout', (_q, s) => { s.setHeader('Set-Cookie', 'mz=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); s.json({ ok: true }); });

const admin = express.Router();
admin.use(requireAdmin);
admin.get('/dashboard', h(async (_q, s) => {
  const now = new Date();
  const [rev, paid, pending, failed, active, avail] = await Promise.all([
    db.payment.aggregate({ where: { status: 'SUCCEEDED' }, _sum: { amountTzs: true } }),
    db.payment.count({ where: { status: 'SUCCEEDED' } }), db.payment.count({ where: { status: 'PENDING' } }), db.payment.count({ where: { status: 'FAILED' } }),
    db.session.count({ where: { status: 'ACTIVE', expiresAt: { gt: now } } }), db.voucher.count({ where: { status: 'AVAILABLE' } }),
  ]);
  s.json({ revenueTzs: rev._sum.amountTzs || 0, paid, pending, failed, activeSessions: active, availableVouchers: avail, controller: network.name, enforcing: network.enforcing });
}));
admin.get('/packages', h(async (_q, s) => { s.json(await db.package.findMany({ orderBy: { priceTzs: 'asc' } })); }));
admin.post('/packages', h(async (q, s) => {
  const b = q.body;
  if (!b.name || !intIn(b.priceTzs, 0, 1e7) || !intIn(b.durationSeconds, 60, 31536000) || !intIn(b.maxDevices ?? 1, 1, 10)) return s.status(400).json({ error: 'Check name, price, duration (min 60s) and devices (1-10)' });
  if (b.priceTzs === 0 && b.allowFree !== true) return s.status(400).json({ error: 'Free packages must be enabled explicitly' });
  const p = await db.package.create({ data: { name: String(b.name).slice(0, 60), description: String(b.description || '').slice(0, 120), priceTzs: b.priceTzs, durationSeconds: b.durationSeconds, maxDevices: b.maxDevices ?? 1 } });
  await audit(s.locals.admin, 'package.create', { id: p.id }); s.json(p);
}));
admin.patch('/packages/:id', h(async (q, s) => {
  const data: any = {};
  if (typeof q.body.isActive === 'boolean') data.isActive = q.body.isActive;
  if (intIn(q.body.priceTzs, 1, 1e7)) data.priceTzs = q.body.priceTzs;
  const p = await db.package.update({ where: { id: Number(q.params.id) }, data });
  await audit(s.locals.admin, 'package.update', { id: p.id, ...data }); s.json(p);
}));
admin.get('/payments', h(async (_q, s) => { s.json(await db.payment.findMany({ include: { order: { include: { package: true } } }, orderBy: { id: 'desc' }, take: 200 })); }));
admin.get('/vouchers', h(async (_q, s) => { s.json(await db.voucher.findMany({ include: { package: true }, orderBy: { id: 'desc' }, take: 200 })); }));
admin.post('/vouchers', h(async (q, s) => {
  const pkg = await db.package.findUnique({ where: { id: Number(q.body.packageId) } });
  if (!pkg) return s.status(404).json({ error: 'Package not found' });
  const code = genCode();
  const v = await db.voucher.create({ data: { codeHash: sha(code), packageId: pkg.id } });
  await audit(s.locals.admin, 'voucher.issue', { id: v.id, free: true }); s.json({ code });
}));
async function endSessions(where: any) {
  const list = await db.session.findMany({ where: { ...where, status: 'ACTIVE' } });
  for (const x of list) { await db.session.update({ where: { id: x.id }, data: { status: 'ENDED' } }); await network.revoke(x.deviceId); }
  return list.length;
}
admin.post('/vouchers/:id/revoke', h(async (q, s) => {
  const id = Number(q.params.id);
  await db.voucher.update({ where: { id }, data: { status: 'REVOKED' } });
  const n = await endSessions({ voucherId: id });
  await audit(s.locals.admin, 'voucher.revoke', { id, sessionsEnded: n }); s.json({ ok: true });
}));
admin.get('/sessions', h(async (_q, s) => { s.json(await db.session.findMany({ orderBy: { id: 'desc' }, take: 200 })); }));
admin.post('/sessions/:id/disconnect', h(async (q, s) => {
  await endSessions({ id: Number(q.params.id) });
  await audit(s.locals.admin, 'session.disconnect', { id: Number(q.params.id) }); s.json({ ok: true });
}));
admin.get('/audit', h(async (_q, s) => { s.json(await db.auditLog.findMany({ orderBy: { id: 'desc' }, take: 200 })); }));
app.use('/api/admin', admin);

setInterval(() => { endSessions({ expiresAt: { lte: new Date() } }).catch((e) => console.error('expiry job', e)); }, 30_000);

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use((e: any, _q: Request, s: Response, _n: NextFunction) => { console.error(e); s.status(500).json({ error: 'Something went wrong' }); });
app.listen(PORT, () => console.log(`Mizizi Wi-Fi: http://localhost:${PORT}  (admin: /admin.html, payments: ${SIM ? 'SIMULATOR' : 'live'})`));
