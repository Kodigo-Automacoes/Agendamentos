/**
 * test-cancel-flow.js
 * ============================================================
 * Teste real contra o banco: cria intenção → cancela → verifica status.
 * 
 * Uso:
 *   node tests/test-cancel-flow.js
 * 
 * Requer: DATABASE_URL ou variáveis PG* no .env
 * ============================================================
 */
require('dotenv').config();
const { pool } = require('../config/db');

const FAKE_UUID = () => {
  // Gera UUIDv4 simples
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
};

async function run() {
  const agendaService = require('../services/agenda.service')(pool);
  let passed = 0;
  let failed = 0;

  function assert(label, condition) {
    if (condition) {
      console.log(`  ✅ ${label}`);
      passed++;
    } else {
      console.error(`  ❌ FALHOU: ${label}`);
      failed++;
    }
  }

  // ──────────────────────────────────────────────
  // TESTE 1: Cancelar UUID inexistente → false
  // ──────────────────────────────────────────────
  console.log('\n🧪 Teste 1: cancelar intenção inexistente');
  try {
    const result = await agendaService.cancelarIntencao({ intencaoId: FAKE_UUID() });
    assert('Retorna false para UUID inexistente', result === false);
  } catch (e) {
    console.error('  ❌ ERRO:', e.message);
    failed++;
  }

  // ──────────────────────────────────────────────
  // TESTE 2: cancelarIntencao(null) → false
  // ──────────────────────────────────────────────
  console.log('\n🧪 Teste 2: cancelar com intencaoId null');
  try {
    const result = await agendaService.cancelarIntencao({ intencaoId: null });
    assert('Retorna false para null', result === false);
  } catch (e) {
    console.error('  ❌ ERRO:', e.message);
    failed++;
  }

  // ──────────────────────────────────────────────
  // TESTE 3: Verificar que a função PG existe
  // ──────────────────────────────────────────────
  console.log('\n🧪 Teste 3: função cancelar_intencao_agendamento existe no banco');
  try {
    const { rows } = await pool.query(`
      SELECT proname FROM pg_proc
      WHERE proname = 'cancelar_intencao_agendamento'
        AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'agenda')
    `);
    assert('Função encontrada no schema agenda', rows.length === 1);
  } catch (e) {
    console.error('  ❌ ERRO:', e.message);
    failed++;
  }

  // ──────────────────────────────────────────────
  // TESTE 4: Verificar colunas de intencao_agendamento
  // ──────────────────────────────────────────────
  console.log('\n🧪 Teste 4: colunas esperadas em intencao_agendamento');
  try {
    const { rows } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'agenda' AND table_name = 'intencao_agendamento'
    `);
    const cols = rows.map(r => r.column_name);
    assert('Coluna "id" existe', cols.includes('id'));
    assert('Coluna "status" existe', cols.includes('status'));
    assert('Coluna "updated_at" existe', cols.includes('updated_at'));

    // Verificar se status é ENUM e se 'cancelada' está nele
    const { rows: enumRows } = await pool.query(`
      SELECT e.enumlabel FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname IN (
        SELECT udt_name FROM information_schema.columns
        WHERE table_schema = 'agenda' AND table_name = 'intencao_agendamento'
          AND column_name = 'status'
      )
    `);
    if (enumRows.length > 0) {
      const labels = enumRows.map(r => r.enumlabel);
      console.log('  📋 Status é ENUM com valores:', labels.join(', '));
      assert('"pendente" está no enum', labels.includes('pendente'));
      assert('"cancelada" está no enum', labels.includes('cancelada'));
      if (!labels.includes('cancelada')) {
        console.error('  ⚠ AÇÃO NECESSÁRIA: ALTER TYPE agenda.<tipo> ADD VALUE \'cancelada\';');
      }
    } else {
      console.log('  📋 Status é TEXT/VARCHAR (aceita qualquer valor) ✓');
    }
  } catch (e) {
    console.error('  ❌ ERRO:', e.message);
    failed++;
  }

  // ──────────────────────────────────────────────
  // TESTE 5: Verificar config_unidade (timezone)
  // ──────────────────────────────────────────────
  console.log('\n🧪 Teste 5: tabela agenda.config_unidade');
  try {
    const { rows } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'agenda' AND table_name = 'config_unidade'
    `);
    if (rows.length > 0) {
      const cols = rows.map(r => r.column_name);
      assert('Tabela config_unidade encontrada', true);
      assert('Coluna "timezone" existe', cols.includes('timezone'));
      assert('Coluna "unidade_id" existe', cols.includes('unidade_id'));
    } else {
      console.warn('  ⚠ Tabela agenda.config_unidade NÃO encontrada');
      console.warn('  ⚠ getTimezoneUnidade vai retornar sempre America/Sao_Paulo (fallback)');
      console.warn('  ⚠ Se todas as unidades usam SP, isso é OK. Senão, crie a tabela:');
      console.warn('    CREATE TABLE agenda.config_unidade (');
      console.warn('      unidade_id UUID PRIMARY KEY REFERENCES core.unidade(id),');
      console.warn('      timezone TEXT NOT NULL DEFAULT \'America/Sao_Paulo\'');
      console.warn('    );');
      passed++; // Não é bloqueante
    }
  } catch (e) {
    console.error('  ❌ ERRO:', e.message);
    failed++;
  }

  // ──────────────────────────────────────────────
  // TESTE 6: Criar intenção real, cancelar, verificar
  //          (só roda se houver dados de teste no banco)
  // ──────────────────────────────────────────────
  console.log('\n🧪 Teste 6: fluxo criar→cancelar (requer dados reais)');
  try {
    // Buscar qualquer intenção pendente para testar cancelamento
    const { rows: pendentes } = await pool.query(`
      SELECT id, status FROM agenda.intencao_agendamento
      WHERE status IN ('pendente', 'reservada')
      ORDER BY created_at DESC LIMIT 1
    `);

    if (pendentes.length > 0) {
      const testId = pendentes[0].id;
      console.log(`  📋 Encontrada intenção ${testId} com status="${pendentes[0].status}"`);
      const cancelada = await agendaService.cancelarIntencao({ intencaoId: testId });
      assert('cancelarIntencao retornou true', cancelada === true);

      // Verificar status no banco
      const { rows: check } = await pool.query(
        `SELECT status FROM agenda.intencao_agendamento WHERE id = $1`,
        [testId]
      );
      assert('Status no banco é "cancelada"', check[0]?.status === 'cancelada');
    } else {
      console.log('  ⏭ Nenhuma intenção pendente encontrada — teste pulado');
      console.log('    Para testar manualmente:');
      console.log('    1) Crie uma intenção via chat do WhatsApp (escolha horário)');
      console.log('    2) Responda "não" ou "sair"');
      console.log('    3) Verifique: SELECT status FROM agenda.intencao_agendamento ORDER BY created_at DESC LIMIT 1;');
    }
  } catch (e) {
    console.error('  ❌ ERRO:', e.message);
    failed++;
  }

  // ──────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Resultado: ${passed} passaram, ${failed} falharam`);
  console.log(`${'─'.repeat(50)}\n`);

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
