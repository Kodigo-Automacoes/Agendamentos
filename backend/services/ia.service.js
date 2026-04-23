async function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  const OpenAI = (await import("openai")).default;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function hojeNoTimezone(timezone = "America/Sao_Paulo") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function classificarMensagemIA({ text, timezone = "America/Sao_Paulo", hoje }) {
  const hojeRef = hoje || hojeNoTimezone(timezone);
  const client = await getOpenAIClient();
  if (!client) {
    return {
      intent: "outro",
      entities: { data: null, periodo: null, servico: null, profissional: null, horario: null },
      confidence: 0,
      _note: "OPENAI_API_KEY não configurada",
    };
  }

  const system = `
Você é um classificador de intenção para um SaaS de agendamentos via WhatsApp.
Você NÃO conversa. Você retorna APENAS JSON válido.
Hoje no fuso ${timezone} é ${hojeRef}.

Classifique intent em:
- novo_agendamento
- confirmacao
- cancelamento
- outro

Extraia entities:
- data: YYYY-MM-DD ou null
- periodo: "manha" | "tarde" | "noite" | null
- servico: string | null
- profissional: string | null
- horario: "HH:mm" | null

Retorne exatamente:
{
  "intent": "...",
  "entities": { "data": null, "periodo": null, "servico": null, "profissional": null, "horario": null },
  "confidence": 0.00
}

Regras:
1) Se o usuário disser "amanhã", "hoje" ou dia da semana, converta para data real usando a referência de hoje.
2) Se houver horário ("14h", "16:30"), normalize para HH:mm.
3) Se o usuário já informou data/horário, não deixe esses campos nulos.
`.trim();

  let resp;
  try {
    resp = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: text },
      ],
    });
  } catch (err) {
    // 401 / timeout / rate-limit não devem derrubar o webhook —
    // o caller faz fallback para parser determinístico (hasSinalAgendamento + dateParser).
    console.warn("[ia] OpenAI falhou, caindo no fallback:", err?.status || "", err?.message);
    return {
      intent: "outro",
      entities: { data: null, periodo: null, servico: null, profissional: null, horario: null },
      confidence: 0,
      _error: err?.message || String(err),
    };
  }

  const content = resp.choices?.[0]?.message?.content || "{}";
  try {
    const parsed = JSON.parse(content);
    if (!parsed.entities) parsed.entities = {};
    return {
      intent: parsed.intent || "outro",
      entities: {
        data: parsed.entities.data ?? null,
        periodo: parsed.entities.periodo ?? null,
        servico: parsed.entities.servico ?? null,
        profissional: parsed.entities.profissional ?? null,
        horario: parsed.entities.horario ?? null,
      },
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    };
  } catch {
    return {
      intent: "outro",
      entities: { data: null, periodo: null, servico: null, profissional: null, horario: null },
      confidence: 0,
      _raw: content,
    };
  }
}

module.exports = {
  classificarMensagemIA,
};
