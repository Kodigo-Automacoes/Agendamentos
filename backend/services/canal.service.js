const { pool } = require("../config/db");

async function resolverCanalWhatsapp({ to_numero_e164, provedor, instance_key }) {
  const r = await pool.query(
    `SELECT * FROM core.resolver_canal_whatsapp($1,$2,$3)`,
    [to_numero_e164 || null, provedor || null, instance_key || null]
  );
  return r.rows[0] || null;
}

async function autoProvisionarCanal({ to_numero_e164, provedor, instance_key }) {
  const enabled = String(process.env.AUTO_PROVISION_CANAL || "false") === "true";
  if (!enabled) return null;

  const empresaId = process.env.DEFAULT_EMPRESA_ID;
  const unidadeId = process.env.DEFAULT_UNIDADE_ID;
  if (!empresaId || !unidadeId) return null;

    const up = await pool.query(
    `SELECT core.upsert_canal_whatsapp($1::uuid,$2::uuid,$3,$4,$5) AS canal_id`,
    [empresaId, unidadeId, provedor || "evolution", instance_key || null, to_numero_e164 || null]
    );

  const canal_id = up.rows[0]?.canal_id;
  if (!canal_id) return null;

  return { canal_id, empresa_id: empresaId, unidade_id: unidadeId };
}

module.exports = {
  resolverCanalWhatsapp,
  autoProvisionarCanal,
};