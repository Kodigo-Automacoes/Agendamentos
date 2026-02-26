// services/conversaEstado.service.js
// Gerencia o state machine da conversa no Postgres (integracoes.conversa_estado).
//
// Colunas: conversa_id (PK unique), estado, intencao_id, ultima_lista (jsonb), updated_at
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
      WHERE conversa_id = $1::uuid
    `;
    const { rows } = await pool.query(sql, [conversaId]);
    return rows[0] || null;
  },

  /**
   * Insere ou atualiza o estado da conversa.
   */
  async upsert(conversaId, patch) {
    const estado = patch.estado ?? 'idle';
    const intencaoId = patch.intencao_id ?? null;
    const ultimaLista = patch.ultima_lista ?? null;

    const sql = `
      INSERT INTO integracoes.conversa_estado (conversa_id, estado, intencao_id, ultima_lista)
      VALUES ($1::uuid, $2::text, $3::uuid, $4::jsonb)
      ON CONFLICT (conversa_id)
      DO UPDATE SET
        estado      = EXCLUDED.estado,
        intencao_id = EXCLUDED.intencao_id,
        ultima_lista = EXCLUDED.ultima_lista,
        updated_at  = now()
      RETURNING estado, intencao_id, ultima_lista, updated_at
    `;

    const { rows } = await pool.query(sql, [
      conversaId,
      estado,
      intencaoId,
      ultimaLista ? JSON.stringify(ultimaLista) : null,
    ]);

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