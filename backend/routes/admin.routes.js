// routes/admin.routes.js
// ============================================================
// Endpoints do Painel Super Admin (dono do SaaS).
// Todas as rotas ficam atrás do middleware auth (x-api-key).
//
// Observação: autorização "super admin" real deve checar o perfil
// em core.usuario_empresa. Como o MVP ainda não tem sessão de
// usuário, basta a x-api-key global.
// ============================================================

const express = require("express");
const router = express.Router();
const { pool } = require("../config/db");

function send(res, status, payload) {
  return res.status(status).json(payload);
}

// ------------------------------------------------------------
// GET /api/admin/dashboard/stats — métricas globais do SaaS
// ------------------------------------------------------------
router.get("/api/admin/dashboard/stats", async (req, res) => {
  try {
    const sql = `
      SELECT
        (SELECT COUNT(*)::int FROM core.empresa WHERE ativo = true) AS empresas_ativas,
        (SELECT COUNT(*)::int FROM core.empresa) AS empresas_total,
        (SELECT COUNT(*)::int FROM agenda.agendamento
          WHERE inicio >= date_trunc('month', CURRENT_DATE)
            AND status IN ('confirmado', 'realizado')) AS agendamentos_mes,
        (SELECT COUNT(*)::int FROM crm.cliente WHERE ativo = true) AS clientes_total,
        (SELECT COUNT(*)::int FROM core.canal_whatsapp WHERE ativo = true) AS canais_ativos,
        (SELECT COUNT(*)::int FROM core.canal_whatsapp) AS canais_total
    `;
    const { rows } = await pool.query(sql);
    return send(res, 200, rows[0]);
  } catch (err) {
    console.error("[api/admin/dashboard/stats]", err);
    return send(res, 500, { erro: err.message });
  }
});

// ------------------------------------------------------------
// GET /api/admin/empresas — lista empresas com métricas agregadas
// ------------------------------------------------------------
router.get("/api/admin/empresas", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        e.id, e.nome, e.ativo, e.created_at,
        (SELECT COUNT(*)::int FROM core.unidade u WHERE u.empresa_id = e.id) AS unidades,
        (SELECT COUNT(*)::int FROM agenda.profissional p WHERE p.empresa_id = e.id AND p.ativo = true) AS profissionais,
        (SELECT COUNT(*)::int FROM agenda.agendamento a
           WHERE a.empresa_id = e.id
             AND a.inicio >= date_trunc('month', CURRENT_DATE)
             AND a.status IN ('confirmado','realizado')) AS agendamentos_mes,
        (SELECT COUNT(*)::int FROM core.canal_whatsapp c WHERE c.empresa_id = e.id AND c.ativo = true) AS canais_ativos,
        NULL::text AS email
      FROM core.empresa e
      ORDER BY e.ativo DESC, e.nome ASC
    `);
    return send(res, 200, rows);
  } catch (err) {
    console.error("[api/admin/empresas GET]", err);
    return send(res, 500, { erro: err.message });
  }
});

router.post("/api/admin/empresas", async (req, res) => {
  try {
    const { nome } = req.body || {};
    if (!nome) return send(res, 400, { erro: "Campo obrigatório: nome" });
    const { rows } = await pool.query(
      `INSERT INTO core.empresa (nome, ativo) VALUES ($1, true)
       RETURNING id, nome, ativo`,
      [String(nome).trim()]
    );
    return send(res, 200, rows[0]);
  } catch (err) {
    console.error("[api/admin/empresas POST]", err);
    return send(res, 500, { erro: err.message });
  }
});

router.put("/api/admin/empresas/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const { rows } = await pool.query(
      `UPDATE core.empresa
          SET nome = COALESCE($2, nome),
              ativo = COALESCE($3, ativo),
              updated_at = now()
        WHERE id = $1
        RETURNING id, nome, ativo`,
      [id, body.nome ?? null, body.ativo ?? null]
    );
    if (!rows.length) return send(res, 404, { erro: "Empresa não encontrada" });
    return send(res, 200, rows[0]);
  } catch (err) {
    console.error("[api/admin/empresas PUT]", err);
    return send(res, 500, { erro: err.message });
  }
});

// ------------------------------------------------------------
// GET /api/admin/usuarios — lista usuários com empresa associada
// ------------------------------------------------------------
router.get("/api/admin/usuarios", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        u.id, u.empresa_id, u.unidade_id, u.auth_user_id, u.perfil, u.ativo,
        u.created_at, u.updated_at,
        e.nome AS empresa_nome
      FROM core.usuario_empresa u
      LEFT JOIN core.empresa e ON e.id = u.empresa_id
      ORDER BY u.ativo DESC, e.nome, u.perfil
      LIMIT 500
    `);
    return send(res, 200, rows);
  } catch (err) {
    console.error("[api/admin/usuarios GET]", err);
    return send(res, 500, { erro: err.message });
  }
});

// ------------------------------------------------------------
// GET /api/admin/canais — lista canais WhatsApp (provedores)
// ------------------------------------------------------------
router.get("/api/admin/canais", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.id, c.empresa_id, e.nome AS empresa_nome,
             c.unidade_id, c.numero_e164, c.provedor, c.instance_key, c.ativo,
             c.created_at, c.updated_at
      FROM core.canal_whatsapp c
      LEFT JOIN core.empresa e ON e.id = c.empresa_id
      ORDER BY c.ativo DESC, e.nome, c.numero_e164
    `);
    return send(res, 200, rows);
  } catch (err) {
    console.error("[api/admin/canais GET]", err);
    return send(res, 500, { erro: err.message });
  }
});

// ------------------------------------------------------------
// GET /api/admin/logs — últimas mensagens WhatsApp recebidas/enviadas
// (serve como "logs & auditoria" no painel admin)
// ------------------------------------------------------------
router.get("/api/admin/logs", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const { rows } = await pool.query(`
      SELECT m.id, m.created_at, m.direcao, m.message_type, m.texto,
             e.nome AS empresa_nome, c.whatsapp_e164 AS cliente_whatsapp
      FROM integracoes.whatsapp_mensagem m
      LEFT JOIN core.empresa e ON e.id = m.empresa_id
      LEFT JOIN crm.cliente c ON c.id = m.cliente_id
      ORDER BY m.created_at DESC
      LIMIT $1
    `, [limit]);
    return send(res, 200, rows);
  } catch (err) {
    console.error("[api/admin/logs GET]", err);
    return send(res, 500, { erro: err.message });
  }
});

module.exports = router;
