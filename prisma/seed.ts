import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
const db = new PrismaClient();
(async () => {
  const email = process.env.ADMIN_EMAIL || 'admin@mizizi.local';
  const pw = process.env.ADMIN_PASSWORD || 'ChangeMe!2026';
  await db.adminUser.upsert({ where: { email }, update: {}, create: { email, passwordHash: await bcrypt.hash(pw, 12) } });
  if (!(await db.package.count())) {
    await db.package.createMany({ data: [
      { name: 'Quick access', description: '1 hour online', priceTzs: 500, durationSeconds: 3600 },
      { name: 'Daily access', description: '24 hours online', priceTzs: 1000, durationSeconds: 86400 },
      { name: 'Weekly access', description: '7 days, 2 devices', priceTzs: 5000, durationSeconds: 604800, maxDevices: 2 },
    ] });
  }
  console.log('Seeded. Admin login:', email);
})().finally(() => db.$disconnect());
