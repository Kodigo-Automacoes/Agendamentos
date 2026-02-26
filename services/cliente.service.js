const { pool } = require("../config/db");

async function normalizarE164(raw) {
  const r = await pool.query(`SELECT crm.normalizar_whatsapp_e164($1) AS e164`, [raw]);
  return r.rows[0]?.e164 || raw;
}

async function getOrCreateClienteId({ empresa_id, nome, whatsapp_e164 }) {
  const r = await pool.query(
    `SELECT crm.get_or_create_cliente($1,$2,$3) AS cliente_id`,
    [empresa_id, nome || null, whatsapp_e164]
  );
  return r.rows[0]?.cliente_id;
}

module.exports = {
  normalizarE164,
  getOrCreateClienteId,
};