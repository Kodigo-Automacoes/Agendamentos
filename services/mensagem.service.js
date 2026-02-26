const { pool } = require("../config/db");

async function logMensagem({
  empresa_id,
  unidade_id,
  canal_id,
  cliente_id,
  direcao,
  message_id,
  message_type,
  texto,
  payload,
}) {
  await pool.query(
    `
    INSERT INTO integracoes.whatsapp_mensagem
      (empresa_id, unidade_id, canal_id, cliente_id, direcao, message_id, message_type, texto, payload)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `,
    [
      empresa_id,
      unidade_id,
      canal_id,
      cliente_id || null,
      direcao,
      message_id || null,
      message_type || "text",
      texto || null,
      payload ? JSON.stringify(payload) : null,
    ]
  );
}

module.exports = {
  logMensagem,
};