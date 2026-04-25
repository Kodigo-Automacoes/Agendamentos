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
  const procs = await p.query(`
    SELECT n.nspname as schema, p.proname as name, pg_get_functiondef(p.oid) as def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('core','agenda','integracoes','crm')
    ORDER BY n.nspname, p.proname
  `);
  for (const r of procs.rows) {
    console.log(`\n========== ${r.schema}.${r.name} ==========`);
    console.log(r.def);
  }

  // Also get all table CREATE statements (constraints, indexes)
  const constraints = await p.query(`
    SELECT conrelid::regclass as tbl, conname, pg_get_constraintdef(oid) as def
    FROM pg_constraint
    WHERE connamespace IN (
      SELECT oid FROM pg_namespace WHERE nspname IN ('core','agenda','integracoes','crm')
    )
    ORDER BY conrelid::regclass::text, conname
  `);
  console.log('\n\n========== ALL CONSTRAINTS ==========');
  for (const c of constraints.rows) {
    console.log(`  ${c.tbl} | ${c.conname}: ${c.def}`);
  }

  // Get unique indexes
  const indexes = await p.query(`
    SELECT schemaname, tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname IN ('core','agenda','integracoes','crm')
      AND indexname NOT LIKE '%_pkey'
    ORDER BY schemaname, tablename
  `);
  console.log('\n\n========== INDEXES ==========');
  for (const i of indexes.rows) {
    console.log(`  ${i.indexdef}`);
  }

  await p.end();
}

main().catch(e => { console.error(e); p.end(); });
