// routes/app.routes.js
// ============================================================
// Endpoints do Painel do Cliente (dono da empresa/barbearia).
// Todas as rotas ficam atrás do middleware auth (x-api-key).
//
// O MVP é single-tenant: usa DEFAULT_EMPRESA_ID / DEFAULT_UNIDADE_ID
// do .env como contexto. Em produção, derivar do usuário autenticado.
// ============================================================

const express = require("express");
const router = express.Router();
const { pool } = require("../config/db");

function empresaCtx() {
  return {
    empresa_id: process.env.DEFAULT_EMPRESA_ID,
    unidade_id: process.env.DEFAULT_UNIDADE_ID,
  };
}

function send(res, status, payload) {
  return res.status(status).json(payload);
}

// ------------------------------------------------------------
// GET /api/app/context — empresa + unidade atual + timezone
// ------------------------------------------------------------
router.get("/api/app/context", async (req, res) => {
  try {
    const { empresa_id, unidade_id } = empresaCtx();
    if (!empresa_id || !unidade_id) {
      return send(res, 500, { erro: "DEFAULT_EMPRESA_ID/DEFAULT_UNIDADE_ID não configurados no .env" });
    }
    const [emp, uni, cfg] = await Promise.all([
      pool.query("SELECT id, nome, created_at FROM core.empresa WHERE id = $1", [empresa_id]),
      pool.query("SELECT id, empresa_id, nome FROM core.unidade WHERE id = $1", [unidade_id]),
      pool.query("SELECT timezone FROM agenda.config_unidade WHERE unidade_id = $1", [unidade_id]),
    ]);
    return send(res, 200, {
      empresa: emp.rows[0] || null,
      unidade: uni.rows[0] || null,
      timezone: cfg.rows[0]?.timezone || "America/Sao_Paulo",
    });
  } catch (err) {
    console.error("[api/app/context]", err);
    return send(res, 500, { erro: err.message });
  }
});

// ------------------------------------------------------------
// GET /api/app/dashboard/stats — estatísticas do dashboard
// ------------------------------------------------------------
router.get("/api/app/dashboard/stats", async (req, res) => {
  try {
    const { empresa_id, unidade_id } = empresaCtx();

    const sql = `
      WITH base AS (
        SELECT * FROM agenda.agendamento
        WHERE empresa_id = $1 AND unidade_id = $2
      ),
      hoje AS (
        SELECT COUNT(*)::int AS n
        FROM base
        WHERE status = 'confirmado'
          AND inicio::date = CURRENT_DATE
      ),
      semana AS (
        SELECT COUNT(*)::int AS n
        FROM base
        WHERE status = 'confirmado'
          AND inicio::date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
      ),
      canc AS (
        SELECT COUNT(*)::int AS n
        FROM base
        WHERE status = 'cancelado'
          AND COALESCE(cancelado_em, updated_at)::date >= date_trunc('month', CURRENT_DATE)::date
      ),
      fila AS (
        SELECT COUNT(*)::int AS n
        FROM agenda.fila_espera
        WHERE empresa_id = $1 AND unidade_id = $2 AND status = 'ativa'
      )
      SELECT
        (SELECT n FROM hoje) AS agendamentos_hoje,
        (SELECT n FROM semana) AS agendamentos_semana,
        (SELECT n FROM canc) AS cancelamentos_mes,
        (SELECT n FROM fila) AS fila_espera
    `;
    const { rows } = await pool.query(sql, [empresa_id, unidade_id]);
    return send(res, 200, rows[0] || {
      agendamentos_hoje: 0, agendamentos_semana: 0, cancelamentos_mes: 0, fila_espera: 0,
    });
  } catch (err) {
    console.error("[api/app/dashboard/stats]", err);
    return send(res, 500, { erro: err.message });
  }
});

// ------------------------------------------------------------
// GET /api/app/agendamentos?range=hoje|semana|YYYY-MM-DD
// ------------------------------------------------------------
router.get("/api/app/agendamentos", async (req, res) => {
  try {
    const { empresa_id, unidade_id } = empresaCtx();
    const range = String(req.query.range || "hoje").toLowerCase();

    let whereDate = "a.inicio::date = CURRENT_DATE";
    if (range === "semana") {
      whereDate = "a.inicio::date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'";
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(range)) {
      whereDate = `a.inicio::date = '${range}'::date`;
    }

    const sql = `
      SELECT a.id, a.codigo, a.inicio, a.fim, a.status, a.origem, a.preco_previsto, a.preco_final,
             a.cliente_id, c.codigo AS cliente_codigo, c.nome AS cliente_nome, c.whatsapp_e164,
             a.profissional_id, p.codigo AS profissional_codigo, p.nome AS profissional_nome,
             a.servico_id, s.codigo AS servico_codigo, s.nome AS servico_nome, s.duracao_padrao_min
      FROM agenda.agendamento a
      JOIN crm.cliente c ON c.id = a.cliente_id
      JOIN agenda.profissional p ON p.id = a.profissional_id
      JOIN agenda.servico s ON s.id = a.servico_id
      WHERE a.empresa_id = $1 AND a.unidade_id = $2
        AND ${whereDate}
      ORDER BY a.inicio ASC
      LIMIT 200
    `;
    const { rows } = await pool.query(sql, [empresa_id, unidade_id]);
    return send(res, 200, rows);
  } catch (err) {
    console.error("[api/app/agendamentos]", err);
    return send(res, 500, { erro: err.message });
  }
});

// ------------------------------------------------------------
// Serviços — CRUD
// ------------------------------------------------------------
router.get("/api/app/servicos", async (req, res) => {
  try {
    const { empresa_id } = empresaCtx();
    const { rows } = await pool.query(
      `SELECT id, codigo, nome, duracao_padrao_min, preco_padrao, ativo, created_at
       FROM agenda.servico
       WHERE empresa_id = $1
       ORDER BY ativo DESC, codigo ASC`,
      [empresa_id]
    );
    return send(res, 200, rows);
  } catch (err) {
    console.error("[api/app/servicos GET]", err);
    return send(res, 500, { erro: err.message });
  }
});

router.post("/api/app/servicos", async (req, res) => {
  try {
    const { empresa_id } = empresaCtx();
    const { nome, duracao_padrao_min, preco_padrao } = req.body || {};
    if (!nome) return send(res, 400, { erro: "Campo obrigatório: nome" });
    const { rows } = await pool.query(
      `INSERT INTO agenda.servico (empresa_id, nome, duracao_padrao_min, preco_padrao, ativo)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (empresa_id, nome) DO UPDATE
         SET duracao_padrao_min = EXCLUDED.duracao_padrao_min,
             preco_padrao       = EXCLUDED.preco_padrao,
             ativo              = true,
             updated_at         = now()
       RETURNING id, codigo, nome, duracao_padrao_min, preco_padrao, ativo`,
      [empresa_id, String(nome).trim(), Number(duracao_padrao_min) || 30, Number(preco_padrao) || 0]
    );
    return send(res, 200, rows[0]);
  } catch (err) {
    console.error("[api/app/servicos POST]", err);
    return send(res, 500, { erro: err.message });
  }
});

router.put("/api/app/servicos/:id", async (req, res) => {
  try {
    const { empresa_id } = empresaCtx();
    const { id } = req.params;
    const body = req.body || {};
    const { rows } = await pool.query(
      `UPDATE agenda.servico
          SET nome = COALESCE($3, nome),
              duracao_padrao_min = COALESCE($4, duracao_padrao_min),
              preco_padrao = COALESCE($5, preco_padrao),
              ativo = COALESCE($6, ativo),
              updated_at = now()
        WHERE id = $1 AND empresa_id = $2
        RETURNING id, codigo, nome, duracao_padrao_min, preco_padrao, ativo`,
      [
        id, empresa_id,
        body.nome ?? null,
        body.duracao_padrao_min ?? null,
        body.preco_padrao ?? null,
        body.ativo ?? null,
      ]
    );
    if (!rows.length) return send(res, 404, { erro: "Serviço não encontrado" });
    return send(res, 200, rows[0]);
  } catch (err) {
    console.error("[api/app/servicos PUT]", err);
    return send(res, 500, { erro: err.message });
  }
});

router.delete("/api/app/servicos/:id", async (req, res) => {
  try {
    const { empresa_id } = empresaCtx();
    const { id } = req.params;
    // Soft delete: marca como inativo (mantém integridade referencial com agendamentos antigos)
    const { rowCount } = await pool.query(
      `UPDATE agenda.servico SET ativo = false, updated_at = now()
        WHERE id = $1 AND empresa_id = $2`,
      [id, empresa_id]
    );
    if (!rowCount) return send(res, 404, { erro: "Serviço não encontrado" });
    return send(res, 200, { ok: true });
  } catch (err) {
    console.error("[api/app/servicos DELETE]", err);
    return send(res, 500, { erro: err.message });
  }
});

// ------------------------------------------------------------
// Profissionais — CRUD
// ------------------------------------------------------------
router.get("/api/app/profissionais", async (req, res) => {
  try {
    const { empresa_id, unidade_id } = empresaCtx();
    const { rows } = await pool.query(
      `
      SELECT
        p.id, p.codigo, p.nome, p.ativo, p.created_at,
        COALESCE(
          (SELECT array_agg(s.nome ORDER BY s.nome)
           FROM agenda.profissional_servico ps
           JOIN agenda.servico s ON s.id = ps.servico_id
           WHERE ps.profissional_id = p.id AND ps.ativo = true), ARRAY[]::text[]
        ) AS servicos,
        (SELECT COUNT(*)::int FROM agenda.agendamento a
          WHERE a.profissional_id = p.id
            AND a.status = 'confirmado'
            AND a.inicio >= date_trunc('month', CURRENT_DATE)) AS agend_mes
      FROM agenda.profissional p
      WHERE p.empresa_id = $1 AND p.unidade_id = $2
      ORDER BY p.ativo DESC, p.codigo ASC
      `,
      [empresa_id, unidade_id]
    );
    return send(res, 200, rows);
  } catch (err) {
    console.error("[api/app/profissionais GET]", err);
    return send(res, 500, { erro: err.message });
  }
});

router.post("/api/app/profissionais", async (req, res) => {
  try {
    const { empresa_id, unidade_id } = empresaCtx();
    const { nome } = req.body || {};
    if (!nome) return send(res, 400, { erro: "Campo obrigatório: nome" });
    const { rows } = await pool.query(
      `INSERT INTO agenda.profissional (empresa_id, unidade_id, nome, ativo)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (empresa_id, unidade_id, nome) DO UPDATE
         SET ativo = true, updated_at = now()
       RETURNING id, codigo, nome, ativo`,
      [empresa_id, unidade_id, String(nome).trim()]
    );
    return send(res, 200, rows[0]);
  } catch (err) {
    console.error("[api/app/profissionais POST]", err);
    return send(res, 500, { erro: err.message });
  }
});

router.put("/api/app/profissionais/:id", async (req, res) => {
  try {
    const { empresa_id } = empresaCtx();
    const { id } = req.params;
    const body = req.body || {};
    const { rows } = await pool.query(
      `UPDATE agenda.profissional
          SET nome = COALESCE($3, nome),
              ativo = COALESCE($4, ativo),
              updated_at = now()
        WHERE id = $1 AND empresa_id = $2
        RETURNING id, codigo, nome, ativo`,
      [id, empresa_id, body.nome ?? null, body.ativo ?? null]
    );
    if (!rows.length) return send(res, 404, { erro: "Profissional não encontrado" });
    return send(res, 200, rows[0]);
  } catch (err) {
    console.error("[api/app/profissionais PUT]", err);
    return send(res, 500, { erro: err.message });
  }
});

router.delete("/api/app/profissionais/:id", async (req, res) => {
  try {
    const { empresa_id } = empresaCtx();
    const { id } = req.params;
    const { rowCount } = await pool.query(
      `UPDATE agenda.profissional SET ativo = false, updated_at = now()
        WHERE id = $1 AND empresa_id = $2`,
      [id, empresa_id]
    );
    if (!rowCount) return send(res, 404, { erro: "Profissional não encontrado" });
    return send(res, 200, { ok: true });
  } catch (err) {
    console.error("[api/app/profissionais DELETE]", err);
    return send(res, 500, { erro: err.message });
  }
});

// ------------------------------------------------------------
// Clientes (via CRM + estatísticas agregadas)
// ------------------------------------------------------------
router.get("/api/app/clientes", async (req, res) => {
  try {
    const { empresa_id } = empresaCtx();
    const { rows } = await pool.query(
      `
      SELECT c.id, c.codigo, c.nome, c.whatsapp_e164, c.ativo, c.created_at,
             COALESCE(agg.total_visitas, 0) AS total_visitas,
             agg.ultima_visita,
             agg.ticket_medio
      FROM crm.cliente c
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS total_visitas,
          MAX(a.inicio) AS ultima_visita,
          ROUND(AVG(COALESCE(a.preco_final, a.preco_previsto))::numeric, 2) AS ticket_medio
        FROM agenda.agendamento a
        WHERE a.cliente_id = c.id
          AND a.empresa_id = c.empresa_id
          AND a.status IN ('confirmado', 'realizado')
      ) agg ON true
      WHERE c.empresa_id = $1
      ORDER BY agg.ultima_visita DESC NULLS LAST, c.codigo ASC
      LIMIT 500
      `,
      [empresa_id]
    );
    return send(res, 200, rows);
  } catch (err) {
    console.error("[api/app/clientes]", err);
    return send(res, 500, { erro: err.message });
  }
});

// ------------------------------------------------------------
// Fila de espera
// ------------------------------------------------------------
router.get("/api/app/fila-espera", async (req, res) => {
  try {
    const { empresa_id, unidade_id } = empresaCtx();
    const { rows } = await pool.query(
      `
      SELECT f.id, f.status, f.prioridade, f.janela_inicio, f.janela_fim,
             c.nome AS cliente_nome, c.whatsapp_e164,
             s.nome AS servico_nome,
             p.nome AS profissional_nome,
             f.created_at
      FROM agenda.fila_espera f
      JOIN crm.cliente c ON c.id = f.cliente_id
      JOIN agenda.servico s ON s.id = f.servico_id
      LEFT JOIN agenda.profissional p ON p.id = f.profissional_id
      WHERE f.empresa_id = $1 AND f.unidade_id = $2 AND f.status = 'ativa'
      ORDER BY f.prioridade ASC, f.created_at ASC
      `,
      [empresa_id, unidade_id]
    );
    return send(res, 200, rows);
  } catch (err) {
    console.error("[api/app/fila-espera]", err);
    return send(res, 500, { erro: err.message });
  }
});

module.exports = router;
