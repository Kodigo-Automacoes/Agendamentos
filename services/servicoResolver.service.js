// services/servicoResolver.service.js
// Resolve servico_id a partir do texto/nome extraído pela IA.

module.exports = (pool) => ({
  /**
   * Busca serviço pelo nome (match parcial, case-insensitive).
   * @returns {{ id: string, nome: string } | null}
   */
  async resolverPorNome({ unidadeId, nomeServico }) {
    if (!nomeServico) return null;

    // Match parcial por ILIKE — funciona sem extensão unaccent.
    // Se tiver unaccent instalado no PG, trocar para:
    //   unaccent(lower(s.nome)) ILIKE '%' || unaccent(lower($2)) || '%'
    const sql = `
      SELECT DISTINCT s.id, s.nome
      FROM agenda.servico s
      JOIN agenda.profissional_servico ps ON ps.servico_id = s.id
      JOIN agenda.profissional p ON p.id = ps.profissional_id
      WHERE p.unidade_id = $1::uuid
        AND p.ativo = true
        AND lower(s.nome) ILIKE '%' || lower($2::text) || '%'
      ORDER BY s.nome
      LIMIT 1
    `;

    const { rows } = await pool.query(sql, [unidadeId, nomeServico.trim()]);
    return rows[0] || null;
  },

  /**
   * Lista todos os serviços disponíveis na unidade (via profissionais ativos).
   * @returns {Array<{ id: string, nome: string }>}
   */
  async listarServicosDaUnidade({ unidadeId }) {
    const sql = `
      SELECT DISTINCT s.id, s.nome
      FROM agenda.servico s
      JOIN agenda.profissional_servico ps ON ps.servico_id = s.id
      JOIN agenda.profissional p ON p.id = ps.profissional_id
      WHERE p.unidade_id = $1::uuid
        AND p.ativo = true
      ORDER BY s.nome
    `;

    const { rows } = await pool.query(sql, [unidadeId]);
    return rows;
  },
});
