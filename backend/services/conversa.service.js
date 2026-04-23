const { pool } = require("../config/db");

async function getOrCreateConversa({ empresa_id, unidade_id, canal_id, cliente_id }) {
  const r = await pool.query(
    `SELECT * FROM integracoes.get_or_create_conversa_estado($1,$2,$3,$4)`,
    [empresa_id, unidade_id, canal_id, cliente_id]
  );
  return r.rows[0];
}

async function atualizarConversa(conversa_id, patch) {
  const fields = [];
  const values = [];
  let i = 1;

  for (const [k, v] of Object.entries(patch)) {
    fields.push(`${k} = $${i++}`);
    values.push(v);
  }

  if (!fields.length) return;

  values.push(conversa_id);
  await pool.query(
    `UPDATE integracoes.conversa_estado SET ${fields.join(", ")} WHERE id = $${i}`,
    values
  );
}

module.exports = {
  getOrCreateConversa,
  atualizarConversa,
};