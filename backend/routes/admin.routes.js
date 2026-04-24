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
const fs = require("fs");
const path = require("path");
const router = express.Router();
const { pool } = require("../config/db");

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "migrations");

function send(res, status, payload) {
  return res.status(status).json(payload);
}

function maskEnv(v) {
  if (!v) return null;
  const s = String(v);
  if (s.length <= 8) return "***";
  return s.slice(0, 4) + "…" + s.slice(-3);
}

// ------------------------------------------------------------
// GET /api/admin/diagnostico — visão geral do que está OK / faltando
//
// Pra debugar o webhook em produção. Retorna:
//   - env relevante (mascarada)
//   - estado dos canais (instance_key, número, ativo)
//   - serviços + profissionais ativos da unidade default
//   - estado da Evolution API (conexão da instância)
// ------------------------------------------------------------
router.get("/api/admin/diagnostico", async (req, res) => {
  const empresaId = process.env.DEFAULT_EMPRESA_ID;
  const unidadeId = process.env.DEFAULT_UNIDADE_ID;

  const out = {
    env: {
      DB_HOST: process.env.DB_HOST,
      DB_NAME: process.env.DB_NAME,
      DEFAULT_EMPRESA_ID: empresaId || null,
      DEFAULT_UNIDADE_ID: unidadeId || null,
      AUTO_PROVISION_CANAL: process.env.AUTO_PROVISION_CANAL,
      EVOLUTION_BASE_URL: process.env.EVOLUTION_BASE_URL,
      EVOLUTION_INSTANCE_NAME: process.env.EVOLUTION_INSTANCE_NAME,
      EVOLUTION_API_KEY: maskEnv(process.env.EVOLUTION_API_KEY),
      EVOLUTION_SEND_ENABLED: process.env.EVOLUTION_SEND_ENABLED,
      EVOLUTION_AUTO_SEND: process.env.EVOLUTION_AUTO_SEND,
      OPENAI_API_KEY: maskEnv(process.env.OPENAI_API_KEY),
      OPENAI_MODEL: process.env.OPENAI_MODEL,
      PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
    },
    db: {},
    evolution: {},
    checklist: [],
  };

  try {
    out.db.canais = (await pool.query(
      `SELECT id, empresa_id, unidade_id, numero_e164, provedor, instance_key, ativo
         FROM core.canal_whatsapp ORDER BY ativo DESC, updated_at DESC`
    )).rows;

    if (empresaId && unidadeId) {
      out.db.empresa = (await pool.query("SELECT id, nome, ativo FROM core.empresa WHERE id=$1", [empresaId])).rows[0] || null;
      out.db.unidade = (await pool.query("SELECT id, nome FROM core.unidade WHERE id=$1", [unidadeId])).rows[0] || null;
      out.db.config_unidade = (await pool.query("SELECT * FROM agenda.config_unidade WHERE unidade_id=$1", [unidadeId])).rows[0] || null;
      out.db.funcionamento = (await pool.query("SELECT dow, abre, fecha, ativo FROM agenda.funcionamento_semanal WHERE unidade_id=$1 ORDER BY dow", [unidadeId])).rows;
      out.db.janelas_periodo = (await pool.query("SELECT periodo, inicio, fim FROM agenda.janela_periodo WHERE unidade_id=$1", [unidadeId])).rows;

      out.db.servicos = (await pool.query(
        `SELECT id, nome, duracao_padrao_min, preco_padrao, ativo FROM agenda.servico WHERE empresa_id=$1 ORDER BY nome`,
        [empresaId]
      )).rows;
      out.db.profissionais = (await pool.query(
        `SELECT id, nome, ativo FROM agenda.profissional WHERE empresa_id=$1 AND unidade_id=$2 ORDER BY nome`,
        [empresaId, unidadeId]
      )).rows;
      out.db.vinculos_servico_prof = (await pool.query(
        `SELECT ps.profissional_id, p.nome AS profissional, ps.servico_id, s.nome AS servico, ps.ativo
           FROM agenda.profissional_servico ps
           JOIN agenda.profissional p ON p.id = ps.profissional_id
           JOIN agenda.servico s ON s.id = ps.servico_id
          WHERE ps.empresa_id=$1 AND ps.unidade_id=$2`,
        [empresaId, unidadeId]
      )).rows;
      out.db.disponibilidade = (await pool.query(
        `SELECT profissional_id, dia_semana, hora_inicio, hora_fim, ativo
           FROM agenda.disponibilidade_semanal
          WHERE empresa_id=$1 AND unidade_id=$2 ORDER BY profissional_id, dia_semana`,
        [empresaId, unidadeId]
      )).rows;
    }
  } catch (err) {
    out.db.erro = err.message;
  }

  // Checklist humano
  const c = out.checklist;
  if (!out.env.DEFAULT_EMPRESA_ID) c.push("FALTA: DEFAULT_EMPRESA_ID no .env");
  if (!out.env.DEFAULT_UNIDADE_ID) c.push("FALTA: DEFAULT_UNIDADE_ID no .env");
  if (!out.env.EVOLUTION_API_KEY) c.push("FALTA: EVOLUTION_API_KEY no .env");
  if (!out.env.EVOLUTION_INSTANCE_NAME) c.push("FALTA: EVOLUTION_INSTANCE_NAME no .env");
  if (out.env.EVOLUTION_SEND_ENABLED && out.env.EVOLUTION_SEND_ENABLED !== "true") c.push("EVOLUTION_SEND_ENABLED não é 'true' — backend NÃO vai enviar resposta no WhatsApp");
  if (out.env.EVOLUTION_AUTO_SEND && out.env.EVOLUTION_AUTO_SEND !== "true") c.push("EVOLUTION_AUTO_SEND não é 'true' — backend só envia se o caller pedir");
  if (!out.env.OPENAI_API_KEY) c.push("AVISO: OPENAI_API_KEY ausente — IA cai no fallback determinístico (ainda funciona)");

  if (out.db.canais && !out.db.canais.find((k) => k.instance_key === process.env.EVOLUTION_INSTANCE_NAME)) {
    c.push(`FALTA: nenhum canal com instance_key='${process.env.EVOLUTION_INSTANCE_NAME}' (a auto-adoção tenta resolver no 1º webhook, mas se quiser pode rodar /api/admin/seed-demo)`);
  }
  if ((out.db.servicos || []).filter((s) => s.ativo).length === 0) {
    c.push("FALTA: nenhum serviço ativo — rode POST /api/admin/seed-demo");
  }
  if ((out.db.profissionais || []).filter((p) => p.ativo).length === 0) {
    c.push("FALTA: nenhum profissional ativo — rode POST /api/admin/seed-demo");
  }
  if ((out.db.vinculos_servico_prof || []).filter((v) => v.ativo).length === 0) {
    c.push("FALTA: nenhum vínculo profissional↔serviço ativo — rode POST /api/admin/seed-demo");
  }
  if (!out.db.config_unidade) c.push("FALTA: agenda.config_unidade — rode POST /api/admin/seed-demo");
  if ((out.db.disponibilidade || []).filter((d) => d.ativo).length === 0) {
    c.push("FALTA: nenhuma disponibilidade_semanal ativa — rode POST /api/admin/seed-demo");
  }
  if (c.length === 0) c.push("Tudo verde ✅ — webhook deve responder normalmente.");

  // Tenta consultar a Evolution
  try {
    const base = (process.env.EVOLUTION_BASE_URL || "").replace(/\/+$/, "");
    const apikey = process.env.EVOLUTION_API_KEY;
    const inst = process.env.EVOLUTION_INSTANCE_NAME;
    if (base && apikey && inst) {
      const r = await fetch(`${base}/instance/connectionState/${encodeURIComponent(inst)}`, {
        headers: { apikey, Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      out.evolution.connectionState = await r.json().catch(() => null);
      const wh = await fetch(`${base}/webhook/find/${encodeURIComponent(inst)}`, {
        headers: { apikey, Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      out.evolution.webhook = await wh.json().catch(() => null);
    } else {
      out.evolution.skipped = "Faltam EVOLUTION_BASE_URL/API_KEY/INSTANCE_NAME";
    }
  } catch (err) {
    out.evolution.erro = err.message;
  }

  return send(res, 200, out);
});

// ------------------------------------------------------------
// POST /api/admin/seed-demo — popula serviço/profissional/vínculo
// na unidade default. Idempotente. Equivale à migration 005.
// ------------------------------------------------------------
router.post("/api/admin/seed-demo", async (req, res) => {
  const empresaId = process.env.DEFAULT_EMPRESA_ID;
  const unidadeId = process.env.DEFAULT_UNIDADE_ID;
  if (!empresaId || !unidadeId) {
    return send(res, 400, { erro: "Configure DEFAULT_EMPRESA_ID e DEFAULT_UNIDADE_ID no .env antes." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) Config da unidade
    await client.query(
      `INSERT INTO agenda.config_unidade
         (unidade_id, timezone, intervalo_entre_atendimentos_min, passo_oferta_min, antecedencia_min, max_dias_futuro)
       VALUES ($1, 'America/Sao_Paulo', 10, 15, 60, 30)
       ON CONFLICT (unidade_id) DO NOTHING`,
      [unidadeId]
    );

    // 2) Funcionamento semanal (seg-sex 08-18, sáb 08-12, dom fechado)
    const dias = [
      [0, "00:00", "00:01", false],
      [1, "08:00", "18:00", true],
      [2, "08:00", "18:00", true],
      [3, "08:00", "18:00", true],
      [4, "08:00", "18:00", true],
      [5, "08:00", "18:00", true],
      [6, "08:00", "12:00", true],
    ];
    for (const [dow, abre, fecha, ativo] of dias) {
      await client.query(
        `INSERT INTO agenda.funcionamento_semanal (unidade_id, dow, abre, fecha, ativo)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (unidade_id, dow) DO UPDATE
           SET abre=EXCLUDED.abre, fecha=EXCLUDED.fecha, ativo=EXCLUDED.ativo`,
        [unidadeId, dow, abre, fecha, ativo]
      );
    }

    // 3) Janelas de período
    const periodos = [
      ["manha", "08:00", "12:00"],
      ["tarde", "13:00", "18:00"],
      ["noite", "18:00", "21:00"],
    ];
    for (const [periodo, ini, fim] of periodos) {
      await client.query(
        `INSERT INTO agenda.janela_periodo (unidade_id, periodo, inicio, fim)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (unidade_id, periodo) DO UPDATE
           SET inicio=EXCLUDED.inicio, fim=EXCLUDED.fim`,
        [unidadeId, periodo, ini, fim]
      );
    }

    // 4) Serviço
    const svc = await client.query(
      `INSERT INTO agenda.servico (empresa_id, nome, duracao_padrao_min, preco_padrao, ativo)
       VALUES ($1, 'Corte de cabelo', 30, 40, true)
       ON CONFLICT (empresa_id, nome) DO UPDATE
         SET ativo=true, duracao_padrao_min=EXCLUDED.duracao_padrao_min
       RETURNING id, nome`,
      [empresaId]
    );
    const servicoId = svc.rows[0].id;

    // 5) Profissional
    const prof = await client.query(
      `INSERT INTO agenda.profissional (empresa_id, unidade_id, nome, ativo)
       VALUES ($1, $2, 'Profissional Demo', true)
       ON CONFLICT (empresa_id, unidade_id, nome) DO UPDATE SET ativo=true
       RETURNING id, nome`,
      [empresaId, unidadeId]
    );
    const profissionalId = prof.rows[0].id;

    // 6) Vínculo
    await client.query(
      `INSERT INTO agenda.profissional_servico
         (empresa_id, unidade_id, profissional_id, servico_id, ativo)
       VALUES ($1,$2,$3,$4,true)
       ON CONFLICT (profissional_id, servico_id) DO UPDATE
         SET ativo=true, empresa_id=EXCLUDED.empresa_id, unidade_id=EXCLUDED.unidade_id`,
      [empresaId, unidadeId, profissionalId, servicoId]
    );

    // 7) Disponibilidade do profissional (seg-sáb)
    for (let dow = 1; dow <= 6; dow++) {
      const fim = dow === 6 ? "12:00" : "18:00";
      await client.query(
        `INSERT INTO agenda.disponibilidade_semanal
            (empresa_id, unidade_id, profissional_id, dia_semana, hora_inicio, hora_fim, ativo)
         SELECT $1,$2,$3,$4,'08:00'::time, $5::time, true
         WHERE NOT EXISTS (
           SELECT 1 FROM agenda.disponibilidade_semanal
            WHERE profissional_id=$3 AND dia_semana=$4
              AND hora_inicio='08:00'::time AND hora_fim=$5::time
         )`,
        [empresaId, unidadeId, profissionalId, dow, fim]
      );
    }

    await client.query("COMMIT");
    return send(res, 200, {
      ok: true,
      empresa_id: empresaId,
      unidade_id: unidadeId,
      servico_id: servicoId,
      profissional_id: profissionalId,
      msg: "Seed aplicado. Manda mensagem no WhatsApp pra testar.",
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[seed-demo]", err);
    return send(res, 500, { erro: err.message });
  } finally {
    client.release();
  }
});

// ------------------------------------------------------------
// POST /api/admin/migrate — roda os arquivos .sql de /migrations
// que ainda não foram aplicados (controle em integracoes.migracao_aplicada).
// Idempotente. Roda em ordem alfabética.
// ------------------------------------------------------------
router.post("/api/admin/migrate", async (req, res) => {
  const onlyFile = req.body?.only ? String(req.body.only) : null;
  try {
    // Tabela de controle (cria se não existir)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS integracoes.migracao_aplicada (
        nome TEXT PRIMARY KEY,
        aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql") && f !== "verify_schema.sql")
      .sort();

    const aplicadas = new Set(
      (await pool.query("SELECT nome FROM integracoes.migracao_aplicada")).rows.map((r) => r.nome)
    );

    const resultados = [];
    for (const file of files) {
      if (onlyFile && file !== onlyFile) continue;
      if (aplicadas.has(file) && !onlyFile) {
        resultados.push({ file, status: "skip (já aplicada)" });
        continue;
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          `INSERT INTO integracoes.migracao_aplicada (nome) VALUES ($1)
             ON CONFLICT (nome) DO UPDATE SET aplicada_em = now()`,
          [file]
        );
        await client.query("COMMIT");
        resultados.push({ file, status: "OK" });
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        resultados.push({ file, status: "ERRO", erro: err.message });
        if (!onlyFile) break; // para na primeira falha (sequência)
      } finally {
        client.release();
      }
    }

    return send(res, 200, { resultados });
  } catch (err) {
    return send(res, 500, { erro: err.message });
  }
});

// ------------------------------------------------------------
// GET /api/admin/whatsapp-debug?limit=20
// Mostra as últimas mensagens com payload completo, pra debugar o webhook.
// ------------------------------------------------------------
router.get("/api/admin/whatsapp-debug", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 200);
    const { rows } = await pool.query(`
      SELECT m.id, m.created_at, m.direcao, m.message_id, m.message_type, m.texto,
             c.whatsapp_e164 AS cliente_whatsapp,
             m.payload->'data'->'key'->>'fromMe' AS from_me,
             m.payload->'data'->'key'->>'remoteJid' AS remote_jid,
             m.payload->>'instance' AS instance
        FROM integracoes.whatsapp_mensagem m
        LEFT JOIN crm.cliente c ON c.id = m.cliente_id
       ORDER BY m.created_at DESC
       LIMIT $1
    `, [limit]);
    return send(res, 200, rows);
  } catch (err) {
    return send(res, 500, { erro: err.message });
  }
});

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
        e.id, e.codigo, e.nome, e.ativo, e.created_at,
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
