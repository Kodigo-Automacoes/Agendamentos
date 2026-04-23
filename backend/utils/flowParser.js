// utils/flowParser.js
// Parsers simples para interações de menu (escolha 1-N, SIM/NÃO, "qualquer").

function normalizeText(t) {
  return (t || '').toString().trim().toLowerCase();
}

/**
 * Interpreta uma escolha numérica do usuário (1..10).
 * Aceita: "1", "opção 2", "segundo", etc.
 * @returns {number|null}
 */
function parseEscolha(texto) {
  const t = normalizeText(texto);

  // Número direto no início
  const numMatch = t.match(/^(\d+)/);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    if (n >= 1 && n <= 10) return n;
  }

  // Ordinais por extenso (sem "quarta"/"quinta" que colidem com dias da semana)
  const ordinais = {
    primeiro: 1, primeira: 1,
    segundo: 2, segunda: 2,
    terceiro: 3, terceira: 3,
    quarto: 4,
    quinto: 5,
  };
  for (const [palavra, num] of Object.entries(ordinais)) {
    if (t.includes(palavra)) return num;
  }

  // "opção X" / "opcao X"
  const opcMatch = t.match(/op[çc][aã]o\s*(\d+)/i);
  if (opcMatch) {
    const n = parseInt(opcMatch[1], 10);
    if (n >= 1) return n;
  }

  return null;
}

/**
 * Interpreta SIM / NÃO do usuário.
 * @returns {boolean|null}
 */
function parseConfirmacao(texto) {
  const t = normalizeText(texto);

  const sim = ['sim', 's', 'confirmo', 'confirmar', 'ok', 'pode', 'fechado', 'beleza', 'bora', 'vamos', 'isso'];
  const nao = ['nao', 'não', 'n', 'cancela', 'cancelar', 'voltar', 'pare', 'não quero', 'nao quero', 'desisto'];

  if (sim.includes(t)) return true;
  if (nao.includes(t)) return false;

  // Heurística por início de frase
  if (t.startsWith('sim')) return true;
  if (t.startsWith('nao') || t.startsWith('não')) return false;

  return null;
}

/**
 * Detecta se o usuário quer sair / cancelar o fluxo atual.
 */
function parseCancelarFluxo(texto) {
  const t = normalizeText(texto);
  const escape = ['sair', 'cancelar', 'parar', 'pare', 'voltar', 'desistir', 'desisto'];
  return escape.includes(t) || t.startsWith('cancelar') || t.startsWith('sair');
}

module.exports = { parseEscolha, parseConfirmacao, parseCancelarFluxo, normalizeText };