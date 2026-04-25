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
  // Check constraints on conversa_estado
  const constraints = await p.query(`
    SELECT conname, pg_get_constraintdef(oid) as def
    FROM pg_constraint
    WHERE conrelid = 'integracoes.conversa_estado'::regclass
  `);
  console.log('=== conversa_estado CONSTRAINTS ===');
  for (const c of constraints.rows) {
    console.log(`  ${c.conname}: ${c.def}`);
  }

  await p.end();
}

main().catch(e => { console.error(e); p.end(); });
