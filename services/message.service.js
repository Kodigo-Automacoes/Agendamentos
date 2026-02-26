// services/message.service.js
// ============================================================
// >>> DEPRECATED — não é mais usado <<<
//
// A lógica deste arquivo foi migrada para routes/message.routes.js,
// que agora integra diretamente com os services reais:
//  - canal.service.js, cliente.service.js, conversa.service.js
//  - ia.service.js, mensagem.service.js, politica.service.js
//  - agenda.service.js, conversaEstado.service.js
//  - profissionalResolver.service.js, servicoResolver.service.js
//
// Este arquivo permanece apenas para referência.
// Pode ser removido com segurança em versão futura.
// ============================================================

const { safeString } = require("../utils/helpers");

const { resolverCanalWhatsapp, autoProvisionarCanal } = require("./canal.service");
const { normalizarE164, getOrCreateClienteId } = require("./cliente.service");
const { getPoliticaContato } = require("./politica.service");
const { getOrCreateConversa, atualizarConversa } = require("./conversa.service");
const { logMensagem } = require("./mensagem.service");
const { classificarMensagemIA } = require("./ia.service");

async function messageRouter(req, res) {
  try {
    // payload flexível do N8N/Evolution
    const provedor = safeString(req.body.provedor) || "evolution";
    const instance_key = safeString(req.body.instance_key);     // opcional
    const to_numero_e164 = safeString(req.body.to_numero_e164); // número da empresa (receptor)

    const from_whatsapp_e164_raw = safeString(req.body.from_whatsapp_e164);
    const from_name = safeString(req.body.from_name);
    const text = safeString(req.body.text);

    const message_id = safeString(req.body.message_id);
    const message_type = safeString(req.body.message_type) || "text";

    const raw_payload = req.body?.metadata?.raw ?? req.body?.raw ?? req.body;

    if (!from_whatsapp_e164_raw || !text) {
      return res.status(400).json({
        erro: "Campos obrigatórios: from_whatsapp_e164, text",
      });
    }

    // normaliza número do cliente
    const from_whatsapp_e164 = await normalizarE164(from_whatsapp_e164_raw);

    // 1) resolve canal -> empresa/unidade
    let canal = await resolverCanalWhatsapp({ to_numero_e164, provedor, instance_key });

    // auto provisiona se não existir
    if (!canal) {
      canal = await autoProvisionarCanal({ to_numero_e164, provedor, instance_key });
    }

    // se ainda não achou, responde erro amigável
    if (!canal) {
      return res.json({
        action: "reply",
        messages: [
          {
            type: "text",
            text:
              "Esse número/canal ainda não está cadastrado no sistema.\n" +
              "Peça para o responsável concluir o cadastro do WhatsApp da empresa.",
          },
        ],
        debug: { reason: "canal_nao_encontrado", to_numero_e164, instance_key, provedor },
      });
    }

    const { canal_id, empresa_id, unidade_id } = canal;

    // 2) política do contato
    const modo = await getPoliticaContato({
      empresa_id,
      canal_id,
      whatsapp_e164: from_whatsapp_e164,
    });

    if (modo === "ignorar") {
      // log inbound mesmo ignorando
      await logMensagem({
        empresa_id,
        unidade_id,
        canal_id,
        cliente_id: null,
        direcao: "in",
        message_id,
        message_type,
        texto: text,
        payload: raw_payload,
      });

      return res.json({
        action: "ignore",
        messages: [],
        debug: { policy: "ignorar" },
      });
    }

    // 3) get/create cliente
    const cliente_id = await getOrCreateClienteId({
      empresa_id,
      nome: from_name,
      whatsapp_e164: from_whatsapp_e164,
    });

    // 4) get/create conversa
    const conversa = await getOrCreateConversa({
      empresa_id,
      unidade_id,
      canal_id,
      cliente_id,
    });

    // 5) log inbound
    await logMensagem({
      empresa_id,
      unidade_id,
      canal_id,
      cliente_id,
      direcao: "in",
      message_id,
      message_type,
      texto: text,
      payload: raw_payload,
    });

    // 6) classificar IA
    const cls = await classificarMensagemIA({ text });

    // 7) decisão (MVP guiado — depois liga nas funções do banco)
    let messages = [];
    let novoEstado = conversa.estado;

    if (conversa.estado === "oferta_pendente" && (cls.intent === "confirmacao" || cls.intent === "outro")) {
      messages.push({
        type: "text",
        text:
          "Você quer **aceitar** a oferta de horário?\n" +
          "Responda: **SIM** para aceitar ou **NÃO** para recusar.",
      });
      novoEstado = "oferta_pendente";
    } else if (cls.intent === "novo_agendamento") {
      messages.push({
        type: "text",
        text:
          "Perfeito! Pra eu agendar rapidinho, me diz:\n" +
          "1) Qual serviço?\n" +
          "2) Qual dia ou período (manhã/tarde/noite)?\n" +
          "3) Preferência de profissional (se tiver).",
      });
      novoEstado = "coletando_dados";
    } else if (cls.intent === "confirmacao") {
      messages.push({
        type: "text",
        text:
          "Show! Qual opção/horário você quer confirmar?\n" +
          "Se você recebeu uma lista, responda com o número da opção (ex: 1, 2, 3).",
      });
      novoEstado = "aguardando_confirmacao";
    } else if (cls.intent === "cancelamento") {
      messages.push({
        type: "text",
        text:
          "Certo — você quer cancelar qual agendamento?\n" +
          "Me diga o dia/horário, ou responda **ULTIMO** pra eu buscar seu último agendamento.",
      });
      novoEstado = "coletando_dados";
    } else {
      messages.push({
        type: "text",
        text:
          "Consigo te ajudar com:\n" +
          "• **Agendar** um horário\n" +
          "• **Confirmar** um horário\n" +
          "• **Cancelar** um horário\n\n" +
          "Me diz o que você precisa 🙂",
      });
      novoEstado = "idle";
    }

    // 8) atualizar conversa
    await atualizarConversa(conversa.id, {
      estado: novoEstado,
      ultima_msg_em: new Date().toISOString(),
      ultima_msg_id: message_id,
    });

    // 9) log outbound
    for (const m of messages) {
      await logMensagem({
        empresa_id,
        unidade_id,
        canal_id,
        cliente_id,
        direcao: "out",
        message_id: null,
        message_type: m.type || "text",
        texto: m.text,
        payload: null,
      });
    }

    return res.json({
      action: "reply",
      messages,
      state: {
        estado: novoEstado,
        intencao_id: conversa.intencao_id || null,
        oferta_id: conversa.oferta_id || null,
      },
      debug: {
        empresa_id,
        unidade_id,
        canal_id,
        cliente_id,
        policy: modo || "default",
        intent: cls.intent,
        confidence: cls.confidence,
        entities: cls.entities,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: err.message });
  }
}

module.exports = {
  messageRouter,
};