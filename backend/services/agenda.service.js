// services/agenda.service.js
// Chamadas ao schema agenda no Postgres (horários livres, intenções, confirmação).

module.exports = (pool) => ({
  async listarHorariosLivresUnidade({
    unidadeId,
    profissionalId,
    servicoId,
    dataISO,      // 'YYYY-MM-DD'
    periodo,      // 'manha' | 'tarde' | 'noite'
    limite = 10,
  }) {
    const sql = `
      SELECT inicio, fim
      FROM agenda.listar_horarios_livres_unidade(
        $1::int,   -- unidade_id
        $2::int,   -- profissional_id
        $3::int,   -- servico_id
        $4::date,  -- data
        $5::agenda.periodo_agenda, -- periodo
        $6::int    -- limite
      )
      ORDER BY inicio
    `;

    const { rows } = await pool.query(sql, [
      unidadeId,
      profissionalId,
      servicoId,
      dataISO,
      periodo,
      limite,
    ]);

    return rows; // [{inicio, fim}, ...]
  },

  async criarIntencao({
    empresaId,
    unidadeId,
    clienteId,
    profissionalId,
    servicoId,
    inicioISO, // timestamptz ISO string
    resumoIA = {},
    contexto = {},
  }) {
    const sql = `
      SELECT *
      FROM agenda.criar_intencao_agendamento(
        $1::int,   -- empresa_id
        $2::int,   -- unidade_id
        $3::int,   -- cliente_id
        $4::int,   -- profissional_id
        $5::int,   -- servico_id
        $6::timestamptz, -- inicio_sugerido
        $7::text,  -- resumo_ia (texto no schema, armazena JSON serializado)
        $8::jsonb  -- contexto
      )
    `;

    const { rows } = await pool.query(sql, [
      empresaId,
      unidadeId,
      clienteId,
      profissionalId,
      servicoId,
      inicioISO,
      JSON.stringify(resumoIA),
      JSON.stringify(contexto),
    ]);

    return rows[0] || null;
  },

  async confirmarIntencao({ intencaoId }) {
    const sql = `SELECT agenda.confirmar_intencao_agendamento($1::int) AS agendamento_id`;
    const { rows } = await pool.query(sql, [intencaoId]);
    return rows[0]?.agendamento_id ?? null;
  },

  /**
   * Cancela uma intenção pendente, liberando o slot reservado.
   * @returns {boolean} true se cancelou, false se já estava cancelada/confirmada.
   */
  async cancelarIntencao({ intencaoId }) {
    if (!intencaoId) return false;
    const sql = `SELECT agenda.cancelar_intencao_agendamento($1::int) AS cancelada`;
    const { rows } = await pool.query(sql, [intencaoId]);
    return rows[0]?.cancelada ?? false;
  },

  /**
   * Busca o timezone configurado para a unidade.
   * @returns {string} IANA timezone (default: 'America/Sao_Paulo')
   */
  async getTimezoneUnidade(unidadeId) {
    const sql = `SELECT timezone FROM agenda.config_unidade WHERE unidade_id = $1::int LIMIT 1`;
    const { rows } = await pool.query(sql, [unidadeId]);
    return rows[0]?.timezone || 'America/Sao_Paulo';
  },
});