
const $ = (selector) => document.querySelector(selector);

const uid = () =>
  globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);

let dev = localStorage.getItem('mzDev');

if (!dev) {
  dev = uid();
  localStorage.setItem('mzDev', dev);
}

const api = async (url, options = {}) => {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body === undefined
      ? undefined
      : JSON.stringify(options.body),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
};

const say = (element, message, success = false) => {
  element.replaceChildren();

  if (!message) return;

  const box = document.createElement('div');
  box.className = success ? 'msg ok' : 'msg';
  box.textContent = message;
  element.append(box);
};

const formatTzs = (amount) =>
  `${Number(amount).toLocaleString('en-TZ')} TZS`;

const duration = (seconds) => {
  if (seconds >= 86400 && seconds % 86400 === 0) {
    const days = seconds / 86400;
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }

  if (seconds >= 3600 && seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }

  const minutes = Math.ceil(seconds / 60);
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
};

let selectedPackage = null;
let payment = null;
let countdown = null;
let busy = false;

function setBusy(button, value, label) {
  button.disabled = value;

  if (value) {
    button.dataset.originalText = button.textContent;
    button.textContent = label || 'Please wait…';
  } else if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
    delete button.dataset.originalText;
  }
}

function setNetworkStatus(config) {
  const network = config?.network;
  const title = $('#networkTitle');
  const message = $('#networkText');

  if (!network) {
    title.textContent = 'Network status unavailable';
    message.textContent =
      'The app could not confirm whether real internet access is controlled.';
    return;
  }

  if (network.enforcing === true) {
    title.textContent = 'Network controller reports enforcement enabled';
    message.textContent =
      'This reports the controller configuration; it is not an independent test of internet access.';
  } else {
    title.textContent = 'Network access enforcement is not enabled';
    message.textContent =
      network.message ||
      'The current controller may record sessions without controlling actual internet traffic.';
  }
}

function createPackageCard(item) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'card pick';
  card.setAttribute('aria-label', `Choose ${item.name}, ${formatTzs(item.priceTzs)}`);

  const heading = document.createElement('h3');
  heading.textContent = item.name;

  const price = document.createElement('div');
  price.className = 'price';
  price.textContent = Number(item.priceTzs).toLocaleString('en-TZ');

  const currency = document.createElement('small');
  currency.textContent = 'TZS';
  price.append(currency);

  const detail = document.createElement('p');
  detail.className = 'muted';
  detail.textContent =
    `${duration(item.durationSeconds)} · Up to ${item.maxDevices} ` +
    `${item.maxDevices === 1 ? 'device' : 'devices'}`;

  card.append(heading, price, detail);
  card.addEventListener('click', () => choosePackage(item));

  return card;
}

async function loadPackages() {
  const grid = $('#grid');
  grid.replaceChildren();

  const loading = document.createElement('div');
  loading.className = 'loading-card';
  loading.textContent = 'Loading available packages…';
  grid.append(loading);

  try {
    const packages = await api('/api/packages');
    grid.replaceChildren();

    if (!Array.isArray(packages) || packages.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent =
        'No packages are available right now. Please contact the operator.';
      grid.append(empty);
      return;
    }

    for (const item of packages) {
      grid.append(createPackageCard(item));
    }
  } catch (error) {
    grid.replaceChildren();

    const message = document.createElement('p');
    message.className = 'msg';
    message.textContent =
      `Could not load packages: ${error.message}. Refresh the page or try again later.`;

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn';
    retry.textContent = 'Try again';
    retry.addEventListener('click', loadPackages);

    grid.append(message, retry);
  }
}

async function loadConfig() {
  try {
    const config = await api('/api/config');
    setNetworkStatus(config);

    $('#simBox').hidden = config.simulator !== true;
    $('#noProv').hidden = config.simulator === true;
  } catch {
    setNetworkStatus(null);
    $('#simBox').hidden = true;
    $('#noProv').hidden = false;
  }
}

function choosePackage(item) {
  selectedPackage = item;
  payment = null;

  $('#coTitle').textContent = item.name;
  $('#coInfo').textContent =
    `${formatTzs(item.priceTzs)} for ${duration(item.durationSeconds)}`;

  $('#step1').hidden = false;
  $('#step2').hidden = true;
  $('#step3').hidden = true;

  $('#simBox').hidden = true;
  $('#noProv').hidden = true;

  $('#phone').value = '';
  $('#ref').textContent = '';
  $('#vcode').textContent = '';

  say($('#coMsg'), '');

  $('#pkgs').hidden = true;
  $('#checkout').hidden = false;
  $('#checkout').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#phone').focus({ preventScroll: true });
}

$('#back').addEventListener('click', () => {
  $('#checkout').hidden = true;
  $('#pkgs').hidden = false;
  $('#pkgs').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('#go').addEventListener('click', async () => {
  if (busy) return;

  if (!selectedPackage) {
    say($('#coMsg'), 'Choose a package first.');
    return;
  }

  const phone = $('#phone').value.trim();

  if (!phone || phone.replace(/\D/g, '').length < 9) {
    say($('#coMsg'), 'Enter a valid mobile money phone number.');
    $('#phone').focus();
    return;
  }

  const button = $('#go');
  busy = true;
  setBusy(button, true, 'Creating payment request…');

  try {
    payment = await api('/api/orders', {
      method: 'POST',
      body: {
        packageId: selectedPackage.id,
        phone,
      },
    });

    $('#ref').textContent = payment.reference || 'Created';
    $('#step1').hidden = true;
    $('#step2').hidden = false;

    say($('#coMsg'), '');

    $('#step2').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    say($('#coMsg'), error.message);
  } finally {
    busy = false;
    setBusy(button, false);
  }
});

async function simulatePayment(outcome) {
  if (busy || !payment?.paymentId) return;

  const button = outcome === 'ok' ? $('#simOk') : $('#simNo');

  busy = true;
  setBusy($('#simOk'), true, 'Processing…');
  setBusy($('#simNo'), true, 'Processing…');

  try {
    const result = await api(`/api/dev/pay/${payment.paymentId}`, {
      method: 'POST',
      body: { outcome },
    });

    if (result.code) {
      $('#vcode').textContent = result.code;
      $('#step2').hidden = true;
      $('#step3').hidden = false;
      say($('#coMsg'), '');
      $('#step3').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else if (result.status === 'FAILED') {
      say($('#coMsg'), 'The simulated payment failed. No real payment was made.');
    } else {
      say(
        $('#coMsg'),
        'The payment has already been processed. Check its status before trying again.'
      );
    }
  } catch (error) {
    say($('#coMsg'), error.message);
  } finally {
    busy = false;
    setBusy($('#simOk'), false);
    setBusy($('#simNo'), false);
  }
}

$('#simOk').addEventListener('click', () => simulatePayment('ok'));
$('#simNo').addEventListener('click', () => simulatePayment('fail'));

async function redeemVoucher(code, output) {
  const normalized = code.trim().toUpperCase();

  if (!normalized) {
    say(output, 'Enter your voucher code first.');
    return;
  }

  try {
    const result = await api('/api/vouchers/redeem', {
      method: 'POST',
      body: {
        code: normalized,
        deviceId: dev,
      },
    });

    say(
      output,
      'Voucher accepted by the application. Your session has been recorded.',
      true
    );

    if (result.expiresAt) {
      showSession(result.expiresAt);
    } else {
      await refreshSession();
    }

    $('#status').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    say(output, error.message);
  }
}

$('#redeem').addEventListener('click', async () => {
  const button = $('#redeem');

  if (busy) return;

  busy = true;
  setBusy(button, true, 'Redeeming voucher…');

  try {
    await redeemVoucher($('#vin').value, $('#rMsg'));
  } finally {
    busy = false;
    setBusy(button, false);
  }
});

$('#useIt').addEventListener('click', async () => {
  const button = $('#useIt');

  if (busy) return;

  busy = true;
  setBusy(button, true, 'Redeeming voucher…');

  try {
    await redeemVoucher($('#vcode').textContent, $('#coMsg'));
  } finally {
    busy = false;
    setBusy(button, false);
  }
});

$('#copyCode').addEventListener('click', async () => {
  const code = $('#vcode').textContent;
  const button = $('#copyCode');

  try {
    await navigator.clipboard.writeText(code);
    button.textContent = 'Voucher copied ✓';
  } catch {
    say($('#coMsg'), 'Copy is unavailable in this browser. Select the voucher code and copy it manually.');
  }
});

$('#vin').addEventListener('input', () => {
  const input = $('#vin');
  input.value = input.value.toUpperCase().replace(/\s/g, '');
});

$('#vin').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') $('#redeem').click();
});

function showSession(expiry) {
  const end = new Date(expiry);

  if (Number.isNaN(end.getTime())) {
    say($('#rMsg'), 'The server returned an invalid session expiry time.');
    return;
  }

  $('#status').hidden = false;
  $('#sessionTitle').textContent = 'Session recorded';
  $('#sessionDescription').textContent =
    'Time remaining according to the application session record.';
  $('#sessionExpiry').textContent =
    `Recorded expiry: ${end.toLocaleString()}`;

  clearInterval(countdown);

  const update = () => {
    const remaining = Math.max(0, Math.floor((end.getTime() - Date.now()) / 1000));

    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    const seconds = remaining % 60;

    $('#left').textContent = [hours, minutes, seconds]
      .map((value) => String(value).padStart(2, '0'))
      .join(':');

    if (remaining <= 0) {
      clearInterval(countdown);
      $('#sessionTitle').textContent = 'Session time expired';
      $('#sessionDescription').textContent =
        'Your recorded package time has ended. Real network disconnection depends on network enforcement being configured.';
    }
  };

  update();

  if (end.getTime() > Date.now()) {
    countdown = setInterval(update, 1000);
  }
}

async function refreshSession() {
  try {
    const result = await api(
      `/api/sessions/me?deviceId=${encodeURIComponent(dev)}`
    );

    if (result.active && result.expiresAt) {
      showSession(result.expiresAt);
    }
  } catch {
    // A missing or inactive session should not prevent package browsing.
  }
}

async function startPortal() {
  await Promise.all([
    loadPackages(),
    loadConfig(),
    refreshSession(),
  ]);
}

startPortal();
