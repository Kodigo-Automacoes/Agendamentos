// utils/dateParser.js
// Converte referências de data em português para YYYY-MM-DD.
// Exemplos: "amanhã", "sexta", "20/02", "depois de amanhã"

const DIAS_SEMANA = {
  domingo: 0, dom: 0,
  'segunda': 1, seg: 1, 'segunda-feira': 1,
  'terca': 2, 'terça': 2, ter: 2, 'terca-feira': 2, 'terça-feira': 2,
  'quarta': 3, qua: 3, 'quarta-feira': 3,
  'quinta': 4, qui: 4, 'quinta-feira': 4,
  'sexta': 5, sex: 5, 'sexta-feira': 5,
  'sabado': 6, 'sábado': 6, sab: 6, 'sáb': 6,
};

/**
 * Remove acentos e normaliza texto para comparação.
 */
function norm(t) {
  return (t || '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Formata Date como 'YYYY-MM-DD'.
 */
function formatYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * Retorna a data de "hoje" em um timezone específico como 'YYYY-MM-DD'.
 * @param {string} timezone - ex: 'America/Sao_Paulo'
 * @returns {string} 'YYYY-MM-DD'
 */
function hojeNoTimezone(timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Converte texto em pt-BR para data YYYY-MM-DD.
 * @param {string} texto - ex: "amanhã", "sexta", "20/02", "2026-03-01"
 * @param {Date|string|{timezone?:string, hoje?:Date|string}|null} opcoesOuHoje
 * @returns {string|null} 'YYYY-MM-DD' ou null se não conseguir parsear
 */
function parseDataPtBR(texto, opcoesOuHoje = null) {
  if (!texto) return null;

  const raw = texto.toString().trim();
  const t = norm(raw);

  let ref;
  if (opcoesOuHoje && typeof opcoesOuHoje === 'object' && !(opcoesOuHoje instanceof Date) && opcoesOuHoje.timezone) {
    // Options object com timezone da unidade
    const hojeStr = opcoesOuHoje.hoje || hojeNoTimezone(opcoesOuHoje.timezone);
    ref = new Date(hojeStr + 'T12:00:00'); // noon para evitar edge de DST
  } else if (opcoesOuHoje) {
    ref = new Date(opcoesOuHoje);
  } else {
    ref = new Date();
  }
  ref.setHours(0, 0, 0, 0);

  // --- Já no formato ISO ---
  const isoMatch = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return isoMatch[0];

  // --- hoje ---
  if (t === 'hoje') return formatYMD(ref);

  // --- amanhã ---
  if (t === 'amanha') {
    ref.setDate(ref.getDate() + 1);
    return formatYMD(ref);
  }

  // --- depois de amanhã ---
  if (t.includes('depois de amanha') || t.includes('depois de amanha')) {
    ref.setDate(ref.getDate() + 2);
    return formatYMD(ref);
  }

  // --- Dia da semana (próxima ocorrência) ---
  for (const [nome, dow] of Object.entries(DIAS_SEMANA)) {
    const nomeNorm = norm(nome);
    if (t === nomeNorm || t.includes(nomeNorm)) {
      const diff = (dow - ref.getDay() + 7) % 7 || 7; // sempre próxima
      ref.setDate(ref.getDate() + diff);
      return formatYMD(ref);
    }
  }

  // --- "proxima segunda", "próxima quarta" ---
  const proxMatch = t.match(/prox(?:ima)?\s+(.+)/);
  if (proxMatch) {
    return parseDataPtBR(proxMatch[1], opcoesOuHoje);
  }

  // --- DD/MM ou DD/MM/YYYY (separador: / - .) ---
  const dmyMatch = raw.match(/(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?/);
  if (dmyMatch) {
    const dia = parseInt(dmyMatch[1], 10);
    const mes = parseInt(dmyMatch[2], 10) - 1; // 0-based
    let ano = dmyMatch[3] ? parseInt(dmyMatch[3], 10) : ref.getFullYear();
    if (ano < 100) ano += 2000;
    const d = new Date(ano, mes, dia);
    if (!isNaN(d.getTime()) && d.getDate() === dia) {
      return formatYMD(d);
    }
  }

  // --- "dia 20" / "dia 5" ---
  const diaMatch = t.match(/dia\s+(\d{1,2})/);
  if (diaMatch) {
    const dia = parseInt(diaMatch[1], 10);
    let tentativa = new Date(ref.getFullYear(), ref.getMonth(), dia);
    // se já passou, vai pro próximo mês
    if (tentativa < ref) {
      tentativa = new Date(ref.getFullYear(), ref.getMonth() + 1, dia);
    }
    if (!isNaN(tentativa.getTime()) && tentativa.getDate() === dia) {
      return formatYMD(tentativa);
    }
  }

  return null;
}

module.exports = { parseDataPtBR, formatYMD, hojeNoTimezone };
