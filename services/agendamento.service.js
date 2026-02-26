// services/agendamento.service.js
// Controller de endpoints REST para intenção/confirmação de agendamento.
// NOTA: A lógica real está em agenda.service.js (factory).
//       Este arquivo expõe handlers Express para as rotas /criar-intencao e /confirmar-intencao.

const { pool } = require("../config/db");
const agendaService = require("./agenda.service")(pool);

async function criarIntencao(req, res) {
  try {
    const {
      empresa_id,
      unidade_id,
      cliente_id,
      profissional_id,
      servico_id,
      inicio_sugerido,
      resumo_ia,
      contexto,
    } = req.body;

    const result = await agendaService.criarIntencao({
      empresaId: empresa_id,
      unidadeId: unidade_id,
      clienteId: cliente_id,
      profissionalId: profissional_id,
      servicoId: servico_id,
      inicioISO: inicio_sugerido,
      resumoIA: resumo_ia || {},
      contexto: contexto || {},
    });

    res.json(result || { erro: "Não foi possível criar intenção" });
  } catch (err) {
    console.error("[criarIntencao]", err);
    res.status(500).json({ erro: err.message });
  }
}

async function confirmarIntencao(req, res) {
  try {
    const { intencao_id } = req.body;

    const agendamento_id = await agendaService.confirmarIntencao({
      intencaoId: intencao_id,
    });

    res.json({ agendamento_id });
  } catch (err) {
    console.error("[confirmarIntencao]", err);
    res.status(500).json({ erro: err.message });
  }
}

module.exports = {
  criarIntencao,
  confirmarIntencao,
};