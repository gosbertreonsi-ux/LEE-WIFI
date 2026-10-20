
const $ = (selector) => document.querySelector(selector);

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);

const money = (value) => Number(value || 0).toLocaleString('en-TZ');
const when = (value) => value ? new Date(value).toLocaleString() : '—';

const api = async (url, options = {}) => {
  const response = await fetch(url, {
    method: options.method || 'GET',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body === undefined
      ? undefined
      : JSON.stringify(options.body),
  });

  const result = await response.json().catch(() => ({}));

  if (response.status === 401 && !url.includes('/login')) {
    gate();
    throw new Error('Your session has expired. Please sign in again.');
  }

  if (!response.ok) {
    throw new Error(result.error || `Request failed (${response.status})`);
  }

  return result;
};

const note = (message, success = false) =>
  `<div class="msg${success ? ' ok' : ''}" role="status">${esc(message)}</div>`;

const pill = (status) => {
  const good = ['SUCCEEDED', 'ACTIVE', 'AVAILABLE', 'PAID'];
  const bad = ['FAILED', 'REVOKED', 'ENDED', 'EXPIRED', 'OFF'];

  const className = good.includes(status)
    ? 'good'
    : bad.includes(status)
      ? 'bad'
      : '';

  return `<span class="pill ${className}">${esc(status)}</span>`;
};

const table = (rows, columns) => {
  if (!rows.length) {
    return '<div class="empty-state"><strong>No records yet</strong><p class="muted">Records will appear here when available.</p></div>';
  }

  return `
    <div class="scroll admin-table-wrap">
      <table class="admin-table">
        <thead>
          <tr>${columns.map((column) => `<th>${column[0]}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              ${columns.map((column) => `<td>${column[1](row)}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
};

const statCard = (label, value, detail = '') => `
  <div class="card admin-stat">
    <p class="muted">${esc(label)}</p>
    <div class="stat">${esc(value)}</div>
    ${detail ? `<p class="stat-detail">${esc(detail)}</p>` : ''}
  </div>
`;

const formField = (label, id, type = 'text', extra = '') => `
  <div class="admin-field">
    <label for="${id}">${label}</label>
    <input id="${id}" type="${type}" ${extra}>
  </div>
`;

const tabs = {
  async Dashboard() {
    const data = await api('/api/admin/dashboard');

    const networkNotice = data.enforcing
      ? note(`Controller reports enforcement enabled: ${data.controller}. Verify actual traffic control independently.`, true)
      : note(`Network controller: ${data.controller || 'Unknown'}. Real internet traffic is NOT being blocked or allowed by the current mock controller.`);

    return `
      ${networkNotice}
      <div class="admin-stats">
        ${statCard('Confirmed revenue', `${money(data.revenueTzs)} TZS`, 'Reported by the application')}
        ${statCard('Successful payments', data.paid)}
        ${statCard('Pending payments', data.pending)}
        ${statCard('Failed payments', data.failed)}
        ${statCard('Active session records', data.activeSessions)}
        ${statCard('Available vouchers', data.availableVouchers)}
      </div>
      <div class="card admin-info-card">
        <p class="eyebrow">SYSTEM STATUS</p>
        <h3>Development progress</h3>
        <p class="muted">
          The dashboard and voucher records are managed by your backend.
          Live mobile-money collection and real network enforcement must be
          configured before this system is ready for paying customers.
        </p>
      </div>
    `;
  },

  async Packages() {
    const packages = await api('/api/admin/packages');

    return `
      <div class="admin-section-intro">
        <div>
          <h3>Internet packages</h3>
          <p class="muted">Set the price, duration and device limit for each offer.</p>
        </div>
      </div>

      ${table(packages, [
        ['Package', (item) => `<strong>${esc(item.name)}</strong><br><span class="muted">${esc(item.description || '')}</span>`],
        ['Price', (item) => `${money(item.priceTzs)} TZS`],
        ['Duration', (item) => `${Math.round(item.durationSeconds / 60)} min`],
        ['Devices', (item) => esc(item.maxDevices)],
        ['Status', (item) => pill(item.isActive ? 'ACTIVE' : 'OFF')],
        ['Action', (item) => `
          <button class="btn ghost small-btn" data-act="pkg"
            data-id="${Number(item.id)}"
            data-on="${Boolean(item.isActive)}">
            ${item.isActive ? 'Deactivate' : 'Activate'}
          </button>
        `],
      ])}

      <form class="card admin-form" id="packageForm">
        <p class="eyebrow">CREATE AN OFFER</p>
        <h3>Add a package</h3>
        <div class="admin-form-grid">
          ${formField('Package name', 'pn', 'text', 'required maxlength="80"')}
          ${formField('Price (TZS)', 'pp', 'number', 'required min="1" step="1"')}
          ${formField('Duration (minutes)', 'pd', 'number', 'required min="1" step="1"')}
          ${formField('Maximum devices', 'px', 'number', 'required min="1" max="100" step="1" value="1"')}
        </div>
        <button class="btn" type="submit">Save package →</button>
        <div id="packageMsg" aria-live="polite"></div>
      </form>
    `;
  },

  async Payments() {
    const payments = await api('/api/admin/payments');

    return `
      <div class="admin-section-intro">
        <div>
          <h3>Payment records</h3>
          <p class="muted">Review payment status and order references.</p>
        </div>
        <span class="pill">${payments.length} records</span>
      </div>
      ${table(payments, [
        ['Reference', (item) => `<code>${esc(item.internalReference)}</code>`],
        ['Phone', (item) => esc(item.order?.phone || '—')],
        ['Package', (item) => esc(item.order?.package?.name || '—')],
        ['Amount', (item) => `${money(item.amountTzs)} TZS`],
        ['Status', (item) => pill(item.status)],
        ['Created', (item) => esc(when(item.createdAt))],
      ])}
      <p class="muted admin-footnote">
        Successful simulator payments are development records, not proof of a real mobile-money transaction.
      </p>
    `;
  },

  async Vouchers() {
    const [vouchers, packages] = await Promise.all([
      api('/api/admin/vouchers'),
      api('/api/admin/packages'),
    ]);

    const activePackages = packages.filter((item) => item.isActive);

    return `
      <form class="card admin-form" id="voucherForm">
        <p class="eyebrow">MANUAL ISSUE</p>
        <h3>Create a voucher</h3>
        <p class="muted">
          This creates an application voucher. It does not itself authorize real network traffic.
        </p>
        ${
          activePackages.length
            ? `
              <label for="vp">Choose a package</label>
              <select id="vp" required>
                ${activePackages.map((item) =>
                  `<option value="${Number(item.id)}">${esc(item.name)} — ${money(item.priceTzs)} TZS</option>`
                ).join('')}
              </select>
              <button class="btn" type="submit">Create voucher →</button>
            `
            : '<p class="muted">Activate a package before issuing vouchers.</p>'
        }
        <div id="voucherMsg" aria-live="polite"></div>
      </form>

      <div class="admin-section-intro">
        <div>
          <h3>Voucher inventory</h3>
          <p class="muted">Newly issued codes are shown only when created.</p>
        </div>
        <span class="pill">${vouchers.length} records</span>
      </div>

      ${table(vouchers, [
        ['ID', (item) => esc(item.id)],
        ['Package', (item) => esc(item.package?.name || '—')],
        ['Status', (item) => pill(item.status)],
        ['Expiry', (item) => esc(when(item.expiresAt))],
        ['Created', (item) => esc(when(item.createdAt))],
        ['Action', (item) => ['REVOKED', 'EXPIRED'].includes(item.status)
          ? '—'
          : `<button class="btn ghost small-btn" data-act="revoke" data-id="${Number(item.id)}">Revoke</button>`],
      ])}
    `;
  },

  async Sessions() {
    const sessions = await api('/api/admin/sessions');

    return `
      <div class="admin-section-intro">
        <div>
          <h3>Customer sessions</h3>
          <p class="muted">Application session records and their expiry times.</p>
        </div>
        <span class="pill">${sessions.length} records</span>
      </div>

      ${table(sessions, [
        ['Session', (item) => `#${esc(item.id)}`],
        ['Device reference', (item) => `<code>${esc(String(item.deviceId || '').slice(0, 12))}</code>`],
        ['Started', (item) => esc(when(item.startedAt))],
        ['Expires', (item) => esc(when(item.expiresAt))],
        ['Status', (item) => pill(item.status)],
        ['Action', (item) => item.status === 'ACTIVE'
          ? `<button class="btn ghost small-btn" data-act="kick" data-id="${Number(item.id)}">End session</button>`
          : '—'],
      ])}

      <p class="muted admin-footnote">
        Ending a record does not disconnect real internet traffic unless an enforcing network controller is configured.
      </p>
    `;
  },

  async Audit() {
    const entries = await api('/api/admin/audit');

    return `
      <div class="admin-section-intro">
        <div>
          <h3>Audit log</h3>
          <p class="muted">Recorded administrative and system activity.</p>
        </div>
      </div>
      ${table(entries, [
        ['Time', (item) => esc(when(item.createdAt))],
        ['Actor', (item) => esc(item.actor)],
        ['Action', (item) => esc(item.action)],
        ['Details', (item) => `<code class="audit-meta">${esc(item.meta)}</code>`],
      ])}
    `;
  },
};

let currentTab = 'Dashboard';
let isRendering = false;
let isSubmitting = false;

function gate(message = '') {
  $('#app').hidden = true;
  $('#out').hidden = true;
  $('#login').hidden = false;
  $('#adminIdentity').textContent = '';
  $('#pw').value = '';

  if (message) {
    $('#lMsg').innerHTML = note(message);
  }
}

async function render(tabName = currentTab) {
  if (isRendering) return;

  currentTab = tabs[tabName] ? tabName : 'Dashboard';
  isRendering = true;

  $('#pageTitle').textContent = currentTab;
  $('#tabs').innerHTML = Object.keys(tabs).map((name) => `
    <button type="button"
      class="${name === currentTab ? 'on' : ''}"
      aria-current="${name === currentTab ? 'page' : 'false'}"
      data-tab="${name}">
      ${name}
    </button>
  `).join('');

  $('#view').innerHTML = '<div class="loading-card">Loading section…</div>';
  $('#globalMsg').replaceChildren();

  try {
    $('#view').innerHTML = await tabs[currentTab]();
  } catch (error) {
    $('#view').innerHTML = note(error.message);
  } finally {
    isRendering = false;
  }
}

const loginForm = $('#loginForm');

if (loginForm) loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (isSubmitting) return;

  const button = $('#in');
  const original = button.textContent;
  isSubmitting = true;
  button.disabled = true;
  button.textContent = 'Signing in…';
  $('#lMsg').replaceChildren();

  try {
    await api('/api/admin/login', {
      method: 'POST',
      body: {
        email: $('#em').value.trim(),
        password: $('#pw').value,
      },
    });

    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#out').hidden = false;
    $('#adminIdentity').textContent = 'Administrator';
    $('#pw').value = '';

    await render('Dashboard');
  } catch (error) {
    $('#lMsg').innerHTML = note(error.message);
  } finally {
    isSubmitting = false;
    button.disabled = false;
    button.textContent = original;
  }
});

$('#out').addEventListener('click', async () => {
  const button = $('#out');
  button.disabled = true;

  try {
    await api('/api/admin/logout', { method: 'POST' });
    gate('You have signed out.');
  } catch (error) {
    $('#globalMsg').innerHTML = note(error.message);
  } finally {
    button.disabled = false;
  }
});

$('#refresh').addEventListener('click', async () => {
  const button = $('#refresh');
  const original = button.textContent;

  button.disabled = true;
  button.textContent = 'Refreshing…';

  try {
    await render();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
});

document.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button || isSubmitting) return;

  if (button.dataset.tab) {
    await render(button.dataset.tab);
    return;
  }

  const action = button.dataset.act;
  if (!action) return;

  const id = Number(button.dataset.id);
  if (!Number.isInteger(id) || id < 1) return;

  isSubmitting = true;
  button.disabled = true;

  try {
    if (action === 'pkg') {
      const activate = button.dataset.on !== 'true';

      await api(`/api/admin/packages/${id}`, {
        method: 'PATCH',
        body: { isActive: activate },
      });

      $('#globalMsg').innerHTML = note(
        `Package ${activate ? 'activated' : 'deactivated'}.`,
        true
      );

      await render('Packages');
    }

    if (action === 'revoke') {
      if (!confirm('Revoke this voucher and end its recorded sessions?')) return;

      await api(`/api/admin/vouchers/${id}/revoke`, {
        method: 'POST',
      });

      $('#globalMsg').innerHTML = note('Voucher revoked.', true);
      await render('Vouchers');
    }

    if (action === 'kick') {
      if (!confirm('End this recorded session?')) return;

      await api(`/api/admin/sessions/${id}/disconnect`, {
        method: 'POST',
      });

      $('#globalMsg').innerHTML = note('Session record updated.', true);
      await render('Sessions');
    }
  } catch (error) {
    $('#globalMsg').innerHTML = note(error.message);
  } finally {
    isSubmitting = false;
    button.disabled = false;
  }
});

document.addEventListener('submit', async (event) => {
  if (event.target.id !== 'packageForm' &&
      event.target.id !== 'voucherForm') return;

  event.preventDefault();

  if (isSubmitting) return;

  isSubmitting = true;
  const form = event.target;
  const button = form.querySelector('button[type="submit"]');
  const original = button.textContent;

  button.disabled = true;
  button.textContent = 'Saving…';

  try {
    if (form.id === 'packageForm') {
      const name = $('#pn').value.trim();
      const priceTzs = Number($('#pp').value);
      const minutes = Number($('#pd').value);
      const maxDevices = Number($('#px').value);

      if (!name || !Number.isSafeInteger(priceTzs) || priceTzs < 1 ||
          !Number.isSafeInteger(minutes) || minutes < 1 ||
          !Number.isSafeInteger(maxDevices) || maxDevices < 1) {
        throw new Error('Enter a name, positive whole-number price, duration and device limit.');
      }

      await api('/api/admin/packages', {
        method: 'POST',
        body: {
          name,
          priceTzs,
          durationSeconds: minutes * 60,
          maxDevices,
        },
      });

      await render('Packages');
      $('#globalMsg').innerHTML = note('Package created.', true);
    }

    if (form.id === 'voucherForm') {
      const packageId = Number($('#vp').value);

      if (!Number.isInteger(packageId) || packageId < 1) {
        throw new Error('Select a valid package.');
      }

      const result = await api('/api/admin/vouchers', {
        method: 'POST',
        body: { packageId },
      });

      await render('Vouchers');

      if (result.code) {
        $('#voucherMsg').innerHTML = note(
          `New voucher code — save it now: ${result.code}`,
          true
        );
      } else {
        $('#voucherMsg').innerHTML = note(
          'Voucher created, but the server did not return a code. Check the API response before issuing another.'
        );
      }
    }
  } catch (error) {
    const messageTarget = form.id === 'packageForm'
      ? $('#packageMsg')
      : $('#voucherMsg');

    if (messageTarget) {
      messageTarget.innerHTML = note(error.message);
    } else {
      $('#globalMsg').innerHTML = note(error.message);
    }
  } finally {
    isSubmitting = false;

    // A successful render replaces the form, so only restore an attached button.
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = original;
    }
  }
});

async function boot() {
  try {
    await api('/api/admin/dashboard');
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#out').hidden = false;
    $('#adminIdentity').textContent = 'Administrator';
    await render('Dashboard');
  } catch {
    if ($('#app').hidden) {
      gate();
    }
  }
}

boot();
