const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { Pool } = require('pg');

const p = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

async function main() {
  // Drop old constraint
  await p.query(`ALTER TABLE integracoes.conversa_estado DROP CONSTRAINT IF EXISTS conversa_estado_estado_check`);
  console.log('Constraint antiga removida');

  // Add new constraint with 'aguardando_profissional' included
  await p.query(`
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
  console.log('Nova constraint criada com aguardando_profissional');

  await p.end();
}

main().catch(e => { console.error('ERRO:', e.message); p.end(); });
