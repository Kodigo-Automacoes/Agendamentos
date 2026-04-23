# Handoff: Kodigo — Sistema SaaS de Agendamentos via WhatsApp

## Overview
Kodigo é um SaaS multi-tenant de agendamento automático via WhatsApp com IA. O sistema recebe mensagens de clientes, interpreta a intenção com IA (Node.js + Evolution API), agenda automaticamente e gerencia filas de espera — tudo sem intervenção humana.

Este pacote contém 3 protótipos hi-fi em HTML que servem como referência visual completa para implementação.

---

## ⚠️ Sobre os arquivos de design
Os arquivos `.html` neste pacote são **protótipos de design em HTML puro** — referências visuais criadas para mostrar aparência, layout e comportamento esperados. **Não são código de produção.**

A tarefa do desenvolvedor é **recriar esses designs no ambiente real do projeto** (Node.js + frontend a definir — React é recomendado) usando os padrões, bibliotecas e estrutura já existentes no codebase. Abra os HTMLs no navegador para ver o resultado visual exato.

---

## Fidelidade
**High-fidelity (hifi)** — Os protótipos são mockups pixel-perfect com cores finais, tipografia, espaçamentos, interações e modais funcionais. O desenvolvedor deve recriar a UI com fidelidade usando as bibliotecas do projeto.

---

## Design Tokens

### Cores
```css
--bg:           #07090e   /* fundo principal */
--bg2:          #0d1018   /* fundo secundário / topbar */
--sidebar:      #0b0e16   /* sidebar */
--card:         #131720   /* cards */
--card2:        #181e2a   /* cards destacados */
--border:       rgba(255,255,255,0.06)
--border2:      rgba(255,255,255,0.10)
--text:         #e2e8f0   /* texto principal */
--text2:        #64748b   /* texto apagado */
--text3:        #94a3b8   /* texto secundário */
--accent:       #4ecca3   /* verde teal — cor primária */
--accent-dim:   rgba(78,204,163,0.10)
--accent-glow:  rgba(78,204,163,0.20)
--purple:       #7b6ef6   /* roxo — cor secundária */
--purple-dim:   rgba(123,110,246,0.10)
--red:          #f87171   /* erro / cancelado */
--red-dim:      rgba(248,113,113,0.10)
--yellow:       #fbbf24   /* aviso / pendente */
--yellow-dim:   rgba(251,191,36,0.10)
```

### Tipografia
```
Display / títulos:  Plus Jakarta Sans — 600, 700, 800
Body / interface:   Poppins — 300, 400, 500, 600
Google Fonts URL:   https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Poppins:wght@300;400;500;600
```

### Espaçamento e forma
```
Border radius cards:    12px
Border radius botões:   8px
Border radius badges:   100px (pill)
Border radius modal:    16px
Sidebar width:          220px
Topbar height:          56px
Gap padrão:             16px / 20px / 24px
Padding cards:          20px / 24px
```

### Sombras
```
Modal:      0 32px 80px rgba(0,0,0,.6)
Botão CTA:  0 12px 32px rgba(78,204,163,0.25)
Nav:        backdrop-filter: blur(16px)
```

---

## Screens / Views

### 1. Landing Page (`Landing Page.html`)

**Propósito:** Página pública de vendas do produto. Converte visitantes em trials.

#### Navbar (fixed, blur backdrop)
- Height: 64px | Background: rgba(7,9,14,0.8) | backdrop-filter: blur(16px)
- Logo: "Kodigo." em Plus Jakarta Sans 800, cor `--accent`
- Links: Poppins 14px 500, cor `--text3` → hover `--text`
- CTAs: "Entrar" (ghost) + "Começar grátis →" (primary, bg `--accent`, cor #07090e)

#### Hero
- Background: `--bg` com gradiente radial teal+purple no topo + grid decorativo (linhas 60x60px, opacity .025)
- Badge animado: "IA + WhatsApp · Agendamento automático 24/7" — pill verde com dot pulsante
- H1: Plus Jakarta Sans 800, clamp(40px, 6vw, 76px), letter-spacing: -2px. `<em>` em `--accent`
- Subtítulo: Poppins 300, 18px, cor `--text3`, max-width 520px
- CTAs: botão primário 16px + botão ghost 16px
- Mockup: container com frame de browser (dots vermelho/amarelo/verde), 2 colunas: chat WhatsApp (esq) + mini dashboard (dir)
- Animação: fadeUp staggered (0s, .1s, .2s, .3s, .4s)

#### Barra de Stats
- 4 colunas com borda esquerda/direita | padding 32px | fundo `--bg2`
- Número: Plus Jakarta Sans 800, 36px, cor `--accent`

#### Como Funciona
- 4 cards em grid, borda entre eles | fundo `--card`
- Número decorativo: Plus Jakarta Sans 800, 48px, opacity .1
- Ícone: 44x44px, border-radius 10px, fundo `--accent-dim`

#### Funcionalidades
- Grid 3 colunas | cards com hover: translateY(-2px) + borda top gradiente teal→purple

#### Pricing
- 3 cards: Básico / Profissional (featured, borda `--accent`, glow) / Premium
- Profissional tem `box-shadow: 0 0 40px var(--accent-glow)`
- Lista de features com ✓ verde e × cinza para indisponíveis

#### CTA Banner + Footer
- Banner com glow radial no centro
- Footer: flex space-between, links Poppins 13px `--text2`

---

### 2. Painel do Cliente (`Painel do Cliente.html`)

**Propósito:** Painel usado pelo dono da barbearia/clínica para gerenciar seu negócio.

**Layout geral:** Sidebar (220px) + Main (flex:1). Main = Topbar (56px) + Tabs (40px) + Content (flex:1, overflow-y:auto, padding 24px)

#### Sidebar
- Background: `#0b0e16` | border-right: 1px solid `--border`
- Logo block: logo-mark 32x32px border-radius 8px, bg `--accent`, letra "K" 800
- Biz block: avatar 30x30 border-radius 6px, gradient purple→teal
- Nav items: padding 9px 12px, border-radius 8px | active: bg `--accent-dim`, cor `--accent`, border 1px rgba(78,204,163,.12)
- WhatsApp status: bg rgba(37,211,102,.06), border rgba(37,211,102,.15), dot animado #25d366
- Compact mode: sidebar colapsa para 56px (tweak)

#### Topbar
- Height 56px | bg `--bg2` | border-bottom `--border`
- Título: Plus Jakarta Sans 700, 16px
- User chip: avatar gradiente, border `--border`, hover bg `--card`

#### Screen Tabs
- Tabs navegáveis: Dashboard | Agenda | Serviços | Profissionais | Clientes | Relatórios
- Active: bg `--accent-dim`, cor `--accent`, border rgba(78,204,163,.15)

#### Dashboard
- 4 stat cards em grid (cols: repeat(4,1fr), gap 12px)
  - Barra top 2px com cor do tema de cada card
  - Valor: Plus Jakarta Sans 800, 32px
- Grid 2 colunas: agenda do dia (1fr) + sidebar (340px)
- Slots da agenda: height auto, border-left 3px colorido por status
  - Confirmado: `--accent` | Em andamento: `--purple` | Cancelado: `--red` | Aguardando: `--yellow`
- Mini gráfico de barras semanal (7 colunas, altura proporcional)
- Fila de espera: posição numerada, badge "#1" em `--purple`
- Profissionais: barra de progresso linear (height 4px, border-radius 4px)

#### Agenda Semanal
- Toolbar: navegação semana + toggle Semana/Dia + filtro profissional + "+ Agendamento"
- Grid: coluna de horários (56px) + 7 colunas dos dias
- Header: dia da semana + número | hoje: número em círculo `--accent` bg
- Eventos: position absolute, border-left 3px, border-radius 6px, padding 4px 8px
  - green: bg rgba(78,204,163,.2) | purple: bg rgba(123,110,246,.2) | red: opacity .5 + line-through | yellow: rgba(251,191,36,.15)
- Linha "agora": dot vermelho + linha horizontal vermelha (height 1.5px)
- Coluna de hoje: bg rgba(78,204,163,.02)

#### Serviços
- Grid 3 colunas (+ card de "adicionar" dashed)
- Cards: border-top 2px colorido (verde/roxo/amarelo por serviço)
- Tags: pill com cor por tipo (duração, preço)
- Hover: translateY(-2px)
- Botões: "Editar" (teal) + "Remover" (red) — btn-sm

#### Profissionais
- Grid 2 colunas | card com avatar 52x52 border-radius 12px
- Tags dos serviços vinculados
- Stats: agendamentos/mês + avaliação

#### Clientes
- Tabela com busca + filtro
- Colunas: Cliente | Telefone | Última visita | Total visitas | Ticket médio | Ações
- Total visitas: Plus Jakarta Sans 700, 16px, cor pelo volume (accent/purple/yellow/text3)
- Row clickável → abre modal de histórico

#### Relatórios
- 3 stat cards + grid 2 colunas de gráficos
- Gráfico barras verticais (4 semanas) + barras horizontais (serviços)
- Gráfico de ocupação por profissional: barra linear colorida

---

### 3. Painel Admin (`Painel Admin.html`)

**Propósito:** Painel exclusivo do dono do SaaS para gerenciar todas as empresas clientes.

**Diferença visual:** Logo-mark vermelho (vs teal no cliente) + badge "Admin" vermelho

#### Sidebar
- Mesma estrutura do cliente, porém logo-mark bg `--red`
- User role: "Super Admin" em `--red`
- 6 seções: Dashboard | Empresas | Usuários | Planos | Logs | Suporte

#### Dashboard Admin
- 4 stats: Empresas ativas (accent) | MRR (purple) | Agend./mês (yellow) | Inadimplentes (red)
- Grid 2 colunas: gráfico MRR (1fr) + atividade recente (320px)
- Gráfico MRR: 12 barras mensais, gradiente vertical teal
- Distribuição de planos: barras horizontais (Profissional/Básico/Premium)
- Log de atividade: tipo badge colorido + empresa roxa + mensagem

#### Empresas
- Tabela: Nome | Plano | Profissionais | Agend./mês | MRR | Status | Ações
- Status: badge-green (ativo) | badge-red (inadimplente) | badge-gray (inativo)
- Ações: Editar | Entrar (impersonar) | Desativar/Suspender/Reativar

#### Usuários
- Tabela: Nome | Empresa | Papel | Último acesso | Status | Ações
- Papéis: Super Admin (red) | Gerente (yellow) | Operador (purple)

#### Planos e Cobranças
- 3 cards de plano com barra de ocupação
- Tabela de cobranças: Empresa | Plano | Valor | Vencimento | Status | Ações
- Status: Pago (green) | Atrasado (red) | Pendente (yellow)

#### Logs e Auditoria
- Layout terminal (font monospace)
- Colunas: Timestamp | Empresa (cor purple) | Mensagem | Badge HTTP (200/500/ws/auth)

#### Suporte / Tickets
- Grid 2 colunas: Abertos | Resolvidos hoje
- Tickets com prioridade: Urgente (red border) | Médio (yellow) | Baixo (gray)
- Opacidade reduzida nos resolvidos (.5)

---

## Modais (ambos os painéis)

Todos os modais seguem o mesmo padrão:

```
Overlay: fixed inset-0, bg rgba(0,0,0,.75), backdrop-filter blur(4px)
         opacity 0 → 1 ao abrir (.open class)
Modal:   bg #131720, border 1px rgba(255,255,255,.10), border-radius 16px
         width 480px, max-height 90vh, overflow-y auto
         transform: translateY(16px) scale(.98) → none ao abrir
Header:  padding 20px 24px, border-bottom, título + botão ✕
Body:    padding 24px, gap 16px (flex column)
Footer:  padding 16px 24px, border-top, botões alinhados à direita
```

### Modais no Painel do Cliente
| Modal | Trigger | Campos |
|---|---|---|
| Novo/Editar Serviço | "+ Novo serviço" / "Editar" card | Nome, Duração (min), Preço (R$), Descrição, Profissionais (checkboxes) |
| Novo/Editar Profissional | "+ Novo profissional" / "Editar" card | Nome, WhatsApp, Início/Fim expediente, Intervalo (min), Serviços (checkboxes) |
| Histórico do Cliente | Clicar na linha da tabela | Read-only: stats + tabela de últimas visitas + "Agendar agora" |
| Confirmar exclusão | "Remover" em qualquer item | Confirmação simples com nome do item |

### Modais no Painel Admin
| Modal | Trigger | Campos |
|---|---|---|
| Nova/Editar Empresa | "+ Nova empresa" / "Editar" | Nome, E-mail, WhatsApp, Plano, Subdomínio, Status, Observações |
| Novo/Editar Usuário | "+ Novo usuário" / "Editar" | Nome, E-mail, Senha temp., Empresa, Papel/Permissão |

**Comportamento dos modais:**
- Fechar: botão ✕, botão "Cancelar", ou clicar fora do modal (overlay)
- Ao editar: preencher campos com dados existentes + mostrar botão "Excluir/Revogar" (danger, vermelho, esquerda)
- `document.body.style.overflow = 'hidden'` ao abrir, restaurar ao fechar

---

## Interações e Animações

| Elemento | Animação |
|---|---|
| Hero (landing) | fadeUp staggered: opacity 0→1 + translateY(20px→0), .6s ease |
| Scroll reveal | IntersectionObserver: .reveal class, opacity 0→1 + translateY(24px→0), .6s |
| Botão primário hover | translateY(-1px/-2px) + box-shadow glow teal |
| Cards hover | translateY(-2px), border-color mais claro |
| Feature cards | border-top 2px gradiente teal→purple ao hover |
| Modal open | opacity 0→1 + scale(.98)→scale(1) + translateY(16px→0), .2s |
| Nav items | background fade .15s |
| WhatsApp dot | pulse: opacity 1→.4→1, 2s infinite |
| Barras de chart | hover opacity .25→.7 |

---

## Stack de Backend (referência)

O frontend deve se conectar a:
- **POST** `/message-router` — recebe mensagens do WhatsApp
- **GET** `/disponibilidade` — retorna slots disponíveis
- **POST/PUT/DELETE** `/agendamento` — CRUD de agendamentos
- **GET** `/profissional`, `/servico`, `/cliente` — listas
- **Auth:** header `x-api-key`
- **DB:** PostgreSQL (schemas: `core`, `agenda`, `integracoes`)

---

## Assets
- Sem imagens externas — tudo CSS/SVG inline
- Ícones: caracteres Unicode simples (◈ ◷ ≡ ✂ ↗ ◉ ◌ ⚙)
- Fonts: Google Fonts (Plus Jakarta Sans + Poppins)

---

## Arquivos deste pacote

| Arquivo | Descrição |
|---|---|
| `Landing Page.html` | Página pública de vendas — hero, como funciona, features, pricing |
| `Painel do Cliente.html` | App do barbeiro — dashboard, agenda, serviços, profissionais, clientes, relatórios + modais |
| `Painel Admin.html` | App do dono do SaaS — dashboard MRR, empresas, usuários, planos, logs, suporte + modais |
| `README.md` | Este documento |

**Como usar:** Abra cada `.html` diretamente no navegador. Todos os links e interações funcionam sem servidor.
