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
const { safeString } = require('../utils/helpers');

// --- Services novos (factory recebe pool) ---
const agendaService = require('../services/agenda.service')(pool);
const conversaEstado = require('../services/conversaEstado.service')(pool);
const profissionalResolver = require('../services/profissionalResolver.service')(pool);
const servicoResolver = require('../services/servicoResolver.service')(pool);

// --- Utils ---
const { parseEscolha, parseConfirmacao, parseCancelarFluxo, normalizeText } = require('../utils/flowParser');
const { parseDataPtBR } = require('../utils/dateParser');

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

  const lista = estadoRow.ultima_lista || {};
  const falta = lista.falta;

  // --- Faltava a DATA ---
  if (falta === 'data') {
    const dataISO = parseDataPtBR(texto, { timezone: ctx.timezone });
    if (!dataISO) {
      return reply('Não entendi a data 😕 Tenta algo como: amanhã, sexta, 20/02');
    }

    // Merge e continuar o fluxo de agendamento
    const entities = {
      ...(lista.resumo_ia?.entities || {}),
      data: dataISO,
      periodo: lista.periodo || 'manha',
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
async function listarEOferecerHorarios({ ctx, profissionalId, servicoId, dataISO, periodo, resumoIA, prefixo = '' }) {
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

  const opcoes = slots.slice(0, 3).map((s, i) => ({
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
async function continuarComServico({ ctx, servicoId, dataISO, periodo, resumoIA }) {
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
    resumoIA,
  });
}

/**
 * Handler principal para intent = novo_agendamento.
 * Resolve data → serviço → profissional → horários.
 */
async function handleNovoAgendamento({ ctx, entities, resumoIA, texto }) {
  // 1) Resolver DATA
  let dataISO = entities.data;
  if (dataISO && !/^\d{4}-\d{2}-\d{2}$/.test(dataISO)) {
    // IA retornou algo que não é YYYY-MM-DD (ex: "amanhã")
    dataISO = parseDataPtBR(dataISO, { timezone: ctx.timezone }) || null;
  }
  if (!dataISO) {
    // Tentar extrair do texto original
    dataISO = parseDataPtBR(texto, { timezone: ctx.timezone });
  }

  const periodo = entities.periodo || 'manha';

  if (!dataISO) {
    await conversaEstado.upsert(ctx.conversa_id, {
      estado: 'coletando_dados',
      ultima_lista: { falta: 'data', periodo, resumo_ia: resumoIA },
    });
    return reply('Pra qual dia você quer agendar? (ex: amanhã, sexta, 20/02)');
  }

  // 2) Resolver SERVIÇO
  let servicoId = null;
  if (entities.servico) {
    const svc = await servicoResolver.resolverPorNome({
      unidadeId: ctx.unidade_id,
      nomeServico: entities.servico,
    });
    servicoId = svc?.id || null;
  }

  if (!servicoId) {
    const svcs = await servicoResolver.listarServicosDaUnidade({ unidadeId: ctx.unidade_id });
    if (svcs.length === 0) {
      await conversaEstado.clear(ctx.conversa_id);
      return reply('Não encontrei serviços disponíveis nessa unidade 😕');
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
          servicos: svcs.map(s => ({ id: s.id, nome: s.nome })),
          resumo_ia: resumoIA,
        },
      });
      return reply(buildServicosMenu(svcs));
    }
  }

  // 3) Resolver PROFISSIONAL → HORÁRIOS
  return await continuarComServico({ ctx, servicoId, dataISO, periodo, resumoIA });
}

// ===================== Endpoint principal =====================

router.post('/message-router', async (req, res) => {
  try {
    const payload = req.body || {};

    // ─── Extrair campos do payload ───
    // Suporta 2 formatos:
    //   A) N8N mapeado: { message_id, instance_key, from_whatsapp_e164, text, ... }
    //   B) Evolution API raw: { instance, data: { key: { id, remoteJid }, message, pushName, ... } }
    // Campos do formato N8N têm prioridade; fallback para formato Evolution nativo.

    const evoData = payload.data || {};
    const evoKey  = evoData.key || {};

    const provedor       = safeString(payload.provedor) || 'evolution';
    const instance_key   = safeString(payload.instance_key)
                        || safeString(payload.instance);         // Evolution raw
    const to_numero_e164 = safeString(payload.to_numero_e164);

    const from_raw       = safeString(payload.from_whatsapp_e164)
                        || extractE164FromJid(evoKey.remoteJid); // Evolution raw
    const from_name      = safeString(payload.from_name)
                        || safeString(evoData.pushName);         // Evolution raw
    const text           = safeString(payload.text)
                        || safeString(evoData.message?.conversation)
                        || safeString(evoData.message?.extendedTextMessage?.text); // Evolution raw
    const message_id     = safeString(payload.message_id)
                        || safeString(evoKey.id);                // Evolution raw
    const message_type   = safeString(payload.message_type)
                        || safeString(evoData.messageType) || 'text';
    const raw_payload    = payload?.metadata?.raw ?? payload?.raw ?? payload;

    if (!message_id) {
      console.warn('[message-router] ⚠ message_id ausente no payload — dedup desativada para esta msg');
    }

    if (!from_raw || !text) {
      return res.status(400).json({ erro: 'Campos obrigatórios: from_whatsapp_e164, text' });
    }

    // ─── Dedup webhook (evita reprocessar mesma mensagem) ───
    if (message_id) {
      const { rows: dupRows } = await pool.query(
        `SELECT 1 FROM integracoes.whatsapp_mensagem WHERE message_id = $1 AND direcao = 'in' LIMIT 1`,
        [message_id]
      );
      if (dupRows.length) {
        return res.json({ action: 'skip', shouldReply: false, messages: [], debug: { reason: 'duplicate_message', message_id } });
      }
    }

    const from_whatsapp_e164 = await normalizarE164(from_raw);

    // ─── 1) Resolver canal → empresa / unidade ───
    let canal = await resolverCanalWhatsapp({ to_numero_e164, provedor, instance_key });
    if (!canal) canal = await autoProvisionarCanal({ to_numero_e164, provedor, instance_key });
    if (!canal) {
      return res.json({
        ...reply(
          'Esse número/canal ainda não está cadastrado no sistema.\n' +
          'Peça ao responsável cadastrar o WhatsApp da empresa.'
        ),
        debug: { reason: 'canal_nao_encontrado', to_numero_e164, instance_key, provedor },
      });
    }

    const { canal_id, empresa_id, unidade_id } = canal;

    // ─── Timezone da unidade (para dateParser e formatação) ───
    const timezone = await agendaService.getTimezoneUnidade(unidade_id);

    // ─── 2) Política de contato ───
    const modo = await getPoliticaContato({ empresa_id, canal_id, whatsapp_e164: from_whatsapp_e164 });
    if (modo === 'ignorar') {
      await logMensagem({
        empresa_id, unidade_id, canal_id, cliente_id: null,
        direcao: 'in', message_id, message_type, texto: text, payload: raw_payload,
      });
      return res.json({ action: 'ignore', shouldReply: false, messages: [], debug: { policy: 'ignorar' } });
    }

    // ─── 3) Get / create cliente ───
    const cliente_id = await getOrCreateClienteId({
      empresa_id,
      nome: from_name,
      whatsapp_e164: from_whatsapp_e164,
    });

    // ─── 4) Get / create conversa ───
    const conversa = await getOrCreateConversa({ empresa_id, unidade_id, canal_id, cliente_id });
    const conversa_id = conversa?.conversa_id || conversa?.id;
    if (!conversa_id) {
      return res.json({ ...reply('Erro interno: conversa não resolvida.'), debug: { conversa } });
    }

    const ctx = { empresa_id, unidade_id, canal_id, cliente_id, conversa_id, timezone };

    // ─── 5) Log inbound ───
    await logMensagem({
      empresa_id, unidade_id, canal_id, cliente_id,
      direcao: 'in', message_id, message_type, texto: text, payload: raw_payload,
    });

    // ─── 6) Buscar estado da conversa ───
    const estadoRow = await conversaEstado.get(conversa_id);
    const textoNorm = normalizeText(text);

    let response = null;

    // ─── 7) State machine — estados guiados (sem chamar IA) ───
    if (estadoRow?.estado === 'aguardando_escolha') {
      response = await handleAguardandoEscolha({ ctx, estadoRow, texto: textoNorm });

    } else if (estadoRow?.estado === 'aguardando_confirmacao') {
      response = await handleAguardandoConfirmacao({ ctx, estadoRow, texto: textoNorm });

    } else if (estadoRow?.estado === 'aguardando_profissional') {
      response = await handleAguardandoProfissional({ ctx, estadoRow, texto: textoNorm });

    } else if (estadoRow?.estado === 'coletando_dados') {
      response = await handleColetandoDados({ ctx, estadoRow, texto: textoNorm });
      // null = não conseguiu interpretar → cai para IA abaixo
    }

    // ─── 8) Estado livre / fallback: chamar IA ───
    if (!response) {
      const ia = await classificarMensagemIA({ text });

      if (ia.intent === 'novo_agendamento') {
        response = await handleNovoAgendamento({
          ctx,
          entities: ia.entities || {},
          resumoIA: ia,
          texto: text,
        });
      } else {
        // Limpa estado residual e fallback genérico
        if (estadoRow?.estado && estadoRow.estado !== 'idle') {
          await conversaEstado.clear(conversa_id);
        }
        response = reply(
          'Consigo ajudar com agendamentos! 🙂\n' +
          'Me diz o que você precisa — ex: "quero agendar um corte amanhã de manhã".'
        );
      }
    }

    // ─── 9) Enriquecer resposta com state + debug ───
    const estadoAtual = await conversaEstado.get(conversa_id);
    response.state = {
      estado: estadoAtual?.estado || 'idle',
      intencao_id: estadoAtual?.intencao_id || null,
    };
    response.debug = {
      empresa_id, unidade_id, canal_id, cliente_id, conversa_id,
      policy: modo || 'default',
    };

    // ─── 10) Log outbound ───
    for (const m of (response.messages || [])) {
      await logMensagem({
        empresa_id, unidade_id, canal_id, cliente_id,
        direcao: 'out', message_id: null,
        message_type: m.type || 'text', texto: m.text, payload: null,
      });
    }

    return res.json(response);

  } catch (err) {
    console.error('[message-router] Erro:', err);
    return res.status(500).json({
      action: 'reply',
      messages: [{ type: 'text', text: 'Erro interno 😕' }],
    });
  }
});

module.exports = router;