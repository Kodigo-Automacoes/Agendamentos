// routes/message.routes.js
// ============================================================
// Endpoint principal POST /message-router
// Orquestra: resolução de contexto → state machine → IA → agendamento
// ============================================================

const express = require('express');
const router = express.Router();

// --- Pool Postgres ---
const { pool } = require('../config/db');

// --- Services existentes (singleton, usam pool internamente) ---
const { resolverCanalWhatsapp, autoProvisionarCanal } = require('../services/canal.service');
const { normalizarE164, getOrCreateClienteId } = require('../services/cliente.service');
const { getPoliticaContato } = require('../services/politica.service');
const { getOrCreateConversa } = require('../services/conversa.service');
const { logMensagem } = require('../services/mensagem.service');
const { classificarMensagemIA } = require('../services/ia.service');
const { sendTextViaWuzapi } = require('../services/wuzapi.service');
const { sendTextViaEvolution } = require('../services/evolution.service');
const { safeString } = require('../utils/helpers');

// --- Services novos (factory recebe pool) ---
const agendaService = require('../services/agenda.service')(pool);
const conversaEstado = require('../services/conversaEstado.service')(pool);
const profissionalResolver = require('../services/profissionalResolver.service')(pool);
const servicoResolver = require('../services/servicoResolver.service')(pool);

// --- Utils ---
const { parseEscolha, parseConfirmacao, parseCancelarFluxo, normalizeText } = require('../utils/flowParser');
const { parseDataPtBR, parseHoraPtBR, periodoFromHora } = require('../utils/dateParser');

// ===================== Fila por telefone =====================
// Serializa processamento de mensagens do mesmo remetente para
// evitar race conditions quando o usuário manda msgs rápidas.
const phoneQueues = new Map();

async function enqueueByPhone(phoneKey, fn) {
  const prev = phoneQueues.get(phoneKey) || Promise.resolve();
  const next = prev.then(fn, fn); // sempre executa, mesmo se anterior falhou
  phoneQueues.set(phoneKey, next);
  // Limpa referência quando terminar
  next.finally(() => {
    if (phoneQueues.get(phoneKey) === next) phoneQueues.delete(phoneKey);
  });
  return next;
}

// ===================== Helpers de resposta =====================

/**
 * Converte JID do WhatsApp (5511999999999@s.whatsapp.net) para E.164 (+5511999999999).
 * Ignora JIDs de grupo (@g.us) e newsletter (@newsletter).
 * Retorna null se o formato não bater.
 */
function extractE164FromJid(jid) {
  if (!jid || typeof jid !== 'string') return null;
  if (!jid.includes('@s.whatsapp.net')) return null; // só 1:1
  const match = jid.match(/^(\d+)@/);
  return match ? `+${match[1]}` : null;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return String(value).toLowerCase() === 'true';
}

function pickFirstString(values) {
  for (const v of values) {
    if (v !== null && v !== undefined && typeof v === 'object') continue;
    const s = safeString(v);
    if (s) return s;
  }
  return null;
}

function normalizeIncomingPayload(payload = {}, { providerHint = null } = {}) {
  const evoData = payload.data || {};
  const evoKey = evoData.key || {};

  const event = pickFirstString([
    payload.event,
    payload.type,
    payload?.data?.event,
  ]);

  const remoteJid = pickFirstString([
    payload.remoteJid,
    payload?.data?.remoteJid,
    evoKey.remoteJid,
    payload?.message?.remoteJid,
  ]);

  const text = pickFirstString([
    payload.text,
    payload.body,
    payload.message,
    payload.caption,
    payload?.data?.text,
    payload?.data?.body,
    payload?.message?.text,
    payload?.message?.body,
    payload?.message?.conversation,
    evoData.message?.conversation,
    evoData.message?.extendedTextMessage?.text,
    evoData.message?.imageMessage?.caption,
    evoData.message?.videoMessage?.caption,
  ]);

  const messageId = pickFirstString([
    payload.message_id,
    payload.messageId,
    payload.id,
    payload?.data?.id,
    payload?.message?.id,
    evoKey.id,
  ]);

  const messageType = pickFirstString([
    payload.message_type,
    payload.messageType,
    payload.typeMessage,
    payload?.data?.messageType,
    evoData.messageType,
  ]) || 'text';

  const fromMeRaw = payload?.fromMe ?? payload?.data?.fromMe ?? evoKey.fromMe;
  const fromMe = typeof fromMeRaw === 'boolean' ? fromMeRaw : parseBoolean(fromMeRaw, false);

  // ----------------------------------------------------------
  // Resolução de remetente / destinatário (Evolution v2 + N8N legado).
  //
  // Em mensagem 1:1 da Evolution, a fonte de verdade é:
  //   - fromMe=false → o REMETENTE é key.remoteJid (o "outro lado").
  //   - fromMe=true  → o BOT enviou; key.remoteJid é o destinatário.
  //
  // Os campos `payload.from` / `data.from` podem vir preenchidos com o
  // ownerJid da instância em alguns provedores, o que faz o backend
  // achar que o cliente é o próprio bot. Por isso priorizamos remoteJid.
  // ----------------------------------------------------------
  const remoteJidE164 = extractE164FromJid(remoteJid);
  const ownerJidGuess = pickFirstString([
    payload?.owner,
    payload?.data?.owner,
    payload?.sender,
    payload?.data?.sender,
  ]);

  let fromRaw;
  let toNumeroE164;
  if (fromMe) {
    // Bot enviou — destinatário é o remoteJid; remetente é o dono.
    fromRaw = pickFirstString([
      ownerJidGuess && extractE164FromJid(ownerJidGuess),
      ownerJidGuess,
      pickFirstString([payload?.data?.from]),
    ]);
    toNumeroE164 = pickFirstString([
      remoteJidE164,
      pickFirstString([payload.to_numero_e164, payload.to, payload?.data?.to, payload.recipient, payload?.message?.to]),
    ]);
  } else {
    // Cliente enviou — remetente é o remoteJid; destinatário é o dono da instância.
    fromRaw = pickFirstString([
      remoteJidE164,
      pickFirstString([
        payload.from_whatsapp_e164,
        payload.from,
        payload.author,
        payload?.message?.from,
      ]),
    ]);
    toNumeroE164 = pickFirstString([
      payload.to_numero_e164,
      payload.to,
      payload?.data?.to,
      payload.recipient,
      payload?.message?.to,
      ownerJidGuess && extractE164FromJid(ownerJidGuess),
    ]);
  }

  // Sanity-check: se o `from_raw` resolvido bater com o número do dono
  // da instância (típico bug onde a Evolution preenche data.from com o
  // ownerJid), descartamos e usamos o remoteJid.
  const ownerE164 = ownerJidGuess && extractE164FromJid(ownerJidGuess);
  if (!fromMe && remoteJidE164 && fromRaw && ownerE164 && fromRaw === ownerE164 && remoteJidE164 !== ownerE164) {
    console.warn(`[normalize] from_raw=${fromRaw} bate com owner; usando remoteJid=${remoteJidE164}`);
    fromRaw = remoteJidE164;
  }

  const fromName = pickFirstString([
    payload.from_name,
    payload.senderName,
    payload.pushName,
    payload?.data?.pushName,
    payload?.message?.pushName,
    evoData.pushName,
  ]);

  const instanceKey = pickFirstString([
    payload.instance_key,
    payload.instance,
    payload.session,
    payload?.data?.instance_key,
    payload?.data?.instance,
    payload?.message?.instance_key,
  ]);

  const provedor = pickFirstString([
    payload.provedor,
    payload.provider,
    providerHint,
  ]) || 'evolution';

  return {
    provedor,
    instance_key: instanceKey,
    to_numero_e164: toNumeroE164,
    from_raw: fromRaw,
    from_name: fromName,
    text,
    message_id: messageId,
    message_type: messageType,
    event,
    from_me: fromMe,
    remote_jid: remoteJid,
    raw_payload: payload?.metadata?.raw ?? payload?.raw ?? payload,
    payload,
  };
}

async function shouldProcessInboundMessage(normalized) {
  if (!normalized?.from_raw) {
    return { process: false, reason: 'missing_sender' };
  }

  if (!normalized?.text) {
    return { process: false, reason: 'missing_text' };
  }

  // fromMe=true normalmente é eco de mensagem que NÓS enviamos. Mas quando o
  // dono da instância está testando consigo mesmo (envia do mesmo telefone que
  // está conectado na Evolution), todas as mensagens dele vêm fromMe=true e
  // precisamos processar. Distinguimos verificando se o message_id já está
  // gravado como mensagem de saída — se sim, é nosso eco e ignoramos.
  if (normalized.from_me) {
    if (!normalized.message_id) {
      return { process: false, reason: 'outbound_event_without_id' };
    }
    try {
      const { rows } = await pool.query(
        `SELECT 1 FROM integracoes.whatsapp_mensagem
          WHERE direcao = 'out' AND message_id = $1 LIMIT 1`,
        [normalized.message_id]
      );
      if (rows.length) {
        return { process: false, reason: 'outbound_event_self' };
      }
      // fromMe=true mas não está em direcao=out → é o dono enviando do próprio
      // número conectado (modo self-test). Processa.
    } catch (err) {
      console.warn('[shouldProcessInboundMessage] erro checando outbound:', err.message);
      return { process: false, reason: 'outbound_event' };
    }
  }

  if (normalized.remote_jid && /@g\.us$|@newsletter$/i.test(normalized.remote_jid)) {
    return { process: false, reason: 'group_or_newsletter' };
  }

  // Filtra eventos que claramente NÃO são mensagem.
  // A Evolution manda event = "messages.upsert" para msgs novas.
  // Aceitamos qualquer evento que contenha "message" no nome,
  // e também aceitamos quando event é null/undefined (payload sem campo event).
  if (normalized.event) {
    const t = normalized.event.toLowerCase();
    const isMessageEvent = (
      t === 'message' ||
      t === 'messages.upsert' ||
      t.includes('message')
    );
    if (!isMessageEvent) {
      return { process: false, reason: `non_message_event:${normalized.event}` };
    }
  }

  return { process: true, reason: 'ok' };
}

const LISTA_TTL_MINUTOS = 15;

/**
 * Resposta padrão de envio de mensagem.
 * Contrato N8N:
 *   - shouldReply: true  → o workflow deve enviar messages[] via Evolution API
 *   - shouldReply: false → não enviar nada (skip/ignore/dedup)
 * O nó IF do N8N deve usar: {{ $json.shouldReply === true }}
 */
function reply(text) {
  return {
    action: 'reply',
    shouldReply: true,
    messages: [{ type: 'text', text }],
  };
}

function buildHorarioMenu(opcoes, timezone = 'America/Sao_Paulo') {
  const linhas = opcoes.map((o) => {
    const hora = formatHoraTZ(o.inicio, timezone);
    return `${o.idx}) ${hora}`;
  });
  return `Encontrei esses horários:\n${linhas.join('\n')}\n\nResponda com ${opcoes.map(o => o.idx).join(', ')}.`;
}

function buildProfissionaisMenu(profs) {
  const linhas = profs.map((p, i) => `${i + 1}) ${p.nome}`);
  return `Tenho estes profissionais:\n${linhas.join('\n')}\n\nResponda com o número ou "qualquer".`;
}

function buildServicosMenu(svcs) {
  const linhas = svcs.map((s, i) => `${i + 1}) ${s.nome}`);
  return `Qual serviço você deseja?\n${linhas.join('\n')}`;
}

function isQualquer(texto) {
  const t = normalizeText(texto);
  return ['qualquer', 'tanto faz', 'sem preferencia', 'sem preferência'].includes(t) || t.includes('qualquer');
}

function token() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function hhmmToMinutes(hhmm) {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function inferPeriodoDoTexto(texto) {
  const t = normalizeText(texto);
  if (t.includes('manhã') || t.includes('manha')) return 'manha';
  if (t.includes('tarde')) return 'tarde';
  if (t.includes('noite')) return 'noite';
  return null;
}

function inferServicoDoTexto(texto) {
  const t = normalizeText(texto);
  if (!t) return null;
  if (t.includes('combo') || (t.includes('corte') && t.includes('barba'))) return 'combo';
  if (t.includes('corte') || t.includes('cabelo')) return 'corte';
  if (t.includes('barba')) return 'barba';
  return null;
}

function inferEntitiesFromText(texto, timezone) {
  const horario = parseHoraPtBR(texto);
  return {
    data: parseDataPtBR(texto, { timezone }),
    horario,
    periodo: periodoFromHora(horario) || inferPeriodoDoTexto(texto),
    servico: inferServicoDoTexto(texto),
    profissional: null,
  };
}

function shouldRestartColeta(texto) {
  const t = normalizeText(texto);
  const restart = ['oi', 'ola', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'menu', 'ajuda', 'comecar', 'começar', 'inicio', 'início'];
  return restart.includes(t);
}

function hasSinalAgendamento(texto) {
  const t = normalizeText(texto);
  return (
    t.includes('agend') ||
    t.includes('marcar') ||
    t.includes('horario') ||
    t.includes('horário') ||
    t.includes('corte') ||
    t.includes('cabelo') ||
    t.includes('barba') ||
    t.includes('combo')
  );
}

/**
 * Formata um timestamp ISO no timezone correto da unidade.
 */
function formatHoraTZ(isoString, timezone = 'America/Sao_Paulo') {
  const d = new Date(isoString);
  return d.toLocaleTimeString('pt-BR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Verifica se a lista de opções expirou (TTL).
 */
function isListaExpirada(lista) {
  if (!lista?.created_at) return true;
  const criado = new Date(lista.created_at);
  return (Date.now() - criado.getTime()) / 60000 > LISTA_TTL_MINUTOS;
}

// ===================== State-machine handlers =====================

/**
 * Estado: aguardando_escolha
 * Usuário deve responder 1/2/3 para escolher horário.
 */
async function handleAguardandoEscolha({ ctx, estadoRow, texto }) {
  if (parseCancelarFluxo(texto)) {
    await conversaEstado.clear(ctx.conversa_id);
    return reply('Cancelado! Se quiser agendar de novo, é só pedir 🙂');
  }

  const lista = estadoRow.ultima_lista || {};

  // TTL: se as opções expiraram, re-listar horários frescos
  if (isListaExpirada(lista)) {
    return await listarEOferecerHorarios({
      ctx,
      profissionalId: lista.profissional_id,
      servicoId: lista.servico_id,
      dataISO: lista.data,
      periodo: lista.periodo,
      horaPreferida: lista.hora_preferida || null,
      resumoIA: lista.resumo_ia || {},
      prefixo: '⏱ Os horários anteriores expiraram. Aqui estão os atuais:\n\n',
    });
  }

  const escolha = parseEscolha(texto);
  if (!escolha) {
    return reply('Me diga 1, 2 ou 3 🙂');
  }

  const opcoes = lista.opcoes || [];
  const escolhido = opcoes.find(o => o.idx === escolha);
  if (!escolhido) {
    return reply(`Essa opção não existe. Escolha entre ${opcoes.map(o => o.idx).join(', ')} 🙂`);
  }

  // Criar intenção no banco
  const intencao = await agendaService.criarIntencao({
    empresaId: ctx.empresa_id,
    unidadeId: ctx.unidade_id,
    clienteId: ctx.cliente_id,
    profissionalId: lista.profissional_id,
    servicoId: lista.servico_id,
    inicioISO: escolhido.inicio,
    resumoIA: lista.resumo_ia || {},
    contexto: { origem: 'whatsapp', etapa: 'criar_intencao' },
  });

  if (!intencao?.intencao_id) {
    return reply('Não consegui reservar esse horário agora 😕 Quer que eu busque outros?');
  }

  await conversaEstado.upsert(ctx.conversa_id, {
    estado: 'aguardando_confirmacao',
    intencao_id: intencao.intencao_id,
    ultima_lista: lista,
  });

  const hora = formatHoraTZ(escolhido.inicio, ctx.timezone);
  return reply(`Perfeito! Vou reservar às ${hora}.\nConfirma? (SIM / NÃO)`);
}

/**
 * Estado: aguardando_confirmacao
 * Usuário deve responder SIM ou NÃO.
 */
async function handleAguardandoConfirmacao({ ctx, estadoRow, texto }) {
  // Escape: "sair", "parar", "desistir" (não cobertos pelo parseConfirmacao)
  if (parseCancelarFluxo(texto)) {
    if (estadoRow.intencao_id) {
      await agendaService.cancelarIntencao({ intencaoId: estadoRow.intencao_id });
    }
    await conversaEstado.clear(ctx.conversa_id);
    return reply('Cancelado! Se quiser agendar de novo, é só pedir 🙂');
  }

  const conf = parseConfirmacao(texto);
  if (conf === null) {
    return reply('Responda SIM para confirmar ou NÃO para cancelar 🙂');
  }

  if (!conf) {
    // Usuário disse NÃO — cancelar intenção para liberar o slot
    if (estadoRow.intencao_id) {
      await agendaService.cancelarIntencao({ intencaoId: estadoRow.intencao_id });
    }
    await conversaEstado.clear(ctx.conversa_id);
    return reply('Beleza! Cancelado. Se quiser tentar outro horário, é só pedir 🙂');
  }

  // Confirmar intenção → cria agendamento real
  const agendamentoId = await agendaService.confirmarIntencao({
    intencaoId: estadoRow.intencao_id,
  });
  await conversaEstado.clear(ctx.conversa_id);

  if (!agendamentoId) {
    // Slot ficou indisponível — cancelar intenção residual
    if (estadoRow.intencao_id) {
      await agendaService.cancelarIntencao({ intencaoId: estadoRow.intencao_id });
    }
    return reply('Esse horário acabou de ficar indisponível 😕 Quer que eu busque outros?');
  }

  return reply('Agendado ✅ Se precisar cancelar, é só me avisar.');
}

/**
 * Estado: aguardando_profissional
 * Usuário escolhe 1/2/3... ou "qualquer".
 */
async function handleAguardandoProfissional({ ctx, estadoRow, texto }) {
  if (parseCancelarFluxo(texto)) {
    await conversaEstado.clear(ctx.conversa_id);
    return reply('Cancelado! Se quiser agendar de novo, é só pedir 🙂');
  }

  const lista = estadoRow.ultima_lista || {};
  const profs = lista.profissionais || [];
  let profissionalId = null;

  if (isQualquer(texto)) {
    profissionalId = profs[0]?.id;
  } else {
    const idx = parseEscolha(texto);
    if (!idx || idx < 1 || idx > profs.length) {
      return reply('Escolha um número da lista ou "qualquer" 🙂');
    }
    profissionalId = profs[idx - 1].id;
  }

  if (!profissionalId) {
    return reply('Não consegui selecionar um profissional 😕 Tenta de novo.');
  }

  // Agora listar horários
  return await listarEOferecerHorarios({
    ctx,
    profissionalId,
    servicoId: lista.servico_id,
    dataISO: lista.data,
    periodo: lista.periodo,
    horaPreferida: lista.hora_preferida || null,
    resumoIA: lista.resumo_ia || {},
  });
}

/**
 * Estado: coletando_dados
 * Estamos esperando data ou serviço que faltava.
 */
async function handleColetandoDados({ ctx, estadoRow, texto }) {
  if (parseCancelarFluxo(texto)) {
    await conversaEstado.clear(ctx.conversa_id);
    return reply('Cancelado! Se quiser agendar de novo, é só pedir 🙂');
  }

  // Se o cliente "reiniciar" a conversa, deixa cair para IA/fallback.
  if (shouldRestartColeta(texto)) {
    await conversaEstado.clear(ctx.conversa_id);
    return null;
  }

  const lista = estadoRow.ultima_lista || {};
  const falta = lista.falta;

  // --- Faltava a DATA ---
  if (falta === 'data') {
    const dataISO = parseDataPtBR(texto, { timezone: ctx.timezone });
    if (!dataISO) {
      return reply(
        'Beleza! Qual dia você prefere?\n' +
        'Pode ser assim:\n' +
        '- amanhã\n' +
        '- sexta\n' +
        '- 20/03'
      );
    }

    // Merge e continuar o fluxo de agendamento
    const horario = parseHoraPtBR(texto) || lista.hora_preferida || null;
    const entities = {
      ...(lista.resumo_ia?.entities || {}),
      data: dataISO,
      horario,
      periodo: periodoFromHora(horario) || lista.periodo || 'manha',
    };
    return await handleNovoAgendamento({ ctx, entities, resumoIA: lista.resumo_ia || {}, texto });
  }

  // --- Faltava o SERVIÇO ---
  if (falta === 'servico') {
    const svcs = lista.servicos || [];
    let servicoId = null;

    // Tentar por número (1/2/3)
    const idx = parseEscolha(texto);
    if (idx && idx >= 1 && idx <= svcs.length) {
      servicoId = svcs[idx - 1].id;
    } else {
      // Tentar por nome
      const svc = await servicoResolver.resolverPorNome({
        unidadeId: ctx.unidade_id,
        nomeServico: texto,
      });
      servicoId = svc?.id || null;
    }

    if (!servicoId) {
      return reply('Não encontrei esse serviço. Escolha pelo número da lista 🙂');
    }

    // Continuar com serviço resolvido → profissional → horários
    return await continuarComServico({
      ctx,
      servicoId,
      dataISO: lista.data,
      periodo: lista.periodo || 'manha',
      horaPreferida: lista.hora_preferida || null,
      resumoIA: lista.resumo_ia || {},
    });
  }

  // Falta desconhecida — limpa e retorna null para cair na IA
  await conversaEstado.clear(ctx.conversa_id);
  return null;
}

// ===================== Fluxo de agendamento =====================

/**
 * Busca horários livres e oferece 3 opções.
 * Muda estado para aguardando_escolha.
 */
async function listarEOferecerHorarios({ ctx, profissionalId, servicoId, dataISO, periodo, horaPreferida = null, resumoIA, prefixo = '' }) {
  const slots = await agendaService.listarHorariosLivresUnidade({
    unidadeId: ctx.unidade_id,
    profissionalId,
    servicoId,
    dataISO,
    periodo,
    limite: 10,
  });

  if (!slots.length) {
    await conversaEstado.clear(ctx.conversa_id);
    return reply('Não encontrei horários livres nesse período 😕 Quer tentar outro dia ou período?');
  }

  let slotsOrdenados = slots;
  const alvoMin = hhmmToMinutes(horaPreferida);
  if (alvoMin !== null) {
    slotsOrdenados = [...slots].sort((a, b) => {
      const aMin = hhmmToMinutes(formatHoraTZ(a.inicio, ctx.timezone));
      const bMin = hhmmToMinutes(formatHoraTZ(b.inicio, ctx.timezone));
      return Math.abs(aMin - alvoMin) - Math.abs(bMin - alvoMin);
    });
  }

  const opcoes = slotsOrdenados.slice(0, 3).map((s, i) => ({
    idx: i + 1,
    inicio: s.inicio,
    fim: s.fim,
  }));

  await conversaEstado.upsert(ctx.conversa_id, {
    estado: 'aguardando_escolha',
    ultima_lista: {
      tipo: 'horarios',
      token: token(),
      data: dataISO,
      periodo,
      hora_preferida: horaPreferida,
      servico_id: servicoId,
      profissional_id: profissionalId,
      opcoes,
      resumo_ia: resumoIA,
      created_at: new Date().toISOString(),
    },
  });

  return reply(prefixo + buildHorarioMenu(opcoes, ctx.timezone));
}

/**
 * Com serviço resolvido, tenta resolver profissional e listar horários.
 */
async function continuarComServico({ ctx, servicoId, dataISO, periodo, horaPreferida = null, resumoIA }) {
  const profs = await profissionalResolver.listarProfissionaisPorServico({
    unidadeId: ctx.unidade_id,
    servicoId,
  });

  if (!profs.length) {
    await conversaEstado.clear(ctx.conversa_id);
    return reply('Não encontrei profissionais para esse serviço 😕');
  }

  if (profs.length > 1) {
    await conversaEstado.upsert(ctx.conversa_id, {
      estado: 'aguardando_profissional',
      ultima_lista: {
        tipo: 'profissionais',
        token: token(),
        data: dataISO,
        periodo,
        hora_preferida: horaPreferida,
        servico_id: servicoId,
        profissionais: profs,
        resumo_ia: resumoIA,
        created_at: new Date().toISOString(),
      },
    });
    return reply(buildProfissionaisMenu(profs));
  }

  // Só 1 profissional → direto para horários
  return await listarEOferecerHorarios({
    ctx,
    profissionalId: profs[0].id,
    servicoId,
    dataISO,
    periodo,
    horaPreferida,
    resumoIA,
  });
}

/**
 * Handler principal para intent = novo_agendamento.
 * Resolve data → serviço → profissional → horários.
 */
async function handleNovoAgendamento({ ctx, entities, resumoIA, texto }) {
  const inferred = inferEntitiesFromText(texto, ctx.timezone);
  const horario = entities.horario || inferred.horario || null;

  // 1) Resolver DATA
  let dataISO = entities.data || inferred.data;
  if (dataISO && !/^\d{4}-\d{2}-\d{2}$/.test(dataISO)) {
    // IA retornou algo que não é YYYY-MM-DD (ex: "amanhã")
    dataISO = parseDataPtBR(dataISO, { timezone: ctx.timezone }) || null;
  }
  if (!dataISO) {
    // Tentar extrair do texto original
    dataISO = parseDataPtBR(texto, { timezone: ctx.timezone });
  }

  const periodo = entities.periodo || inferred.periodo || periodoFromHora(horario) || 'manha';

  if (!dataISO) {
    const servicoHint = entities.servico || inferred.servico;
    await conversaEstado.upsert(ctx.conversa_id, {
      estado: 'coletando_dados',
      ultima_lista: { falta: 'data', periodo, hora_preferida: horario, servico_hint: servicoHint, resumo_ia: resumoIA },
    });
    if (servicoHint) {
      return reply(
        `Beleza! Você quer ${servicoHint} 👍\n` +
        'Qual dia você prefere?\n' +
        'Pode ser assim:\n' +
        '- amanhã\n' +
        '- sexta\n' +
        '- 20/03'
      );
    }
    return reply(
      'Qual dia você prefere?\n' +
      'Pode ser assim:\n' +
      '- amanhã\n' +
      '- sexta\n' +
      '- 20/03'
    );
  }

  // 2) Resolver SERVIÇO
  let servicoId = null;
  const servicoTexto = entities.servico || inferred.servico;
  if (servicoTexto) {
    const svc = await servicoResolver.resolverPorNome({
      unidadeId: ctx.unidade_id,
      nomeServico: servicoTexto,
    });
    servicoId = svc?.id || null;
  }

  // Fallback: tenta mapear serviço direto no texto completo
  if (!servicoId) {
    const svc = await servicoResolver.resolverPorNome({
      unidadeId: ctx.unidade_id,
      nomeServico: texto,
    });
    servicoId = svc?.id || null;
  }

  if (!servicoId) {
    const svcs = await servicoResolver.listarServicosDaUnidade({ unidadeId: ctx.unidade_id });
    if (svcs.length === 0) {
      await conversaEstado.clear(ctx.conversa_id);
      return reply(
        'Ainda não encontrei serviços ativos nessa unidade 😕\n' +
        'Peça para o responsável vincular serviços a profissionais ativos e eu já sigo com o agendamento.'
      );
    }
    if (svcs.length === 1) {
      servicoId = svcs[0].id;
    } else {
      await conversaEstado.upsert(ctx.conversa_id, {
        estado: 'coletando_dados',
        ultima_lista: {
          falta: 'servico',
          data: dataISO,
          periodo,
          hora_preferida: horario,
          servicos: svcs.map(s => ({ id: s.id, nome: s.nome })),
          resumo_ia: resumoIA,
        },
      });
      return reply(buildServicosMenu(svcs));
    }
  }

  // 3) Resolver PROFISSIONAL → HORÁRIOS
  return await continuarComServico({ ctx, servicoId, dataISO, periodo, horaPreferida: horario, resumoIA });
}

// ===================== Endpoint principal =====================

function isApiKeyAuthorized(req) {
  const key = safeString(req.headers['x-api-key']);
  return !!process.env.API_KEY && key === process.env.API_KEY;
}

function isWuzapiWebhookAuthorized(req) {
  if (isApiKeyAuthorized(req)) return true;

  const configuredSecret = safeString(process.env.WUZAPI_WEBHOOK_SECRET);
  const providedSecret = pickFirstString([
    req.headers['x-webhook-secret'],
    req.query?.webhook_secret,
    req.query?.secret,
    req.body?.webhook_secret,
  ]);

  if (configuredSecret) return providedSecret === configuredSecret;

  // Em dev, permite sem segredo para facilitar setup inicial.
  return String(process.env.NODE_ENV || '').toLowerCase() !== 'production';
}

async function maybeDeliverViaWuzapi({
  response,
  canalId,
  instanceKey,
  destinationE164,
  enabled,
}) {
  const messages = (response?.messages || []).filter((m) => (m?.type || 'text') === 'text' && safeString(m?.text));

  if (!enabled) {
    return {
      enabled: false,
      provider: 'wuzapi',
      attempted: 0,
      sent: 0,
      failed: 0,
      reason: 'direct_send_disabled',
    };
  }

  if (response?.shouldReply !== true || messages.length === 0) {
    return {
      enabled: true,
      provider: 'wuzapi',
      attempted: 0,
      sent: 0,
      failed: 0,
      reason: 'no_text_messages',
    };
  }

  const results = [];
  let sent = 0;

  for (const m of messages) {
    try {
      const sentMsg = await sendTextViaWuzapi({
        canalId,
        instanceKey,
        to: destinationE164,
        text: m.text,
      });
      sent += 1;
      results.push({
        ok: true,
        destination: sentMsg.destination,
        status: sentMsg.status,
      });
    } catch (error) {
      results.push({
        ok: false,
        error: error.message,
        code: error.code || null,
        details: error.details || null,
      });
    }
  }

  return {
    enabled: true,
    provider: 'wuzapi',
    attempted: messages.length,
    sent,
    failed: messages.length - sent,
    results,
  };
}

/**
 * Entrega direta via Evolution API (provedor principal).
 * Tenta enviar cada mensagem de texto via Evolution API.
 */
async function maybeDeliverViaEvolution({
  response,
  canalId,
  instanceKey,
  destinationE164,
  enabled,
}) {
  const messages = (response?.messages || []).filter((m) => (m?.type || 'text') === 'text' && safeString(m?.text));

  if (!enabled) {
    return {
      enabled: false,
      provider: 'evolution',
      attempted: 0,
      sent: 0,
      failed: 0,
      reason: 'direct_send_disabled',
    };
  }

  if (response?.shouldReply !== true || messages.length === 0) {
    return {
      enabled: true,
      provider: 'evolution',
      attempted: 0,
      sent: 0,
      failed: 0,
      reason: 'no_text_messages',
    };
  }

  const results = [];
  let sent = 0;

  for (const m of messages) {
    try {
      const sentMsg = await sendTextViaEvolution({
        canalId,
        instanceKey,
        to: destinationE164,
        text: m.text,
      });
      sent += 1;
      // Captura o message_id retornado pela Evolution para identificar o
      // eco no webhook (caso o dono esteja testando consigo mesmo).
      const sentMessageId = sentMsg?.data?.key?.id || sentMsg?.data?.id || null;
      results.push({
        ok: true,
        destination: sentMsg.destination,
        status: sentMsg.status,
        message_id: sentMessageId,
        text: m.text,
      });
    } catch (error) {
      results.push({
        ok: false,
        error: error.message,
        code: error.code || null,
        details: error.details || null,
      });
    }
  }

  return {
    enabled: true,
    provider: 'evolution',
    attempted: messages.length,
    sent,
    failed: messages.length - sent,
    results,
  };
}

/**
 * Resolve qual provedor usar para entrega direta de mensagens.
 * Prioridade: Evolution API > WuzAPI > nenhum.
 */
async function resolveAndDeliver({
  response,
  canalId,
  instanceKey,
  destinationE164,
  enabled,
  provedor,
}) {
  // Se entrega não habilitada, retorna sem tentar
  if (!enabled) {
    return {
      enabled: false,
      provider: 'none',
      attempted: 0,
      sent: 0,
      failed: 0,
      reason: 'direct_send_disabled',
    };
  }

  // Tenta Evolution primeiro (provedor principal)
  const evolutionEnabled = String(process.env.EVOLUTION_SEND_ENABLED || 'true').toLowerCase() === 'true';
  if (evolutionEnabled && process.env.EVOLUTION_API_KEY) {
    try {
      const result = await maybeDeliverViaEvolution({
        response,
        canalId,
        instanceKey,
        destinationE164,
        enabled: true,
      });
      if (result.sent > 0) return result;
      // Se falhou tudo, tenta WuzAPI como fallback
      if (result.failed > 0) {
        console.warn('[delivery] Evolution falhou, tentando WuzAPI como fallback...');
      }
    } catch (err) {
      console.warn('[delivery] Evolution indisponível, tentando WuzAPI como fallback:', err.message);
    }
  }

  // Fallback: WuzAPI
  const wuzapiEnabled = String(process.env.WUZAPI_SEND_ENABLED || 'false').toLowerCase() === 'true';
  if (wuzapiEnabled) {
    return maybeDeliverViaWuzapi({
      response,
      canalId,
      instanceKey,
      destinationE164,
      enabled: true,
    });
  }

  return {
    enabled: true,
    provider: 'none',
    attempted: 0,
    sent: 0,
    failed: 0,
    reason: 'no_provider_available',
  };
}

async function processMessageRouterPayload(payload, options = {}) {
  const source = options.source || 'message_router';
  const normalized = normalizeIncomingPayload(payload || {}, { providerHint: options.providerHint || null });

  console.log(`[${source}] Recebido: from=${normalized.from_raw} text="${(normalized.text || '').slice(0, 80)}" event=${normalized.event} fromMe=${normalized.from_me}`);

  try {
    const inbound = await shouldProcessInboundMessage(normalized);
    if (!inbound.process) {
      return {
        statusCode: 200,
        response: {
          action: 'skip',
          shouldReply: false,
          messages: [],
          debug: {
            reason: inbound.reason,
            source,
            event: normalized.event || null,
          },
        },
      };
    }

    const {
      provedor,
      instance_key,
      to_numero_e164,
      from_raw,
      from_name,
      text,
      message_id,
      message_type,
      raw_payload,
    } = normalized;

    if (!message_id) {
      console.warn('[message-router] message_id ausente no payload - dedup desativada para esta msg');
    }

    // Dedup webhook (evita reprocessar mesma mensagem)
    if (message_id) {
      const { rows: dupRows } = await pool.query(
        `SELECT 1 FROM integracoes.whatsapp_mensagem WHERE message_id = $1 AND direcao = 'in' LIMIT 1`,
        [message_id]
      );
      if (dupRows.length) {
        return {
          statusCode: 200,
          response: {
            action: 'skip',
            shouldReply: false,
            messages: [],
            debug: { reason: 'duplicate_message', message_id, source },
          },
        };
      }
    }

    const from_whatsapp_e164 = await normalizarE164(from_raw);

    // 1) Resolver canal -> empresa / unidade
    let canal = await resolverCanalWhatsapp({ to_numero_e164, provedor, instance_key });
    if (!canal) canal = await autoProvisionarCanal({ to_numero_e164, provedor, instance_key });
    if (!canal) {
      return {
        statusCode: 200,
        response: {
          ...reply(
            'Esse numero/canal ainda nao esta cadastrado no sistema.\n' +
            'Peca ao responsavel cadastrar o WhatsApp da empresa.'
          ),
          debug: { reason: 'canal_nao_encontrado', to_numero_e164, instance_key, provedor, source },
        },
      };
    }

    const { canal_id, empresa_id, unidade_id } = canal;

    // Timezone da unidade (para dateParser e formatacao)
    const timezone = await agendaService.getTimezoneUnidade(unidade_id);

    // 2) Politica de contato
    const modo = await getPoliticaContato({ empresa_id, canal_id, whatsapp_e164: from_whatsapp_e164 });
    if (modo === 'ignorar') {
      await logMensagem({
        empresa_id,
        unidade_id,
        canal_id,
        cliente_id: null,
        direcao: 'in',
        message_id,
        message_type,
        texto: text,
        payload: raw_payload,
      });
      return {
        statusCode: 200,
        response: {
          action: 'ignore',
          shouldReply: false,
          messages: [],
          debug: { policy: 'ignorar', source },
        },
      };
    }

    // 3) Get / create cliente
    const cliente_id = await getOrCreateClienteId({
      empresa_id,
      nome: from_name,
      whatsapp_e164: from_whatsapp_e164,
    });

    // 4) Get / create conversa
    const conversa = await getOrCreateConversa({ empresa_id, unidade_id, canal_id, cliente_id });
    const conversa_id = conversa?.conversa_id || conversa?.id;
    if (!conversa_id) {
      return {
        statusCode: 200,
        response: { ...reply('Erro interno: conversa nao resolvida.'), debug: { conversa, source } },
      };
    }

    const ctx = { empresa_id, unidade_id, canal_id, cliente_id, conversa_id, timezone };

    // 5) Log inbound
    await logMensagem({
      empresa_id,
      unidade_id,
      canal_id,
      cliente_id,
      direcao: 'in',
      message_id,
      message_type,
      texto: text,
      payload: raw_payload,
    });

    // 6) Buscar estado da conversa
    const estadoRow = await conversaEstado.get(conversa_id);
    const textoNorm = normalizeText(text);

    console.log(`[${source}] Estado conversa=${conversa_id}: ${estadoRow?.estado || 'null/idle'}`);

    let response = null;

    // 7) State machine - estados guiados (sem chamar IA)
    try {
      if (estadoRow?.estado === 'aguardando_escolha') {
        response = await handleAguardandoEscolha({ ctx, estadoRow, texto: textoNorm });
      } else if (estadoRow?.estado === 'aguardando_confirmacao') {
        response = await handleAguardandoConfirmacao({ ctx, estadoRow, texto: textoNorm });
      } else if (estadoRow?.estado === 'aguardando_profissional') {
        response = await handleAguardandoProfissional({ ctx, estadoRow, texto: textoNorm });
      } else if (estadoRow?.estado === 'coletando_dados') {
        response = await handleColetandoDados({ ctx, estadoRow, texto: textoNorm });
        // null = nao conseguiu interpretar -> cai para IA abaixo
      }
    } catch (stateErr) {
      console.error(`[${source}] Erro no state machine (${estadoRow?.estado}):`, stateErr.message);
      // Limpa estado corrompido e cai pro fallback de IA
      try { await conversaEstado.clear(conversa_id); } catch (_) {}
      response = null;
    }

    // 8) Estado livre / fallback: chamar IA
    if (!response) {
      console.log(`[${source}] Chamando IA para classificar...`);
      let ia;
      try {
        ia = await classificarMensagemIA({ text, timezone });
      } catch (iaErr) {
        console.error(`[${source}] Erro na IA:`, iaErr.message);
        ia = { intent: 'outro', entities: {}, confidence: 0, _error: iaErr.message };
      }
      console.log(`[${source}] IA resultado: intent=${ia.intent} confidence=${ia.confidence}`);

      const inferred = inferEntitiesFromText(text, timezone);
      const mergedEntities = {
        data: ia?.entities?.data || inferred.data || null,
        periodo: ia?.entities?.periodo || inferred.periodo || null,
        servico: ia?.entities?.servico || inferred.servico || null,
        profissional: ia?.entities?.profissional || null,
        horario: ia?.entities?.horario || inferred.horario || null,
      };
      const shouldHandleAgendamento = ia.intent === 'novo_agendamento' || hasSinalAgendamento(text);

      if (shouldHandleAgendamento) {
        try {
          response = await handleNovoAgendamento({
            ctx,
            entities: mergedEntities,
            resumoIA: { ...ia, entities: mergedEntities },
            texto: text,
          });
        } catch (agendErr) {
          console.error(`[${source}] Erro em handleNovoAgendamento:`, agendErr.message);
          response = reply('Tive um probleminha aqui 😅 Tenta de novo que já resolvo!');
        }
      } else {
        // Limpa estado residual e fallback generico
        if (estadoRow?.estado && estadoRow.estado !== 'idle') {
          try { await conversaEstado.clear(conversa_id); } catch (_) {}
        }
        response = reply(
          'Consigo ajudar com agendamentos! 🙂\n' +
          'Me diz o que voce precisa - ex: "quero agendar um corte amanha de manha".'
        );
      }
    }

    // 9) Enriquecer resposta com state + debug
    const estadoAtual = await conversaEstado.get(conversa_id);
    response.state = {
      estado: estadoAtual?.estado || 'idle',
      intencao_id: estadoAtual?.intencao_id || null,
    };
    response.debug = {
      empresa_id,
      unidade_id,
      canal_id,
      cliente_id,
      conversa_id,
      policy: modo || 'default',
      source,
    };

    // 10) Entrega direta (Evolution API → WuzAPI fallback, sem N8N)
    //     Feita ANTES do log de outbound pra capturar o message_id retornado.
    const shouldDeliverNow =
      options.deliverNow === true ||
      parseBoolean(payload?.send_direct, false) ||
      parseBoolean(payload?.send_now, false) ||
      parseBoolean(process.env.EVOLUTION_AUTO_SEND, false);

    console.log(`[${source}] Entregando resposta: shouldDeliver=${shouldDeliverNow} msgs=${(response.messages || []).length}`);

    try {
      response.delivery = await resolveAndDeliver({
        response,
        canalId: canal_id,
        instanceKey: instance_key,
        destinationE164: from_whatsapp_e164,
        enabled: shouldDeliverNow,
        provedor: provedor,
      });
      console.log(`[${source}] Entrega: provider=${response.delivery?.provider} sent=${response.delivery?.sent} failed=${response.delivery?.failed}`);
    } catch (deliveryErr) {
      console.error(`[${source}] Erro na entrega:`, deliveryErr.message);
      response.delivery = { enabled: true, provider: 'error', sent: 0, failed: 1, error: deliveryErr.message };
    }

    // 11) Log outbound — usa message_id real entregue (essencial pra
    //     filtrar o eco do próprio bot quando o dono testa consigo mesmo).
    try {
      const deliveryResults = response.delivery?.results || [];
      let deliveryIdx = 0;
      for (const m of response.messages || []) {
        const r = deliveryResults[deliveryIdx++];
        const sentMessageId = r?.ok ? (r.message_id || null) : null;
        await logMensagem({
          empresa_id,
          unidade_id,
          canal_id,
          cliente_id,
          direcao: 'out',
          message_id: sentMessageId,
          message_type: m.type || 'text',
          texto: m.text,
          payload: null,
        });
      }
    } catch (logErr) {
      console.error(`[${source}] Erro ao logar outbound:`, logErr.message);
    }

    return { statusCode: 200, response };
  } catch (err) {
    console.error(`[message-router:${source}] Erro GERAL:`, err);
    // Tenta enviar mensagem de erro mesmo em falha catastrófica
    const errorResponse = {
      action: 'reply',
      shouldReply: true,
      messages: [{ type: 'text', text: 'Tive um probleminha 😕 Tenta de novo!' }],
      debug: { source, error: err.message },
    };
    // Tenta entregar a mensagem de erro
    if (options.deliverNow) {
      try {
        const normalized2 = normalizeIncomingPayload(payload || {}, {});
        const dest = normalized2.from_raw;
        if (dest) {
          await sendTextViaEvolution({ to: dest, text: errorResponse.messages[0].text }).catch(() => {});
        }
      } catch (_) {}
    }
    return { statusCode: 200, response: errorResponse };
  }
}

router.post('/message-router', async (req, res) => {
  if (!isApiKeyAuthorized(req)) {
    return res.status(401).json({ erro: 'unauthorized' });
  }

  const result = await processMessageRouterPayload(req.body || {}, {
    source: 'message_router',
    providerHint: null,
  });
  return res.status(result.statusCode).json(result.response);
});

router.post('/wuzapi/webhook', async (req, res) => {
  if (!isWuzapiWebhookAuthorized(req)) {
    return res.status(401).json({ erro: 'unauthorized_webhook' });
  }

  const result = await processMessageRouterPayload(req.body || {}, {
    source: 'wuzapi_webhook',
    providerHint: 'wuzapi',
    deliverNow: true,
  });
  return res.status(result.statusCode).json(result.response);
});

/**
 * Webhook endpoint para receber mensagens da Evolution API.
 * A Evolution envia POST com payload no formato:
 * {
 *   "event": "messages.upsert",
 *   "instance": "nome-da-instancia",
 *   "data": {
 *     "key": { "remoteJid": "5511...@s.whatsapp.net", "fromMe": false, "id": "xxx" },
 *     "message": { "conversation": "texto" },
 *     "pushName": "Nome do Contato",
 *     "messageType": "conversation"
 *   }
 * }
 *
 * Auth: aceita x-api-key (via header configurado no webhook da Evolution)
 *       ou EVOLUTION_WEBHOOK_SECRET via query param.
 */
function isEvolutionWebhookAuthorized(req) {
  // 1) x-api-key padrão
  if (isApiKeyAuthorized(req)) return true;

  // 2) Secret via query param ou header
  const configuredSecret = safeString(process.env.EVOLUTION_WEBHOOK_SECRET);
  const providedSecret = pickFirstString([
    req.headers['x-webhook-secret'],
    req.query?.webhook_secret,
    req.query?.secret,
    req.body?.webhook_secret,
  ]);

  if (configuredSecret) return providedSecret === configuredSecret;

  // Em dev, permite sem segredo para facilitar setup inicial.
  return String(process.env.NODE_ENV || '').toLowerCase() !== 'production';
}

router.post('/evolution/webhook', async (req, res) => {
  if (!isEvolutionWebhookAuthorized(req)) {
    return res.status(401).json({ erro: 'unauthorized_webhook' });
  }

  // Responde 200 IMEDIATAMENTE para a Evolution não dar timeout.
  // O processamento real acontece em background.
  res.status(200).json({ ok: true, queued: true });

  // Extrai phone key para serializar mensagens do mesmo remetente
  const normalized = normalizeIncomingPayload(req.body || {}, { providerHint: 'evolution' });
  const phoneKey = normalized.from_raw || normalized.remote_jid || 'unknown';

  // Processa em background, serializado por telefone
  enqueueByPhone(phoneKey, async () => {
    try {
      await processMessageRouterPayload(req.body || {}, {
        source: 'evolution_webhook',
        providerHint: 'evolution',
        deliverNow: true,
      });
    } catch (err) {
      console.error('[evolution/webhook] Erro no processamento async:', err);
    }
  });
});

module.exports = {
  router,
  processMessageRouterPayload,
};
