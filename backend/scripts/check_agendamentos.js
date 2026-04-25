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
  // Check agendamentos
  const ag = await p.query(`
    SELECT a.id, a.inicio, a.fim, a.status, a.codigo,
           p.nome AS profissional, s.nome AS servico,
           c.nome AS cliente
    FROM agenda.agendamento a
    LEFT JOIN agenda.profissional p ON p.id = a.profissional_id
    LEFT JOIN agenda.servico s ON s.id = a.servico_id
    LEFT JOIN crm.cliente c ON c.id = a.cliente_id
    ORDER BY a.created_at DESC
    LIMIT 5
  `);
  console.log('=== Últimos agendamentos ===');
  for (const r of ag.rows) {
    console.log(`  ${r.codigo || r.id} | ${r.profissional} | ${r.servico} | ${r.inicio} -> ${r.fim} | status=${r.status} | cliente=${r.cliente}`);
  }

  // Check intencoes
  const int = await p.query(`
    SELECT id, status, inicio_sugerido, created_at
    FROM agenda.intencao_agendamento
    ORDER BY created_at DESC
    LIMIT 5
  `);
  console.log('\n=== Últimas intenções ===');
  for (const r of int.rows) {
    console.log(`  ${r.id} | status=${r.status} | inicio=${r.inicio_sugerido} | criado=${r.created_at}`);
  }

  await p.end();
}

main().catch(e => { console.error(e); p.end(); });
