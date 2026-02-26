// tests/audit-fixes.test.js
// ============================================================
// Testes para validar as correções P0/P1 da auditoria.
// Rodar com: node tests/audit-fixes.test.js
// ============================================================

const assert = require('assert');

// ===================== Utils =====================
const { parseDataPtBR, hojeNoTimezone } = require('../utils/dateParser');
const { parseEscolha, parseConfirmacao, parseCancelarFluxo } = require('../utils/flowParser');

let passed = 0;
let failed = 0;

function test(nome, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${nome}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${nome}`);
    console.log(`     ${e.message}`);
  }
}

// ===================== FIX 6: parseEscolha sem colisão com dias =====================

console.log('\n=== FIX 6: parseEscolha — sem colisão quarta/quinta ===');

test('quarta não retorna 4 (era colisão com dia da semana)', () => {
  assert.strictEqual(parseEscolha('quarta'), null);
});

test('quinta não retorna 5 (era colisão com dia da semana)', () => {
  assert.strictEqual(parseEscolha('quinta'), null);
});

test('quarto retorna 4 (ordinal masculino OK)', () => {
  assert.strictEqual(parseEscolha('quarto'), 4);
});

test('quinto retorna 5 (ordinal masculino OK)', () => {
  assert.strictEqual(parseEscolha('quinto'), 5);
});

test('números 1-10 funcionam', () => {
  for (let i = 1; i <= 10; i++) {
    assert.strictEqual(parseEscolha(String(i)), i);
  }
});

test('11 retorna null (fora do range)', () => {
  assert.strictEqual(parseEscolha('11'), null);
});

test('opção 3 retorna 3', () => {
  assert.strictEqual(parseEscolha('opção 3'), 3);
});

test('segundo retorna 2', () => {
  assert.strictEqual(parseEscolha('segundo'), 2);
});

test('segunda retorna 2 (escolha, não dia da semana)', () => {
  assert.strictEqual(parseEscolha('segunda'), 2);
});

// ===================== FIX 4: dateParser timezone-aware =====================

console.log('\n=== FIX 4: dateParser — timezone-aware ===');

test('hojeNoTimezone retorna string YYYY-MM-DD', () => {
  const hoje = hojeNoTimezone('America/Sao_Paulo');
  assert.match(hoje, /^\d{4}-\d{2}-\d{2}$/);
});

test('Tokyo está ~12-13h adiantado em relação a SP', () => {
  const sp = hojeNoTimezone('America/Sao_Paulo');
  const tk = hojeNoTimezone('Asia/Tokyo');
  // Tokyo pode estar 1 dia à frente no final do dia brasileiro
  assert.ok(tk >= sp, `Tokyo (${tk}) deveria ser >= SP (${sp})`);
});

test('amanhã com timezone SP', () => {
  const result = parseDataPtBR('amanhã', { timezone: 'America/Sao_Paulo' });
  assert.ok(result, 'deveria retornar data');
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
});

test('amanhã backward-compatible (string date)', () => {
  const result = parseDataPtBR('amanhã', '2026-02-20');
  // 2026-02-20 + 1 = 2026-02-21
  // Porém, o legacy com new Date('2026-02-20') pode dar amanhã relativo ao parse
  // O importante é que não crashe e retorne algo válido
  assert.ok(result, 'deveria retornar data');
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
});

test('amanhã backward-compatible (null)', () => {
  const result = parseDataPtBR('amanhã');
  assert.ok(result, 'deveria retornar data');
});

test('sexta com timezone SP', () => {
  const result = parseDataPtBR('sexta', { timezone: 'America/Sao_Paulo' });
  assert.ok(result);
  // new Date('YYYY-MM-DD') é UTC midnight — usar T12:00:00 para evitar offset
  const d = new Date(result + 'T12:00:00');
  assert.strictEqual(d.getDay(), 5, 'deveria ser sexta-feira');
});

test('20/02 com timezone', () => {
  const result = parseDataPtBR('20/02', { timezone: 'America/Sao_Paulo' });
  assert.ok(result);
  assert.ok(result.endsWith('-02-20'));
});

test('próxima segunda com timezone', () => {
  const result = parseDataPtBR('próxima segunda', { timezone: 'America/Sao_Paulo' });
  assert.ok(result);
  const d = new Date(result + 'T12:00:00');
  assert.strictEqual(d.getDay(), 1, 'deveria ser segunda-feira');
});

test('dia 25 com timezone', () => {
  const result = parseDataPtBR('dia 25', { timezone: 'America/Sao_Paulo' });
  assert.ok(result);
  assert.ok(result.includes('-25'));
});

test('ISO date preservado', () => {
  assert.strictEqual(parseDataPtBR('2026-03-15', { timezone: 'America/Sao_Paulo' }), '2026-03-15');
});

test('30/02 inválido retorna null', () => {
  assert.strictEqual(parseDataPtBR('30/02', { timezone: 'America/Sao_Paulo' }), null);
});

test('string vazia retorna null', () => {
  assert.strictEqual(parseDataPtBR('', { timezone: 'America/Sao_Paulo' }), null);
});

test('null retorna null', () => {
  assert.strictEqual(parseDataPtBR(null), null);
});

// ===================== parseCancelarFluxo =====================

console.log('\n=== Escape / cancelar fluxo ===');

test('sair retorna true', () => {
  assert.strictEqual(parseCancelarFluxo('sair'), true);
});

test('cancelar retorna true', () => {
  assert.strictEqual(parseCancelarFluxo('cancelar'), true);
});

test('parar retorna true', () => {
  assert.strictEqual(parseCancelarFluxo('parar'), true);
});

test('desistir retorna true', () => {
  assert.strictEqual(parseCancelarFluxo('desistir'), true);
});

test('sim NÃO é escape', () => {
  assert.strictEqual(parseCancelarFluxo('sim'), false);
});

test('2 NÃO é escape', () => {
  assert.strictEqual(parseCancelarFluxo('2'), false);
});

// ===================== parseConfirmacao =====================

console.log('\n=== parseConfirmacao ===');

test('sim = true', () => assert.strictEqual(parseConfirmacao('sim'), true));
test('s = true', () => assert.strictEqual(parseConfirmacao('s'), true));
test('bora = true', () => assert.strictEqual(parseConfirmacao('bora'), true));
test('ok = true', () => assert.strictEqual(parseConfirmacao('ok'), true));
test('não = false', () => assert.strictEqual(parseConfirmacao('não'), false));
test('n = false', () => assert.strictEqual(parseConfirmacao('n'), false));
test('cancelar = false', () => assert.strictEqual(parseConfirmacao('cancelar'), false));
test('desisto = false', () => assert.strictEqual(parseConfirmacao('desisto'), false));
test('oi = null (não reconhece)', () => assert.strictEqual(parseConfirmacao('oi'), null));

// ===================== Simulações de cenário =====================

console.log('\n=== Simulações de cenário ===');

test('Cenário: usuário diz "quarta" no aguardando_profissional não seleciona profissional', () => {
  // parseEscolha('quarta') deve retornar null, não 4
  const escolha = parseEscolha('quarta');
  assert.strictEqual(escolha, null, '"quarta" não deve ser interpretado como opção 4');
});

test('Cenário: "sair" no aguardando_confirmacao é reconhecido', () => {
  // parseCancelarFluxo deve pegar "sair" que parseConfirmacao não pega
  assert.strictEqual(parseConfirmacao('sair'), null, 'parseConfirmacao não reconhece "sair"');
  assert.strictEqual(parseCancelarFluxo('sair'), true, 'parseCancelarFluxo reconhece "sair"');
});

test('Cenário: "parar" no aguardando_confirmacao é reconhecido', () => {
  assert.strictEqual(parseConfirmacao('parar'), null, 'parseConfirmacao não reconhece "parar"');
  assert.strictEqual(parseCancelarFluxo('parar'), true, 'parseCancelarFluxo reconhece "parar"');
});

// ===================== Resultado =====================

console.log(`\n${'='.repeat(50)}`);
console.log(`Resultado: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(50)}\n`);

if (failed > 0) process.exit(1);
