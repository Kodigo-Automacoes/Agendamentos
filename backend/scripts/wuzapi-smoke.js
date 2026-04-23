#!/usr/bin/env node
require('dotenv').config();

const API_BASE = (process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');
const API_KEY = process.env.API_KEY;
const INSTANCE_KEY = process.env.WUZAPI_INSTANCE_KEY || 'barbearia_teste';
const TEST_TO = process.env.WUZAPI_TEST_TO || '';
const TEST_TEXT = process.env.WUZAPI_TEST_TEXT || 'Teste de envio via WUZAPI pelo kodigo-api';

if (!API_KEY) {
  console.error('API_KEY ausente no .env');
  process.exit(1);
}

async function call(path, { method = 'GET', body = null } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        'x-api-key': API_KEY,
        'content-type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    return {
      status: 0,
      data: { ok: false, error: `Falha ao conectar na API (${API_BASE}): ${error.message}` },
    };
  }

  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch {}

  return { status: res.status, data };
}

function printStep(title, result) {
  const ok = result.status >= 200 && result.status < 300;
  console.log(`\n[${ok ? 'OK' : 'ERRO'}] ${title}`);
  console.log(`status=${result.status}`);
  console.log(JSON.stringify(result.data, null, 2));
}

(async () => {
  console.log(`API_BASE=${API_BASE}`);
  console.log(`INSTANCE_KEY=${INSTANCE_KEY}`);

  const cfg = await call(`/wuzapi/config?instance_key=${encodeURIComponent(INSTANCE_KEY)}`);
  printStep('Config', cfg);

  const status = await call(`/wuzapi/session/status?instance_key=${encodeURIComponent(INSTANCE_KEY)}`);
  printStep('Session status', status);

  const qr = await call(`/wuzapi/session/qr?instance_key=${encodeURIComponent(INSTANCE_KEY)}`);
  printStep('Session QR', qr);

  if (TEST_TO) {
    const send = await call('/wuzapi/chat/send/text', {
      method: 'POST',
      body: {
        instance_key: INSTANCE_KEY,
        to: TEST_TO,
        text: TEST_TEXT,
      },
    });
    printStep('Send test text', send);
  } else {
    console.log('\n[INFO] WUZAPI_TEST_TO nao informado; envio de teste ignorado.');
  }
})();
