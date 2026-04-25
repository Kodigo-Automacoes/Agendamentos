const { pool } = require("../config/db");

async function getPoliticaContato({ empresa_id, canal_id, whatsapp_e164 }) {
  const r = await pool.query(
    `
    SELECT modo
    FROM crm.politica_contato_whatsapp
    WHERE empresa_id = $1
      AND canal_id = $2
      AND whatsapp_e164 = $3
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [empresa_id, canal_id, whatsapp_e164]
  );
  return r.rows[0]?.modo || null; // aceitar|ignorar|manual|null
}

module.exports = {
  getPoliticaContato,
};