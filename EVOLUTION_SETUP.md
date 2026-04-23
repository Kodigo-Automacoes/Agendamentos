# Evolution API Integration (sem N8N)

Este projeto agora suporta integração direta com a **Evolution API v2** como provedor principal de WhatsApp, com WuzAPI mantida como fallback.

## Arquitetura

```
Cliente WhatsApp
      ↓
Evolution API (servidor externo)
      ↓ webhook POST /evolution/webhook
kodigo-api (message-router)
      ↓ processa → IA → state machine
      ↓ envia resposta
Evolution API ← POST /message/sendText/{instance}
      ↓
Cliente WhatsApp (recebe resposta)
```

## 1) Variáveis de ambiente

Adicione no `.env`:

```env
# URL base da sua Evolution API
EVOLUTION_BASE_URL=https://evo.kodigo.cloud

# API Key da Evolution (encontre no painel admin)
EVOLUTION_API_KEY=sua-api-key-aqui

# Nome da instância WhatsApp na Evolution
EVOLUTION_INSTANCE_NAME=nome-da-instancia

# Habilita envio direto (sem N8N)
EVOLUTION_SEND_ENABLED=true

# Auto-envia respostas automaticamente (liga entrega direta em todo request)
EVOLUTION_AUTO_SEND=true

# Timeout para chamadas HTTP à Evolution (ms)
EVOLUTION_TIMEOUT_MS=15000

# Segredo para proteger webhook (opcional, recomendado em produção)
EVOLUTION_WEBHOOK_SECRET=troque-por-um-segredo-forte

# URL pública desta API (usado pelo endpoint /evolution/webhook/sync)
PUBLIC_BASE_URL=https://api.kodigo.cloud
```

## 2) Config por canal (opcional, recomendado para multi-tenant)

Você pode salvar config da Evolution por canal em `core.canal_whatsapp.provedor_config`:

```sql
UPDATE core.canal_whatsapp
SET provedor = 'evolution',
    provedor_config = jsonb_build_object(
      'evolution_api_key', 'API_KEY_DA_INSTANCIA',
      'evolution_base_url', 'https://evo.kodigo.cloud',
      'evolution_instance', 'nome-da-instancia',
      'evolution_send_enabled', true
    )
WHERE instance_key = 'barbearia_teste';
```

## 3) Verificar status da instância

```bash
curl -s "$API_URL/evolution/instance/status?instance_key=barbearia_teste" \
  -H "x-api-key: $API_KEY" | jq
```

## 4) Configurar webhook da Evolution para esta API

### Automático (recomendado)

```bash
curl -X POST "$API_URL/evolution/webhook/sync" \
  -H "x-api-key: $API_KEY" \
  -H "content-type: application/json" \
  -d '{"instance_key":"barbearia_teste"}'
```

Isso configura o webhook na Evolution apontando para:
```
https://SEU_DOMINIO/evolution/webhook?webhook_secret=SEU_SEGREDO
```

Com headers `x-api-key` configurados automaticamente.

### Manual (via painel da Evolution)

No painel da Evolution API, configure:
- **URL**: `https://SEU_DOMINIO/evolution/webhook`
- **Events**: `MESSAGES_UPSERT`
- **Headers**: `{"x-api-key": "SUA_API_KEY"}`

## 5) Teste rápido de envio

```bash
curl -X POST "$API_URL/evolution/chat/send/text" \
  -H "x-api-key: $API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "instance_key":"barbearia_teste",
    "to":"5548999991111",
    "text":"Teste de envio direto via Evolution API"
  }'
```

## 6) Comportamento do /message-router

- Continua aceitando payload antigo (N8N/Evolution/WuzAPI)
- Agora também recebe webhook Evolution via `POST /evolution/webhook`
- Com `EVOLUTION_AUTO_SEND=true`, **todas** as respostas são enviadas direto pela Evolution
- Fallback automático: se Evolution falhar, tenta WuzAPI
- O retorno da API inclui `delivery` com resultado de entrega

## 7) Endpoints disponíveis

### Rotas de gestão (protegidas por x-api-key):

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/evolution/config` | Configuração atual (redacted) |
| GET | `/evolution/instance/status` | Status de conexão da instância |
| GET | `/evolution/instance/info` | Informações da instância |
| POST | `/evolution/chat/send/text` | Enviar mensagem de texto |
| GET | `/evolution/webhook` | Verificar webhook configurado |
| POST | `/evolution/webhook` | Configurar webhook manualmente |
| POST | `/evolution/webhook/sync` | Configurar webhook automaticamente |

### Webhook (aceita x-api-key ou EVOLUTION_WEBHOOK_SECRET):

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/evolution/webhook` | Receber mensagens da Evolution API |

## 8) Prioridade de entrega

```
1. Evolution API (EVOLUTION_SEND_ENABLED=true + EVOLUTION_API_KEY configurada)
   ↓ se falhar
2. WuzAPI (WUZAPI_SEND_ENABLED=true)
   ↓ se falhar
3. Retorna JSON sem entregar (o chamador deve enviar)
```

## 9) Verificação de saúde

```bash
# API rodando?
curl -s "$API_URL/" | jq

# Banco conectado?
curl -s "$API_URL/db-ok" | jq

# Evolution conectada?
curl -s "$API_URL/evolution/instance/status" \
  -H "x-api-key: $API_KEY" | jq
```
