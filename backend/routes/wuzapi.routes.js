const express = require("express");
const router = express.Router();

const {
  resolveWuzapiConfig,
  redactConfig,
  getSessionStatus,
  connectSession,
  disconnectSession,
  logoutSession,
  getSessionQr,
  sendTextViaWuzapi,
  setWebhook,
  getWebhook,
  deleteWebhook,
  ensureAdminUser,
} = require("../services/wuzapi.service");
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

router.get("/wuzapi/config", async (req, res) => {
  try {
    const ref = getRef(req);
    const config = await resolveWuzapiConfig({ ...ref, requireToken: false });
    return res.json({ ok: true, config: redactConfig(config) });
  } catch (error) {
    return handleError(res, error);
  }
});

router.get("/wuzapi/session/status", async (req, res) => {
  try {
    const ref = getRef(req);
    const resp = await getSessionStatus(ref);
    return res.json({ ok: true, status: resp.status, data: resp.data });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post("/wuzapi/session/connect", async (req, res) => {
  try {
    const ref = getRef(req);
    const resp = await connectSession(ref);
    return res.json({ ok: true, status: resp.status, data: resp.data });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post("/wuzapi/session/disconnect", async (req, res) => {
  try {
    const ref = getRef(req);
    const resp = await disconnectSession(ref);
    return res.json({ ok: true, status: resp.status, data: resp.data });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post("/wuzapi/session/logout", async (req, res) => {
  try {
    const ref = getRef(req);
    const resp = await logoutSession(ref);
    return res.json({ ok: true, status: resp.status, data: resp.data });
  } catch (error) {
    return handleError(res, error);
  }
});

router.get("/wuzapi/session/qr", async (req, res) => {
  try {
    const ref = getRef(req);
    const resp = await getSessionQr(ref);
    return res.json({ ok: true, status: resp.status, data: resp.data });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post("/wuzapi/chat/send/text", async (req, res) => {
  try {
    const ref = getRef(req);
    const to = getTextParam(req, "to");
    const text = getTextParam(req, "text");

    if (!to || !text) {
      return res.status(400).json({ ok: false, error: "Campos obrigatorios: to, text" });
    }

    const sent = await sendTextViaWuzapi({ ...ref, to, text });
    return res.json({ ok: true, delivery: sent });
  } catch (error) {
    return handleError(res, error);
  }
});

router.get("/wuzapi/webhook", async (req, res) => {
  try {
    const ref = getRef(req);
    const resp = await getWebhook(ref);
    return res.json({ ok: true, status: resp.status, data: resp.data });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post("/wuzapi/webhook", async (req, res) => {
  try {
    const ref = getRef(req);
    const webhookUrl = getTextParam(req, "webhook_url");
    const events = getTextParam(req, "events") || "All";

    if (!webhookUrl) {
      return res.status(400).json({ ok: false, error: "Campo obrigatorio: webhook_url" });
    }

    const resp = await setWebhook({ ...ref, webhookUrl, events });
    return res.json({ ok: true, status: resp.status, data: resp.data });
  } catch (error) {
    return handleError(res, error);
  }
});

router.delete("/wuzapi/webhook", async (req, res) => {
  try {
    const ref = getRef(req);
    const resp = await deleteWebhook(ref);
    return res.json({ ok: true, status: resp.status, data: resp.data });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post("/wuzapi/webhook/sync", async (req, res) => {
  try {
    const ref = getRef(req);
    const publicBaseUrl = getTextParam(req, "public_base_url") || safeString(process.env.PUBLIC_BASE_URL);
    const secret = safeString(process.env.WUZAPI_WEBHOOK_SECRET);

    if (!publicBaseUrl) {
      return res.status(400).json({ ok: false, error: "Informe public_base_url no body ou PUBLIC_BASE_URL no .env" });
    }

    if (!secret) {
      return res.status(400).json({ ok: false, error: "WUZAPI_WEBHOOK_SECRET nao configurado no .env" });
    }

    const webhookUrl = new URL("/wuzapi/webhook", publicBaseUrl);
    webhookUrl.searchParams.set("webhook_secret", secret);

    const events = getTextParam(req, "events") || "All";
    const resp = await setWebhook({ ...ref, webhookUrl: webhookUrl.toString(), events });

    return res.json({
      ok: true,
      status: resp.status,
      data: resp.data,
      configured_webhook_url: webhookUrl.toString(),
    });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post("/wuzapi/admin/users/ensure", async (req, res) => {
  try {
    const ref = getRef(req);
    const cfg = await resolveWuzapiConfig({ ...ref, requireToken: true });
    const publicBaseUrl = getTextParam(req, "public_base_url") || safeString(process.env.PUBLIC_BASE_URL);
    const secret = safeString(process.env.WUZAPI_WEBHOOK_SECRET);
    const events = getTextParam(req, "events") || "All";

    if (!publicBaseUrl) {
      return res.status(400).json({ ok: false, error: "Informe public_base_url no body ou PUBLIC_BASE_URL no .env" });
    }
    if (!secret) {
      return res.status(400).json({ ok: false, error: "WUZAPI_WEBHOOK_SECRET nao configurado no .env" });
    }

    const webhookUrl = new URL("/wuzapi/webhook", publicBaseUrl);
    webhookUrl.searchParams.set("webhook_secret", secret);

    const name = getTextParam(req, "name") || `kodigo-${cfg.instanceKey || "default"}`;
    const ensured = await ensureAdminUser({
      name,
      token: cfg.token,
      webhook: webhookUrl.toString(),
      events,
    });

    return res.json({
      ok: true,
      ensured,
      webhook_url: webhookUrl.toString(),
      instance_key: cfg.instanceKey,
    });
  } catch (error) {
    return handleError(res, error);
  }
});

module.exports = router;
