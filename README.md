# Kodigo — Agendamentos via WhatsApp com IA

SaaS multi-tenant que recebe mensagens do WhatsApp, interpreta com IA,
e cria/gerencia agendamentos automaticamente.

## Estrutura

```
kodigo-api/
├── backend/                  Node.js (Express) + PostgreSQL
│   ├── app.js                Bootstrap Express, serve frontend e registra rotas
│   ├── server.js             Inicializa o listen (porta PORT ou 3000)
│   ├── config/db.js          Pool pg
│   ├── middlewares/auth.js   Middleware x-api-key
│   ├── routes/
│   │   ├── health.routes.js        /health, /db-ok
│   │   ├── message.routes.js       /message-router, /wuzapi/webhook, /evolution/webhook
│   │   ├── evolution.routes.js     Gestão da Evolution API (status, webhook, envio)
│   │   ├── wuzapi.routes.js        Gestão da WuzAPI (fallback)
│   │   ├── agendamento.routes.js   /criar-intencao, /confirmar-intencao
│   │   ├── app.routes.js           /api/app/* — endpoints do Painel do Cliente
│   │   └── admin.routes.js         /api/admin/* — endpoints do Super Admin
│   ├── services/             Serviços de domínio (agenda, IA, canal, clientes, etc.)
│   ├── utils/                Parsers de datas/fluxo, helpers
│   ├── scripts/              wuzapi-smoke.js
│   └── tests/                Testes manuais end-to-end
├── frontend/                 Estático: landing + painéis (servido por express.static)
│   ├── index.html            Landing page (design original)
│   ├── app.html              Painel do Cliente (dono da empresa)
│   ├── admin.html            Painel Super Admin (dono do SaaS)
│   └── assets/
│       ├── api.js            Cliente HTTP (x-api-key em localStorage)
│       ├── app.js            Renderiza o painel do cliente com dados reais
│       └── admin.js          Renderiza o painel admin com dados reais
├── migrations/               SQL versionado (executar manualmente na ordem)
├── DESIGN/                   Protótipos hi-fi originais (referência)
├── .env                      Segredos (DB, API_KEY, Evolution, WuzAPI)
├── EVOLUTION_SETUP.md        Guia de setup da Evolution
├── WUZAPI_SETUP.md           Guia de setup da WuzAPI
└── package.json              "npm start" → node backend/server.js
```

## Rodando

```bash
npm install
npm start          # backend/server.js (porta 3000 por padrão)
```

Depois abra:

- `http://localhost:3000/` — landing
- `http://localhost:3000/app` — painel do cliente (pede a x-api-key do .env)
- `http://localhost:3000/admin` — painel super admin

## Rotas principais

| Método | Rota                          | Auth | Descrição |
|--------|-------------------------------|------|-----------|
| GET    | `/`                           | —    | Landing page |
| GET    | `/app` `/admin`               | —    | HTML dos painéis (dados via fetch autenticado) |
| GET    | `/health` `/db-ok`            | —    | Healthchecks |
| POST   | `/message-router`             | x-api-key | Recebe mensagens (contrato antigo do N8N) |
| POST   | `/evolution/webhook`          | x-api-key OU `EVOLUTION_WEBHOOK_SECRET` | Webhook da Evolution API |
| POST   | `/wuzapi/webhook`             | x-api-key OU `WUZAPI_WEBHOOK_SECRET` | Webhook da WuzAPI (fallback) |
| POST   | `/evolution/chat/send/text`   | x-api-key | Envia texto via Evolution |
| POST   | `/evolution/webhook/sync`     | x-api-key | Aponta o webhook da Evolution para esta API |
| GET    | `/api/app/context`            | x-api-key | Empresa + unidade do painel |
| GET    | `/api/app/dashboard/stats`    | x-api-key | Stats do dashboard (hoje, semana, fila, cancel.) |
| GET    | `/api/app/agendamentos?range=hoje\|semana\|YYYY-MM-DD` | x-api-key | Agendamentos do range |
| CRUD   | `/api/app/servicos`, `/api/app/profissionais`, `/api/app/clientes`, `/api/app/fila-espera` | x-api-key | Cadastros |
| GET    | `/api/admin/dashboard/stats`  | x-api-key | Stats globais (MRR, empresas, canais) |
| CRUD   | `/api/admin/empresas`, `/api/admin/usuarios`, `/api/admin/canais`, `/api/admin/logs` | x-api-key | Cadastros globais |

## Evolution API

A integração direta com a Evolution substitui o N8N. Ver `EVOLUTION_SETUP.md`.

Variáveis relevantes no `.env`:

```
EVOLUTION_BASE_URL=https://evo.kodigo.cloud
EVOLUTION_API_KEY=...
EVOLUTION_INSTANCE_NAME=Kodigo - Teste
EVOLUTION_SEND_ENABLED=true
EVOLUTION_AUTO_SEND=true
EVOLUTION_WEBHOOK_SECRET=
PUBLIC_BASE_URL=https://api.kodigo.cloud
```

Apontar o webhook da Evolution para esta API (**uma vez**):

```bash
curl -X POST "$PUBLIC_BASE_URL/evolution/webhook/sync" \
  -H "x-api-key: $API_KEY" \
  -H "content-type: application/json" -d '{}'
```

## Multi-tenant

O MVP atual usa `DEFAULT_EMPRESA_ID` e `DEFAULT_UNIDADE_ID` como contexto
dos painéis. Para ativar multi-empresa completo, substituir por sessão
de usuário real (login/JWT + `core.usuario_empresa`).
