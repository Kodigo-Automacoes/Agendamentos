async function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  const OpenAI = (await import("openai")).default;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function classificarMensagemIA({ text }) {
  const client = await getOpenAIClient();
  if (!client) {
    return {
      intent: "outro",
      entities: { data: null, periodo: null, servico: null, profissional: null },
      confidence: 0,
      _note: "OPENAI_API_KEY não configurada",
    };
  }

  const system = `
Você é um classificador de intenção para um SaaS de agendamentos via WhatsApp.
Você NÃO conversa. Você retorna APENAS JSON válido.

Classifique intent em:
- novo_agendamento
- confirmacao
- cancelamento
- outro

Extraia entities:
- data: YYYY-MM-DD ou null (se só disser "amanhã" e você não tiver certeza da data, deixe null)
- periodo: "manha" | "tarde" | "noite" | null
- servico: string | null
- profissional: string | null

Retorne exatamente:
{
  "intent": "...",
  "entities": { "data": null, "periodo": null, "servico": null, "profissional": null },
  "confidence": 0.00
}
`.trim();

  const resp = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: text },
    ],
  });

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
      },
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    };
  } catch {
    return {
      intent: "outro",
      entities: { data: null, periodo: null, servico: null, profissional: null },
      confidence: 0,
      _raw: content,
    };
  }
}

module.exports = {
  classificarMensagemIA,
};