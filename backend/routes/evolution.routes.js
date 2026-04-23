// routes/evolution.routes.js
// ============================================================
// Rotas de gestão da Evolution API (status, webhook, config, envio).
// Todas as rotas exigem x-api-key (passam pelo middleware auth global).
// ============================================================

const express = require("express");
const router = express.Router();

const {
  resolveEvolutionConfig,
  redactConfig,
  getInstanceStatus,
  fetchInstance,
  sendTextViaEvolution,
  setWebhook,
  getWebhook,
} = require("../services/evolution.service");
const { safeString } = require("../utils/helpers");

function getRef(req) {
  return {
    canalId: safeString(req.body?.canal_id) || safeString(req.query?.canal_id) || null,
    instanceKey: safeString(req.body?.instance_key) || safeString(req.query?.instance_key) || null,
  };
}

function getTextParam(req, key) {
  return safeString(req.body?.[key]) || safeString(req.query?.[key]) || null;
}

function handleError(res, error, fallbackStatus = 500) {
  const status = error?.status || fallbackStatus;
  return res.status(status).json({
    ok: false,
    error: error.message,
    code: error.code || null,
    details: error.details || error.responseData || null,
  });
}

// --- Config (redacted) ---
router.get("/evolution/config", async (req, res) => {
  try {
    const ref = getRef(req);
    const config = await resolveEvolutionConfig({ ...ref, requireApiKey: false });
    return res.json({ ok: true, config: redactConfig(config) });
  } catch (error) {
    return handleError(res, error);
  }
});

// --- Instance status ---
router.get("/evolution/instance/status", async (req, res) => {
  try {
    const ref = getRef(req);
    const resp = await getInstanceStatus(ref);
    return res.json({ ok: true, status: resp.status, data: resp.data });
  } catch (error) {
    return handleError(res, error);
  }
});

// --- Fetch instance info ---
router.get("/evolution/instance/info", async (req, res) => {
  try {
    const ref = getRef(req);
    const resp = await fetchInstance(ref);
    return res.json({ ok: true, status: resp.status, data: resp.data });
  } catch (error) {
    return handleError(res, error);
  }
});

// --- Send text ---
router.post("/evolution/chat/send/text", async (req, res) => {
  try {
    const ref = getRef(req);
    const to = getTextParam(req, "to");
    const text = getTextParam(req, "text");

    if (!to || !text) {
      return res.status(400).json({ ok: false, error: "Campos obrigatórios: to, text" });
    }

    const sent = await sendTextViaEvolution({ ...ref, to, text });
    return res.json({ ok: true, delivery: sent });
  } catch (error) {
    return handleError(res, error);
  }
});

// --- Get webhook config ---
router.get("/evolution/webhook", async (req, res) => {
  try {
    const ref = getRef(req);
    const resp = await getWebhook(ref);
    return res.json({ ok: true, status: resp.status, data: resp.data });
  } catch (error) {
    return handleError(res, error);
  }
});

// --- Set webhook (manual) ---
router.post("/evolution/webhook", async (req, res) => {
  try {
    const ref = getRef(req);
    const webhookUrl = getTextParam(req, "webhook_url");
    const events = req.body?.events || null;
    const customHeaders = req.body?.headers || null;

    if (!webhookUrl) {
      return res.status(400).json({ ok: false, error: "Campo obrigatório: webhook_url" });
    }

    const resp = await setWebhook({ ...ref, webhookUrl, events, customHeaders });
    return res.json({ ok: true, status: resp.status, data: resp.data });
  } catch (error) {
    return handleError(res, error);
  }
});

// --- Sync webhook (automático — configura webhook apontando para esta API) ---
router.post("/evolution/webhook/sync", async (req, res) => {
  try {
    const ref = getRef(req);
    const publicBaseUrl = getTextParam(req, "public_base_url") || safeString(process.env.PUBLIC_BASE_URL);
    const webhookSecret = safeString(process.env.EVOLUTION_WEBHOOK_SECRET);

    if (!publicBaseUrl) {
      return res.status(400).json({
        ok: false,
        error: "Informe public_base_url no body ou PUBLIC_BASE_URL no .env",
      });
    }

    // Monta a URL do webhook com o secret como query param (se configurado)
    const webhookUrl = new URL("/evolution/webhook", publicBaseUrl);
    if (webhookSecret) {
      webhookUrl.searchParams.set("webhook_secret", webhookSecret);
    }

    // Headers que a Evolution vai enviar para nosso endpoint
    const apiKey = safeString(process.env.API_KEY);
    const customHeaders = {};
    if (apiKey) {
      customHeaders["x-api-key"] = apiKey;
    }

    const events = req.body?.events || ["MESSAGES_UPSERT"];

    const resp = await setWebhook({
      ...ref,
      webhookUrl: webhookUrl.toString(),
      events,
      customHeaders: Object.keys(customHeaders).length ? customHeaders : null,
    });

    return res.json({
      ok: true,
      status: resp.status,
      data: resp.data,
      configured_webhook_url: webhookUrl.toString(),
      events,
    });
  } catch (error) {
    return handleError(res, error);
  }
});

module.exports = router;
