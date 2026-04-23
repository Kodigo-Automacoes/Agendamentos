# WUZAPI Integration (sem N8N)

Este projeto agora suporta:

1. Receber webhook direto da WUZAPI (`POST /wuzapi/webhook`)
2. Processar fluxo de agendamento no `message-router`
3. Enviar resposta para WhatsApp direto via WUZAPI (`/chat/send/text`)
4. Gerenciar sessao WUZAPI pela API (`/wuzapi/session/*`)

## 1) Variaveis de ambiente

Adicione no `.env`:

```env
# URL base da WUZAPI
WUZAPI_BASE_URL=http://localhost:8080

# Token padrao de usuario WUZAPI (fallback)
WUZAPI_TOKEN=SEU_TOKEN

# Segredo para proteger webhook publico /wuzapi/webhook
WUZAPI_WEBHOOK_SECRET=troque-por-um-segredo-forte

# Habilita envio direto pelo router (sem N8N)
MESSAGE_ROUTER_DIRECT_SEND=true

# URL publica desta API (usado pelo endpoint /wuzapi/webhook/sync)
PUBLIC_BASE_URL=https://sua-api.exemplo.com
```

Opcional por instancia:

```env
WUZAPI_TOKENS_JSON={"barbearia_teste":"TOKEN_DA_INSTANCIA"}
```

## 2) Config por canal (opcional, recomendado)

Voce pode salvar token/base por canal em `core.canal_whatsapp.provedor_config`.

Exemplo SQL:

```sql
UPDATE core.canal_whatsapp
SET provedor = 'wuzapi',
    provedor_config = jsonb_build_object(
      'wuzapi_token', 'TOKEN_DA_INSTANCIA',
      'wuzapi_base_url', 'http://localhost:8080',
      'wuzapi_send_enabled', true
    )
WHERE instance_key = 'barbearia_teste';
```

## 3) Conectar sessao WhatsApp via API

Todas as rotas abaixo usam `x-api-key`.

- `GET /wuzapi/session/status?instance_key=barbearia_teste`
- `POST /wuzapi/session/connect`
- `GET /wuzapi/session/qr`
- `POST /wuzapi/session/disconnect`
- `POST /wuzapi/session/logout`

## 4) Configurar webhook da WUZAPI para esta API

### Automatico

```bash
curl -X POST "$API_URL/wuzapi/webhook/sync" \
  -H "x-api-key: $API_KEY" \
  -H "content-type: application/json" \
  -d '{"instance_key":"barbearia_teste"}'
```

### Manual

Configure na WUZAPI:

```text
https://SEU_DOMINIO/wuzapi/webhook?webhook_secret=SEU_SEGREDO
```

## 4.1) Criar usuario da instancia (opcional, via admin)

Se sua WUZAPI estiver com `WUZAPI_ADMIN_TOKEN` configurado, coloque o mesmo token no `.env` da API e rode:

```bash
curl -X POST "$API_URL/wuzapi/admin/users/ensure" \
  -H "x-api-key: $API_KEY" \
  -H "content-type: application/json" \
  -d '{"instance_key":"barbearia_teste","public_base_url":"https://SEU_DOMINIO"}'
```

Esse endpoint tenta encontrar usuario existente pelo token/nome e cria se nao existir.

## 5) Teste rapido de envio

```bash
curl -X POST "$API_URL/wuzapi/chat/send/text" \
  -H "x-api-key: $API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "instance_key":"barbearia_teste",
    "to":"5548999991111",
    "text":"Teste de envio direto via WUZAPI"
  }'
```

## 6) Comportamento do /message-router

- Continua aceitando payload antigo (N8N/Evolution)
- Agora tambem recebe webhook WUZAPI via `/wuzapi/webhook`
- Com `MESSAGE_ROUTER_DIRECT_SEND=true`, as respostas sao enviadas direto pela WUZAPI
- O retorno da API inclui `delivery` com resultado de entrega

## 7) Smoke test local

1. Suba a API:

```bash
npm start
```

2. Em outro terminal, rode:

```bash
npm run test:wuzapi
```

3. Se quiser testar envio real no smoke:

```env
WUZAPI_TEST_TO=5548999991111
WUZAPI_TEST_TEXT=Teste real via WUZAPI
```
