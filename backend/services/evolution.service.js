// services/evolution.service.js
// ============================================================
// Integração direta com a Evolution API v2.
// Envia mensagens, configura webhooks e verifica status da instância.
// Mantido separado do wuzapi.service.js (backup / fallback futuro).
// ============================================================

const { pool } = require("../config/db");
const { safeString } = require("../utils/helpers");

const DEFAULT_TIMEOUT_MS = 15000;

// ===================== Helpers =====================

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
  const raw = safeString(baseUrl) || "http://localhost:8080";
  return raw.replace(/\/+$/, "");
}

/**
 * Normaliza número de telefone para o formato que a Evolution aceita.
 * Remove "+", "@s.whatsapp.net", e caracteres não-numéricos.
 * Resultado: apenas dígitos (ex: "5511999999999").
 */
function normalizePhoneDigits(raw) {
  if (!raw) return null;
  const text = String(raw);

  // Se for JID, extrai os dígitos antes do @
  const jid = text.match(/^(\d+)@/);
  const source = jid ? jid[1] : text;

  const digits = source.replace(/\D/g, "");
  return digits || null;
}

function maskApiKey(key) {
  const k = safeString(key);
  if (!k) return null;
  if (k.length <= 8) return "***";
  return `${k.slice(0, 4)}...${k.slice(-3)}`;
}

// ===================== Config Resolution =====================

/**
 * Busca o canal no banco para extrair configuração específica.
 */
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

/**
 * Monta a configuração da Evolution API a partir de:
 *   1) provedor_config do canal no banco (prioridade)
 *   2) variáveis de ambiente (fallback)
 *
 * Campos retornados:
 *   - baseURL, apiKey, instanceName, timeoutMs, sendEnabled, canal
 */
function buildConfigFromCanal({ canal, fallbackInstanceKey = null }) {
  const provedorConfig = parseJsonSafe(canal?.provedor_config, {});

  const instanceName =
    safeString(provedorConfig.evolution_instance) ||
    safeString(provedorConfig.instance_name) ||
    safeString(canal?.instance_key) ||
    safeString(canal?.provedor_instance_key) ||
    safeString(fallbackInstanceKey) ||
    safeString(process.env.EVOLUTION_INSTANCE_NAME) ||
    null;

  const apiKey =
    safeString(provedorConfig.evolution_api_key) ||
    safeString(provedorConfig.apikey) ||
    safeString(process.env.EVOLUTION_API_KEY) ||
    null;

  const baseURL = normalizeBaseUrl(
    safeString(provedorConfig.evolution_base_url) ||
      safeString(provedorConfig.base_url) ||
      process.env.EVOLUTION_BASE_URL
  );

  const timeoutMs = Number(
    safeString(provedorConfig.evolution_timeout_ms) ||
      safeString(process.env.EVOLUTION_TIMEOUT_MS) ||
      DEFAULT_TIMEOUT_MS
  );

  return {
    canal,
    instanceName,
    apiKey,
    baseURL,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
    provider: safeString(canal?.provedor) || "evolution",
    sendEnabled:
      toBoolean(provedorConfig.evolution_send_enabled, true) &&
      toBoolean(process.env.EVOLUTION_SEND_ENABLED, true),
  };
}

/**
 * Resolve a configuração completa da Evolution API.
 * Tenta primeiro pelo canal no banco, depois faz fallback para env vars.
 */
async function resolveEvolutionConfig({ canalId = null, instanceKey = null, requireApiKey = true } = {}) {
  const canal = await getCanalRow({ canalId, instanceKey });
  const config = buildConfigFromCanal({ canal, fallbackInstanceKey: instanceKey });

  if (requireApiKey && !config.apiKey) {
    const err = new Error(
      "API Key da Evolution não configurada. " +
      "Defina em core.canal_whatsapp.provedor_config (evolution_api_key) ou EVOLUTION_API_KEY no .env."
    );
    err.code = "EVOLUTION_API_KEY_MISSING";
    throw err;
  }

  if (!config.instanceName) {
    const err = new Error(
      "Nome da instância Evolution não configurado. " +
      "Defina em core.canal_whatsapp.provedor_config (evolution_instance/instance_name), " +
      "instance_key do canal, ou EVOLUTION_INSTANCE_NAME no .env."
    );
    err.code = "EVOLUTION_INSTANCE_MISSING";
    throw err;
  }

  return config;
}

// ===================== HTTP Client =====================

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

/**
 * Faz uma requisição HTTP para a Evolution API.
 *
 * @param {Object} options
 * @param {Object} options.config - Configuração resolvida (resolveEvolutionConfig)
 * @param {string} options.path - Caminho do endpoint (ex: /message/sendText/minhaInstancia)
 * @param {string} [options.method=GET]
 * @param {Object} [options.body] - Body JSON
 * @returns {Promise<{status: number, data: any, headers: Object, request: Object}>}
 */
async function evolutionRequest({ config, path, method = "GET", body = undefined } = {}) {
  ensureFetchAvailable();

  const baseURL = normalizeBaseUrl(config?.baseURL || process.env.EVOLUTION_BASE_URL);
  const url = `${baseURL}${path}`;

  const controller = new AbortController();
  const timeoutMs = Number(config?.timeoutMs || DEFAULT_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const headers = {
    Accept: "application/json",
  };

  // Evolution API usa header "apikey" para autenticação
  if (config?.apiKey) {
    headers.apikey = config.apiKey;
  }

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
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
      const err = new Error(`Evolution API ${method} ${path} falhou (${res.status}).`);
      err.code = "EVOLUTION_HTTP_ERROR";
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
      const timeoutErr = new Error(`Timeout ao chamar Evolution API (${method} ${path}) após ${timeoutMs}ms.`);
      timeoutErr.code = "EVOLUTION_TIMEOUT";
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    if (error?.code === "EVOLUTION_HTTP_ERROR") throw error;
    const netErr = new Error(`Falha de rede ao chamar Evolution API (${method} ${path}): ${error.message}`);
    netErr.code = "EVOLUTION_NETWORK_ERROR";
    netErr.status = 502;
    netErr.cause = error;
    throw netErr;
  } finally {
    clearTimeout(timeout);
  }
}

// ===================== Messaging =====================

/**
 * Envia uma mensagem de texto via Evolution API.
 *
 * Endpoint: POST /message/sendText/{instanceName}
 * Body: { number: "5511999999999", text: "Olá!" }
 *
 * @param {Object} options
 * @param {string} [options.canalId] - ID do canal no banco
 * @param {string} [options.instanceKey] - Instance key / instance name
 * @param {string} options.to - Número de destino (E.164 ou dígitos puros)
 * @param {string} options.text - Texto da mensagem
 * @returns {Promise<Object>} Resultado do envio
 */
async function sendTextViaEvolution({ canalId = null, instanceKey = null, to, text } = {}) {
  const config = await resolveEvolutionConfig({ canalId, instanceKey, requireApiKey: true });

  if (!config.sendEnabled) {
    return {
      ok: false,
      skipped: true,
      reason: "evolution_send_disabled",
      config: {
        baseURL: config.baseURL,
        instanceName: config.instanceName,
      },
    };
  }

  const phone = normalizePhoneDigits(to);
  if (!phone) {
    const err = new Error("Número de destino inválido para envio via Evolution API.");
    err.code = "EVOLUTION_INVALID_PHONE";
    throw err;
  }

  const message = safeString(text);
  if (!message) {
    const err = new Error("Texto de mensagem vazio para envio via Evolution API.");
    err.code = "EVOLUTION_EMPTY_TEXT";
    throw err;
  }

  const resp = await evolutionRequest({
    config,
    path: `/message/sendText/${encodeURIComponent(config.instanceName)}`,
    method: "POST",
    body: {
      number: phone,
      text: message,
    },
  });

  return {
    ok: true,
    status: resp.status,
    data: resp.data,
    destination: phone,
    config: {
      baseURL: config.baseURL,
      instanceName: config.instanceName,
      apiKeyHint: maskApiKey(config.apiKey),
      canalId: config.canal?.id || null,
      provider: config.provider,
    },
  };
}

// ===================== Instance Management =====================

/**
 * Verifica o status de conexão da instância.
 * Endpoint: GET /instance/connectionState/{instanceName}
 */
async function getInstanceStatus({ canalId = null, instanceKey = null } = {}) {
  const config = await resolveEvolutionConfig({ canalId, instanceKey, requireApiKey: true });
  return evolutionRequest({
    config,
    path: `/instance/connectionState/${encodeURIComponent(config.instanceName)}`,
    method: "GET",
  });
}

/**
 * Busca informações da instância.
 * Endpoint: GET /instance/fetchInstances?instanceName={name}
 */
async function fetchInstance({ canalId = null, instanceKey = null } = {}) {
  const config = await resolveEvolutionConfig({ canalId, instanceKey, requireApiKey: true });
  return evolutionRequest({
    config,
    path: `/instance/fetchInstances?instanceName=${encodeURIComponent(config.instanceName)}`,
    method: "GET",
  });
}

// ===================== Webhook Management =====================

/**
 * Configura o webhook para a instância na Evolution API.
 *
 * Endpoint: POST /webhook/set/{instanceName}
 * Body: { url, enabled, events, headers }
 *
 * @param {Object} options
 * @param {string} options.webhookUrl - URL do webhook de destino
 * @param {string[]} [options.events] - Lista de eventos (default: todos)
 * @param {Object} [options.customHeaders] - Headers personalizados enviados pela Evolution ao webhook
 */
async function setWebhook({
  canalId = null,
  instanceKey = null,
  webhookUrl,
  events = null,
  customHeaders = null,
} = {}) {
  const config = await resolveEvolutionConfig({ canalId, instanceKey, requireApiKey: true });

  const url = safeString(webhookUrl);
  if (!url) {
    const err = new Error("webhookUrl é obrigatório para configurar webhook na Evolution API.");
    err.code = "EVOLUTION_WEBHOOK_URL_REQUIRED";
    throw err;
  }

  // Evolution v2 exige o envelope { webhook: { ... } } em /webhook/set/:instance
  const webhook = {
    url,
    enabled: true,
    webhookByEvents: false,
    base64: false,
  };

  if (events && Array.isArray(events)) {
    webhook.events = events;
  }

  if (customHeaders && typeof customHeaders === "object") {
    webhook.headers = customHeaders;
  }

  return evolutionRequest({
    config,
    path: `/webhook/set/${encodeURIComponent(config.instanceName)}`,
    method: "POST",
    body: { webhook },
  });
}

/**
 * Busca a configuração de webhook atual da instância.
 * Endpoint: GET /webhook/find/{instanceName}
 */
async function getWebhook({ canalId = null, instanceKey = null } = {}) {
  const config = await resolveEvolutionConfig({ canalId, instanceKey, requireApiKey: true });
  return evolutionRequest({
    config,
    path: `/webhook/find/${encodeURIComponent(config.instanceName)}`,
    method: "GET",
  });
}

// ===================== Convenience =====================

/**
 * Redact de config para retornar ao cliente (esconde apiKey).
 */
function redactConfig(config) {
  if (!config) return null;
  return {
    baseURL: config.baseURL,
    timeoutMs: config.timeoutMs,
    provider: config.provider,
    instanceName: config.instanceName,
    apiKeyHint: maskApiKey(config.apiKey),
    sendEnabled: config.sendEnabled,
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
  resolveEvolutionConfig,
  evolutionRequest,
  sendTextViaEvolution,
  getInstanceStatus,
  fetchInstance,
  setWebhook,
  getWebhook,
  redactConfig,
};
