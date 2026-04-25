// services/servicoResolver.service.js
// Resolve servico_id a partir do texto/nome extraído pela IA.

function normalizeToken(t) {
  return (t || '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function montarTermosBusca(nomeServico) {
  const original = normalizeToken(nomeServico);
  const termos = new Set();
  if (!original) return [];

  termos.add(original);

  // Mapeamentos principais para PT-BR no contexto de barbearia.
  if (/\bcorte\b|\bcabelo\b/.test(original)) {
    termos.add('corte');
    termos.add('cabelo');
    termos.add('corte de cabelo');
  }

  if (/\bbarba\b/.test(original)) {
    termos.add('barba');
  }

  if (/\bcombo\b/.test(original) || (/\bcorte\b/.test(original) && /\bbarba\b/.test(original))) {
    termos.add('combo');
    termos.add('corte + barba');
    termos.add('corte e barba');
    termos.add('corte barba');
  }

  return Array.from(termos);
}

module.exports = (pool) => ({
  /**
   * Busca serviço pelo nome (match parcial, case-insensitive).
   * @returns {{ id: string, nome: string } | null}
   */
  async resolverPorNome({ unidadeId, nomeServico }) {
    if (!nomeServico) return null;
    const termos = montarTermosBusca(nomeServico);
    if (!termos.length) return null;
    const likes = termos.map((t) => `%${t}%`);

    const sql = `
      SELECT DISTINCT s.id, s.nome,
        CASE
          WHEN lower(s.nome) = lower($2::text) THEN 0
          WHEN lower(s.nome) ILIKE '%' || lower($2::text) || '%' THEN 1
          ELSE 2
        END AS score
      FROM agenda.servico s
      JOIN agenda.profissional_servico ps ON ps.servico_id = s.id
      JOIN agenda.profissional p ON p.id = ps.profissional_id
      WHERE p.unidade_id = $1::int
        AND p.ativo = true
        AND lower(s.nome) ILIKE ANY($3::text[])
      ORDER BY score, s.nome
      LIMIT 1
    `;

    const { rows } = await pool.query(sql, [unidadeId, termos[0], likes]);
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
      WHERE p.unidade_id = $1::int
        AND p.ativo = true
      ORDER BY s.nome
    `;

    const { rows } = await pool.query(sql, [unidadeId]);
    return rows;
  },
});
