// services/conversaEstado.service.js
// Gerencia o state machine da conversa no Postgres (integracoes.conversa_estado).
//
// Colunas: id (PK), empresa_id, unidade_id, canal_id, cliente_id,
//          estado, intencao_id, ultima_lista (jsonb), updated_at
// Estados: idle | coletando_dados | aguardando_profissional | aguardando_escolha | aguardando_confirmacao

module.exports = (pool) => ({
  /**
   * Busca o estado atual da conversa.
   * @returns {{ estado, intencao_id, ultima_lista, updated_at } | null}
   */
  async get(conversaId) {
    const sql = `
      SELECT estado, intencao_id, ultima_lista, updated_at
      FROM integracoes.conversa_estado
      WHERE id = $1::int
    `;
    const { rows } = await pool.query(sql, [conversaId]);
    return rows[0] || null;
  },

  /**
   * Atualiza o estado da conversa.
   * Usa UPDATE (a linha já deve existir — criada por get_or_create_conversa_estado).
   * Se a linha não existir (caso raro), loga warning mas NÃO dá throw — 
   * o antigo throw matava toda a resposta do webhook silenciosamente.
   */
  async upsert(conversaId, patch) {
    const estado = patch.estado ?? 'idle';
    const intencaoId = patch.intencao_id ?? null;
    const ultimaLista = patch.ultima_lista ?? null;
    const listaJson = ultimaLista ? JSON.stringify(ultimaLista) : null;

    const sql = `
      UPDATE integracoes.conversa_estado
      SET
        estado       = $2::text,
        intencao_id  = $3::int,
        ultima_lista = $4::jsonb,
        updated_at   = now()
      WHERE id = $1::int
      RETURNING estado, intencao_id, ultima_lista, updated_at
    `;

    const { rows } = await pool.query(sql, [
      conversaId,
      estado,
      intencaoId,
      listaJson,
    ]);

    if (!rows[0]) {
      // Não dá throw — apenas loga. O fluxo continua sem estado persistido.
      // Isso é melhor que matar a resposta inteira.
      console.warn(`[conversaEstado] UPDATE não encontrou conversa ${conversaId} — estado não persistido`);
      return { estado, intencao_id: intencaoId, ultima_lista: ultimaLista, updated_at: new Date().toISOString() };
    }

    return rows[0];
  },

  /**
   * Limpa o estado da conversa (volta para idle).
   */
  async clear(conversaId) {
    return this.upsert(conversaId, {
      estado: 'idle',
      intencao_id: null,
      ultima_lista: null,
    });
  },
});
