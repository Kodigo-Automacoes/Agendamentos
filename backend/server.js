const app = require("./app");
const { pool } = require("./config/db");

const PORT = Number(process.env.PORT || 3000);

/**
 * Auto-migration: garante que o banco está com o schema correto.
 * Roda no startup — idempotente (pode rodar N vezes sem problema).
 */
async function runAutoMigrations() {
  try {
    // Fix: adicionar 'aguardando_profissional' ao CHECK constraint
    // Sem esse estado, o bot crashava quando tinha >1 profissional.
    await pool.query(`
      ALTER TABLE integracoes.conversa_estado
      DROP CONSTRAINT IF EXISTS conversa_estado_estado_check
    `);
    await pool.query(`
      ALTER TABLE integracoes.conversa_estado
      ADD CONSTRAINT conversa_estado_estado_check
      CHECK (estado::text = ANY(ARRAY[
        'idle',
        'coletando_dados',
        'mostrando_horarios',
        'aguardando_escolha',
        'aguardando_confirmacao',
        'aguardando_profissional',
        'em_fila',
        'oferta_pendente'
      ]::text[]))
    `);
    console.log("[auto-migration] Constraint conversa_estado_estado_check OK");
  } catch (err) {
    console.error("[auto-migration] Erro (não fatal):", err.message);
  }
}

async function start() {
  await runAutoMigrations();

  app.listen(PORT, () => {
    console.log(`API rodando na porta ${PORT}`);
  });
}

start();