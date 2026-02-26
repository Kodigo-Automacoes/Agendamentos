// services/profissionalResolver.service.js
// Busca profissionais ativos que atendem determinado serviço na unidade.

module.exports = (pool) => ({
  async listarProfissionaisPorServico({ unidadeId, servicoId }) {
    const sql = `
      SELECT p.id, p.nome
      FROM agenda.profissional p
      JOIN agenda.profissional_servico ps
        ON ps.profissional_id = p.id
      WHERE p.unidade_id = $1::uuid
        AND p.ativo = true
        AND ps.servico_id = $2::uuid
      ORDER BY p.nome
    `;
    const { rows } = await pool.query(sql, [unidadeId, servicoId]);
    return rows; // [{id, nome}, ...]
  },
});