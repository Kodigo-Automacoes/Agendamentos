const express = require("express");
const router = express.Router();
const { pool } = require("../config/db");

// Mantido para compatibilidade com monitoramento externo (curl $API_URL/health).
// O "/" agora serve a landing page — ver app.js + public/index.html.
router.get("/health", (req, res) => {
  res.json({ status: "API OK" });
});

router.get("/db-ok", async (req, res) => {
  try {
    const r = await pool.query("SELECT now() as agora");
    res.json({ ok: true, agora: r.rows[0].agora });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

module.exports = router;
