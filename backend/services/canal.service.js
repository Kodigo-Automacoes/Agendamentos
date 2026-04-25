const { pool } = require("../config/db");

async function resolverCanalWhatsapp({ to_numero_e164, provedor, instance_key }) {
  const r = await pool.query(
    `SELECT * FROM core.resolver_canal_whatsapp($1,$2,$3)`,
    [to_numero_e164 || null, provedor || null, instance_key || null]
  );
  return r.rows[0] || null;
}

/**
 * Auto-provisão de canal quando o webhook chega para uma instance_key
 * que ainda não está cadastrada.
 *
 * Estratégia (em ordem):
 *   1. Existe canal ativo da empresa+unidade default no mesmo provedor?
 *      → adota (UPDATE instance_key) — preserva o numero_e164 já cadastrado.
 *   2. Tem numero_e164 no payload? → upsert pela função do banco.
 *   3. Senão, cria canal com numero_e164 placeholder ("auto:<instance_key>")
 *      — assim a constraint NOT NULL é respeitada e dá pra editar depois.
 */
async function autoProvisionarCanal({ to_numero_e164, provedor, instance_key }) {
  const enabled = String(process.env.AUTO_PROVISION_CANAL || "false") === "true";
  if (!enabled) return null;

  const empresaId = process.env.DEFAULT_EMPRESA_ID;
  const unidadeId = process.env.DEFAULT_UNIDADE_ID;
  if (!empresaId || !unidadeId) return null;

  const provedorNorm = provedor || "evolution";

  // 1) Adoção: tenta achar canal já cadastrado da empresa/unidade default
  //    no mesmo provedor que ainda não tem instance_key (ou tem outra).
  if (instance_key) {
    const adopt = await pool.query(
      `
      WITH alvo AS (
        SELECT id FROM core.canal_whatsapp
         WHERE empresa_id = $1::int
           AND unidade_id = $2::int
           AND provedor   = $3
           AND ativo      = true
         ORDER BY (instance_key IS NULL) DESC, updated_at DESC
         LIMIT 1
      )
      UPDATE core.canal_whatsapp c
         SET instance_key = $4,
             updated_at   = now()
        FROM alvo
       WHERE c.id = alvo.id
      RETURNING c.id, c.empresa_id, c.unidade_id
      `,
      [empresaId, unidadeId, provedorNorm, instance_key]
    );
    if (adopt.rows[0]) {
      return {
        canal_id: adopt.rows[0].id,
        empresa_id: adopt.rows[0].empresa_id,
        unidade_id: adopt.rows[0].unidade_id,
      };
    }
  }

  // 2) Caminho padrão: tem o número, usa a função upsert do banco.
  const numeroFinal = to_numero_e164 || (instance_key ? `auto:${instance_key}` : null);
  if (!numeroFinal) {
    // Sem número e sem instance_key — não dá pra criar nada determinístico.
    return null;
  }

  const up = await pool.query(
    `SELECT core.upsert_canal_whatsapp($1::int,$2::int,$3,$4,$5) AS canal_id`,
    [empresaId, unidadeId, provedorNorm, instance_key || null, numeroFinal]
  );

  const canal_id = up.rows[0]?.canal_id;
  if (!canal_id) return null;

  return { canal_id, empresa_id: empresaId, unidade_id: unidadeId };
}

module.exports = {
  resolverCanalWhatsapp,
  autoProvisionarCanal,
};
