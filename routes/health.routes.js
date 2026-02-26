const express = require("express");
const router = express.Router();
const { pool } = require("../config/db");

router.get("/", (req, res) => {
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