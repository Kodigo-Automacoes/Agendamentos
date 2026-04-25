const { pool } = require("../config/db");
const { safeString } = require("../utils/helpers");

const DEFAULT_BASE_URL = "http://localhost:8080";
const DEFAULT_TIMEOUT_MS = 15000;

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return String(value).toLowerCase() === "true";
}

function parseJsonSafe(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeBaseUrl(baseUrl) {
  const raw = safeString(baseUrl) || DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, "");
}

function normalizePhoneDigits(raw) {
  if (!raw) return null;
  const text = String(raw);

  const jid = text.match(/^(\d+)@/);
  const source = jid ? jid[1] : text;

  const digits = source.replace(/\D/g, "");
  return digits || null;
}

function parseTokenMapFromEnv() {
  const parsed = parseJsonSafe(process.env.WUZAPI_TOKENS_JSON, {});
  return typeof parsed === "object" && parsed ? parsed : {};
}

function maskToken(token) {
  const t = safeString(token);
  if (!t) return null;
  if (t.length <= 8) return "***";
  return `${t.slice(0, 4)}...${t.slice(-3)}`;
}

async function getCanalRow({ canalId, instanceKey }) {
  if (canalId) {
    const byId = await pool.query(
      `
      SELECT id, empresa_id, unidade_id, numero_e164, provedor, provedor_config, ativo,
             instance_key, provedor_instance_key
      FROM core.canal_whatsapp
      WHERE id = $1::int
      LIMIT 1
      `,
      [canalId]
    );
    return byId.rows[0] || null;
  }

  if (instanceKey) {
    const byInstance = await pool.query(
      `
      SELECT id, empresa_id, unidade_id, numero_e164, provedor, provedor_config, ativo,
             instance_key, provedor_instance_key
      FROM core.canal_whatsapp
      WHERE instance_key = $1
      ORDER BY ativo DESC, updated_at DESC
      LIMIT 1
      `,
      [instanceKey]
    );
    return byInstance.rows[0] || null;
  }

  return null;
}

function buildConfigFromCanal({ canal, fallbackInstanceKey = null }) {
  const provedorConfig = parseJsonSafe(canal?.provedor_config, {});
  const tokenMap = parseTokenMapFromEnv();

  const instanceKey =
    safeString(canal?.instance_key) ||
    safeString(canal?.provedor_instance_key) ||
    safeString(fallbackInstanceKey) ||
    null;

  const token =
    safeString(provedorConfig.wuzapi_token) ||
    safeString(provedorConfig.token) ||
    safeString(provedorConfig.user_token) ||
    (instanceKey ? safeString(tokenMap[instanceKey]) : null) ||
    safeString(process.env.WUZAPI_TOKEN) ||
    null;

  const baseURL = normalizeBaseUrl(
    safeString(provedorConfig.wuzapi_base_url) ||
      safeString(provedorConfig.base_url) ||
      process.env.WUZAPI_BASE_URL
  );

  const timeoutMs = Number(
    safeString(provedorConfig.wuzapi_timeout_ms) ||
      safeString(process.env.WUZAPI_TIMEOUT_MS) ||
      DEFAULT_TIMEOUT_MS
  );

  return {
    canal,
    instanceKey,
    token,
    baseURL,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
    provider: safeString(canal?.provedor) || null,
    sendEnabled:
      toBoolean(provedorConfig.wuzapi_send_enabled, true) &&
      toBoolean(process.env.WUZAPI_SEND_ENABLED, true),
    webhookSecret:
      safeString(provedorConfig.wuzapi_webhook_secret) ||
      safeString(process.env.WUZAPI_WEBHOOK_SECRET) ||
      null,
  };
}

async function resolveWuzapiConfig({ canalId = null, instanceKey = null, requireToken = true } = {}) {
  const canal = await getCanalRow({ canalId, instanceKey });
  const config = buildConfigFromCanal({ canal, fallbackInstanceKey: instanceKey });

  if (requireToken && !config.token) {
    const err = new Error(
      "Token WUZAPI não configurado. Defina em core.canal_whatsapp.provedor_config (wuzapi_token/token) ou WUZAPI_TOKEN."
    );
    err.code = "WUZAPI_TOKEN_MISSING";
    throw err;
  }

  return config;
}

function ensureFetchAvailable() {
  if (typeof fetch !== "function") {
    throw new Error("Ambiente Node sem fetch global. Use Node.js >= 18.");
  }
}

function parseHttpPayload(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function wuzapiRequest({ config, path, method = "GET", body = undefined, admin = false } = {}) {
  ensureFetchAvailable();

  const baseURL = normalizeBaseUrl(config?.baseURL || process.env.WUZAPI_BASE_URL);
  const url = `${baseURL}${path}`;

  const controller = new AbortController();
  const timeoutMs = Number(config?.timeoutMs || process.env.WUZAPI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const headers = {
    Accept: "application/json",
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (admin) {
    const adminToken = safeString(process.env.WUZAPI_ADMIN_TOKEN);
    if (!adminToken) {
      clearTimeout(timeout);
      const err = new Error("WUZAPI_ADMIN_TOKEN não configurado para endpoint admin.");
      err.code = "WUZAPI_ADMIN_TOKEN_MISSING";
      throw err;
    }
    headers.Authorization = adminToken;
  } else if (config?.token) {
    headers.token = config.token;
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    const payload = parseHttpPayload(text);

    if (!res.ok) {
      const err = new Error(`WUZAPI ${method} ${path} falhou (${res.status}).`);
      err.code = "WUZAPI_HTTP_ERROR";
      err.status = res.status;
      err.responseData = payload;
      throw err;
    }

    return {
      status: res.status,
      data: payload,
      headers: Object.fromEntries(res.headers.entries()),
      request: { method, path, url },
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutErr = new Error(`Timeout ao chamar WUZAPI (${method} ${path}) após ${timeoutMs}ms.`);
      timeoutErr.code = "WUZAPI_TIMEOUT";
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    if (error?.code === "WUZAPI_HTTP_ERROR") throw error;
    const netErr = new Error(`Falha de rede ao chamar WUZAPI (${method} ${path}): ${error.message}`);
    netErr.code = "WUZAPI_NETWORK_ERROR";
    netErr.status = 502;
    netErr.cause = error;
    throw netErr;
  } finally {
    clearTimeout(timeout);
  }
}

async function sendTextViaWuzapi({ canalId = null, instanceKey = null, to, text } = {}) {
  const config = await resolveWuzapiConfig({ canalId, instanceKey, requireToken: true });

  if (!config.sendEnabled) {
    return {
      ok: false,
      skipped: true,
      reason: "wuzapi_send_disabled",
      config: {
        baseURL: config.baseURL,
        instanceKey: config.instanceKey,
      },
    };
  }

  const phone = normalizePhoneDigits(to);
  if (!phone) {
    const err = new Error("Número de destino inválido para envio WUZAPI.");
    err.code = "WUZAPI_INVALID_PHONE";
    throw err;
  }

  const message = safeString(text);
  if (!message) {
    const err = new Error("Texto de mensagem vazio para envio WUZAPI.");
    err.code = "WUZAPI_EMPTY_TEXT";
    throw err;
  }

  const attempts = [
    { phone, message },
    { phone, text: message },
    { number: phone, message },
  ];

  const errors = [];
  for (const payload of attempts) {
    try {
      const resp = await wuzapiRequest({
        config,
        path: "/chat/send/text",
        method: "POST",
        body: payload,
      });

      return {
        ok: true,
        status: resp.status,
        data: resp.data,
        attemptedPayload: payload,
        destination: phone,
        config: {
          baseURL: config.baseURL,
          instanceKey: config.instanceKey,
          tokenHint: maskToken(config.token),
          canalId: config.canal?.id || null,
          provider: config.provider,
        },
      };
    } catch (error) {
      errors.push({
        message: error.message,
        code: error.code || null,
        status: error.status || null,
        response: error.responseData || null,
        attemptedPayload: payload,
      });
    }
  }

  const err = new Error("Falha ao enviar mensagem via WUZAPI com os formatos testados.");
  err.code = "WUZAPI_SEND_FAILED";
  err.details = errors;
  throw err;
}

async function getSessionStatus({ canalId = null, instanceKey = null } = {}) {
  const config = await resolveWuzapiConfig({ canalId, instanceKey, requireToken: true });
  return wuzapiRequest({ config, path: "/session/status", method: "GET" });
}

async function connectSession({ canalId = null, instanceKey = null } = {}) {
  const config = await resolveWuzapiConfig({ canalId, instanceKey, requireToken: true });
  return wuzapiRequest({ config, path: "/session/connect", method: "POST", body: {} });
}

async function disconnectSession({ canalId = null, instanceKey = null } = {}) {
  const config = await resolveWuzapiConfig({ canalId, instanceKey, requireToken: true });
  return wuzapiRequest({ config, path: "/session/disconnect", method: "POST", body: {} });
}

async function logoutSession({ canalId = null, instanceKey = null } = {}) {
  const config = await resolveWuzapiConfig({ canalId, instanceKey, requireToken: true });
  return wuzapiRequest({ config, path: "/session/logout", method: "POST", body: {} });
}

async function getSessionQr({ canalId = null, instanceKey = null } = {}) {
  const config = await resolveWuzapiConfig({ canalId, instanceKey, requireToken: true });
  return wuzapiRequest({ config, path: "/session/qr", method: "GET" });
}

async function setWebhook({ canalId = null, instanceKey = null, webhookUrl, events = "All" } = {}) {
  const config = await resolveWuzapiConfig({ canalId, instanceKey, requireToken: true });

  const url = safeString(webhookUrl);
  if (!url) {
    const err = new Error("webhookUrl é obrigatório para configurar webhook na WUZAPI.");
    err.code = "WUZAPI_WEBHOOK_URL_REQUIRED";
    throw err;
  }

  const attempts = [
    { webhook: url, events },
    { url, events },
    { webhookUrl: url, events },
  ];

  const errors = [];
  for (const payload of attempts) {
    try {
      return await wuzapiRequest({
        config,
        path: "/webhook",
        method: "POST",
        body: payload,
      });
    } catch (error) {
      errors.push({
        message: error.message,
        code: error.code || null,
        status: error.status || null,
        response: error.responseData || null,
        attemptedPayload: payload,
      });
    }
  }

  const err = new Error("Falha ao configurar webhook na WUZAPI com os formatos testados.");
  err.code = "WUZAPI_SET_WEBHOOK_FAILED";
  err.details = errors;
  throw err;
}

async function getWebhook({ canalId = null, instanceKey = null } = {}) {
  const config = await resolveWuzapiConfig({ canalId, instanceKey, requireToken: true });
  return wuzapiRequest({ config, path: "/webhook", method: "GET" });
}

async function deleteWebhook({ canalId = null, instanceKey = null } = {}) {
  const config = await resolveWuzapiConfig({ canalId, instanceKey, requireToken: true });
  return wuzapiRequest({ config, path: "/webhook", method: "DELETE" });
}

async function listAdminUsers() {
  return wuzapiRequest({
    config: { baseURL: normalizeBaseUrl(process.env.WUZAPI_BASE_URL || DEFAULT_BASE_URL), timeoutMs: DEFAULT_TIMEOUT_MS },
    path: "/admin/users",
    method: "GET",
    admin: true,
  });
}

async function createAdminUser({ name, token, webhook = "", events = "All" } = {}) {
  const payload = {
    name: safeString(name) || "Kodigo User",
    token: safeString(token),
    webhook: safeString(webhook) || "",
    events: safeString(events) || "All",
  };

  if (!payload.token) {
    const err = new Error("Token e obrigatorio para criar usuario admin na WUZAPI.");
    err.code = "WUZAPI_ADMIN_CREATE_TOKEN_REQUIRED";
    throw err;
  }

  return wuzapiRequest({
    config: { baseURL: normalizeBaseUrl(process.env.WUZAPI_BASE_URL || DEFAULT_BASE_URL), timeoutMs: DEFAULT_TIMEOUT_MS },
    path: "/admin/users",
    method: "POST",
    body: payload,
    admin: true,
  });
}

async function ensureAdminUser({ name, token, webhook = "", events = "All" } = {}) {
  const list = await listAdminUsers();
  const users = Array.isArray(list?.data?.data) ? list.data.data : [];
  const tokenStr = safeString(token);

  const existing = users.find((u) => {
    const sameToken = tokenStr && safeString(u?.token) === tokenStr;
    const sameName = safeString(name) && safeString(u?.name) === safeString(name);
    return sameToken || sameName;
  });

  if (existing) {
    return {
      created: false,
      user: existing,
      source: "existing",
      raw: list.data,
    };
  }

  const created = await createAdminUser({ name, token, webhook, events });
  return {
    created: true,
    user: created?.data?.data || null,
    source: "created",
    raw: created?.data || null,
  };
}

function redactConfig(config) {
  if (!config) return null;
  return {
    baseURL: config.baseURL,
    timeoutMs: config.timeoutMs,
    provider: config.provider,
    instanceKey: config.instanceKey,
    tokenHint: maskToken(config.token),
    canal: config.canal
      ? {
          id: config.canal.id,
          empresa_id: config.canal.empresa_id,
          unidade_id: config.canal.unidade_id,
          numero_e164: config.canal.numero_e164,
          provedor: config.canal.provedor,
          ativo: config.canal.ativo,
        }
      : null,
  };
}

module.exports = {
  normalizePhoneDigits,
  resolveWuzapiConfig,
  wuzapiRequest,
  sendTextViaWuzapi,
  getSessionStatus,
  connectSession,
  disconnectSession,
  logoutSession,
  getSessionQr,
  setWebhook,
  getWebhook,
  deleteWebhook,
  listAdminUsers,
  createAdminUser,
  ensureAdminUser,
  redactConfig,
};
