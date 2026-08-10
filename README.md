# 🚀 BOOSTING — Plataforma de Elo Boost para League of Legends

> Plataforma completa de serviços de elo boost para League of Legends, com painel multi-role (cliente, booster, admin), integração com a API da Riot Games, pagamentos via Mercado Pago (PIX) e comunicação em tempo real via Discord.

---

## 📋 Índice

- [Sobre o Projeto](#sobre-o-projeto)
- [Funcionalidades](#funcionalidades)
- [Stack Tecnológica](#stack-tecnológica)
- [Arquitetura](#arquitetura)
- [Serviços Oferecidos](#serviços-oferecidos)
- [Estrutura do Projeto](#estrutura-do-projeto)
- [Pré-requisitos](#pré-requisitos)
- [Instalação e Configuração](#instalação-e-configuração)
- [Variáveis de Ambiente](#variáveis-de-ambiente)
- [Scripts Disponíveis](#scripts-disponíveis)
- [Edge Functions (Supabase/Deno)](#edge-functions-supabasedeno)
- [Banco de Dados](#banco-de-dados)
- [Testes](#testes)
- [Deploy](#deploy)

---

## Sobre o Projeto

Este é um sistema SaaS completo de **elo boost** para League of Legends, voltado ao mercado brasileiro. A plataforma conecta clientes que desejam subir de elo com boosters verificados de alto ELO, oferecendo transparência, segurança de conta e rastreamento em tempo real das partidas via API da Riot.

O sistema possui **quatro portais distintos**:
- **Portal Público** — landing page, páginas de serviços, pricing, FAQ, perfis públicos de boosters e fluxo de candidatura.
- **Portal do Cliente** — criação de pedidos (Order Builder), acompanhamento de pedidos em tempo real, histórico e chat com o booster.
- **Portal do Booster** — visualização de jobs disponíveis, aceite de pedidos, dashboard de ganhos, gestão de contas duo e pagamentos.
- **Portal Admin** — visão geral da operação, gestão de pedidos, boosters, clientes, pagamentos, payouts, reembolsos, drops e contas duo.

---

## Funcionalidades

### 🎮 Área do Cliente
- **Order Builder multi-step** com seleção de serviço, configuração de rank, extras e pagamento
- Acompanhamento de pedido em **tempo real** com sincronização de partidas via Riot API
- **Chat integrado** com o booster dentro do pedido
- Histórico completo de pedidos
- Pagamento via **PIX** (Mercado Pago)

### ⚔️ Área do Booster
- Feed de **jobs disponíveis** com filtro por serviço, modo e divisão
- Aceite e gerenciamento de pedidos ativos
- **Dashboard de performance** com estatísticas estendidas (win rate, LP médio ganho, etc.)
- Gestão de **contas duo** (pool de contas para duo boost)
- Controle de **pagamentos e saques** com janela de saque configurável
- Sons de notificação para novos jobs disponíveis

### 🛡️ Área Admin
- Overview com métricas da operação
- Gestão completa de **pedidos, boosters e clientes**
- Controle de **pagamentos, payouts e reembolsos**
- Gerenciamento de **drops** (penalidades por abandono de pedido)
- Gestão do pool de **contas duo**
- Integração com **Discord** para notificações automáticas e canais de pedido

### 🔐 Segurança & Infraestrutura
- Autenticação exclusivamente via **Discord OAuth**
- Row Level Security (RLS) no PostgreSQL para cada role
- Verificação de assinatura HMAC nos webhooks do Mercado Pago
- **VPN** ativa durante cada partida de boost
- Rate limiting nas Edge Functions
- Confirmação de conclusão via evidência de partidas (Riot API Match Evidence Gate)
- Lógica de preço como **fonte única de verdade** compartilhada entre frontend e Edge Function

---

## Stack Tecnológica

### Frontend
| Tecnologia | Uso |
|---|---|
| **React 18** | Framework UI |
| **TypeScript 5** | Tipagem estática |
| **Vite 6** | Build tool e dev server |
| **React Router DOM v6** | Roteamento SPA |
| **TanStack Query v5** | Cache e sincronização de estado servidor |
| **Zustand v5** | Estado global (auth, order builder, sound) |
| **React Hook Form + Zod** | Formulários com validação de schema |
| **Framer Motion** | Animações |
| **Tailwind CSS v3** | Estilização utilitária |
| **Radix UI** | Componentes acessíveis (Dialog, Avatar, Slot) |
| **Recharts** | Gráficos e dashboards |
| **Lucide React** | Ícones |
| **date-fns** | Manipulação de datas |
| **i18next + react-i18next** | Internacionalização (pt-BR) |

### Backend / Infraestrutura
| Tecnologia | Uso |
|---|---|
| **Supabase** | BaaS — PostgreSQL, Auth, Realtime, Storage, Edge Functions |
| **PostgreSQL 15** | Banco de dados relacional com RLS |
| **Deno** | Runtime das Edge Functions |
| **Mercado Pago API** | Gateway de pagamento (PIX) |
| **Riot Games API** | Rank, ícone de perfil, partidas e cutoffs |
| **Discord API** | OAuth, canais de pedido, notificações automáticas |
| **Vercel** | Hospedagem do frontend |

---

## Arquitetura

```
┌─────────────────────────────────────────────┐
│            Frontend (Vite / React)          │
│  ┌─────────┐ ┌──────────┐ ┌─────────────┐  │
│  │ Public  │ │ Customer │ │   Booster   │  │
│  │ Portal  │ │  Portal  │ │   Portal    │  │
│  └─────────┘ └──────────┘ └─────────────┘  │
│                 ┌─────────┐                 │
│                 │  Admin  │                 │
│                 │  Portal │                 │
│                 └─────────┘                 │
└──────────────────┬──────────────────────────┘
                   │ supabase-js (REST + Realtime)
┌──────────────────▼──────────────────────────┐
│                  Supabase                    │
│  ┌──────────┐ ┌──────────┐ ┌─────────────┐  │
│  │PostgREST │ │   Auth   │ │  Realtime   │  │
│  │  (RLS)   │ │(Discord) │ │ (WebSocket) │  │
│  └──────────┘ └──────────┘ └─────────────┘  │
│  ┌──────────────────────────────────────┐    │
│  │      Edge Functions (Deno)           │    │
│  │  mercadopago-webhook                 │    │
│  │  create-pix-payment                  │    │
│  │  riot-account-rank                   │    │
│  │  sync-order-matches                  │    │
│  │  discord-order-channel               │    │
│  │  ... (+11 funções)                   │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
        │              │              │
┌───────▼──┐  ┌────────▼──┐  ┌───────▼──┐
│ Mercado  │  │   Riot    │  │ Discord  │
│   Pago   │  │ Games API │  │   API    │
└──────────┘  └───────────┘  └──────────┘
```

### Padrões de Arquitetura
- **Feature-based structure**: cada role (public, auth, customer, booster, admin) é um módulo isolado em `src/features/`
- **Shared pricing module**: `shared/pricing.ts` roda tanto no Vite/React quanto no Deno sem nenhuma dependência de ambiente
- **Code splitting**: todas as páginas são `lazy()` com `React.Suspense`, divididas em chunks por vendor
- **RLS + Row-level security**: cada tabela tem policies garantindo isolamento total de dados por role

---

## Serviços Oferecidos

| Serviço | Descrição |
|---|---|
| **Solo Boost** | Booster joga na conta do cliente até o rank desejado |
| **Duo Boost** | Booster joga em duo queue ao lado do cliente |
| **Win Boost** | Compra de vitórias avulsas (1 a 5) |
| **MD5** | Garantia de 5 vitórias no posicionamento da temporada |
| **Coaching** | Sessões 1-a-1 ao vivo com coaches de alto ELO |
| **Clash** | Solo Clash ou Duo Clash nos fins de semana |

**Ranks suportados**: Ferro → Desafiante (Iron IV ao Challenger)

**Filas**: Solo/Duo Queue e Flex Queue

---

## Estrutura do Projeto

```
BOOSTING/
├── src/
│   ├── api/                    # Queries do TanStack Query
│   ├── app/
│   │   ├── providers.tsx       # QueryClient, Auth, i18n, Router
│   │   ├── router.tsx          # Rotas da SPA com lazy loading
│   │   └── routeGuards.tsx     # RequireAuth e SuspensePage
│   ├── components/
│   │   └── ui/                 # Design system (Button, Card, RankBadge…)
│   ├── features/
│   │   ├── public/             # Landing, serviços, pricing, boosters, FAQ
│   │   ├── auth/               # Login via Discord OAuth
│   │   ├── customer/           # Dashboard, Order Builder, Order Detail
│   │   ├── booster/            # Dashboard, Jobs, Accounts, Payments
│   │   └── admin/              # Overview, Orders, Boosters, Drops, DuoAccounts
│   ├── hooks/                  # Custom hooks reutilizáveis
│   ├── lib/
│   │   ├── database.types.ts   # Tipos gerados do schema Supabase
│   │   ├── supabase.ts         # Instância do cliente Supabase
│   │   ├── utils.ts            # Utilitários (formatRank, cn, etc.)
│   │   ├── orderCompletionGate.ts
│   │   └── ...
│   ├── locales/
│   │   └── pt-BR.json          # Traduções em Português (Brasil)
│   ├── stores/
│   │   ├── authStore.ts        # Estado de sessão
│   │   ├── orderBuilderStore.ts
│   │   └── boosterSoundStore.ts
│   └── styles/                 # CSS global e tokens de design
│
├── shared/
│   ├── pricing.ts              # Motor de preço (frontend + Deno)
│   ├── boostDomain.ts          # Regras de domínio do boost
│   ├── clashDomain.ts          # Regras de domínio do Clash
│   └── *.test.ts               # Testes unitários de domínio
│
├── supabase/
│   ├── functions/              # Edge Functions (Deno)
│   │   ├── _shared/            # Utilitários compartilhados
│   │   ├── mercadopago-webhook/
│   │   ├── create-pix-payment/
│   │   ├── riot-account-rank/
│   │   ├── sync-order-matches/
│   │   └── ...
│   ├── migrations/             # Migrações SQL incrementais (168+)
│   └── schema/                 # Schema atual exportado
│
├── package.json
├── vite.config.ts
├── tailwind.config.ts
├── vitest.config.ts
└── vercel.json
```

---

## Pré-requisitos

- **Node.js** >= 20
- **npm** >= 10
- **Deno** >= 2.x (testes e Edge Functions locais)
- **Supabase CLI** (`npm install -g supabase`)
- Conta no **Supabase** (projeto criado)
- App no **Discord** (OAuth configurado)
- Conta no **Mercado Pago** (credenciais de aplicação)
- Chave de acesso na **Riot Games API**

---

## Instalação e Configuração

### 1. Clonar o repositório

```bash
git clone <url-do-repositorio>
cd BOOSTING
```

### 2. Instalar dependências

```bash
npm install
```

### 3. Configurar variáveis de ambiente

```bash
cp .env.example .env
# Edite .env com suas credenciais
```

### 4. Iniciar o Supabase local (opcional)

```bash
npm run supabase:start
```

Serviços disponíveis localmente:
- **API REST**: `http://localhost:54321`
- **Studio**: `http://localhost:54323`
- **PostgreSQL**: `localhost:54322`

### 5. Aplicar as migrações

```bash
supabase db reset
# ou, para projeto já linkado:
supabase db push
```

### 6. Iniciar o servidor de desenvolvimento

```bash
npm run dev
# http://localhost:5173
```

### 7. Servir Edge Functions localmente (opcional)

```bash
npm run functions:serve
```

---

## Variáveis de Ambiente

### Frontend (`.env`)

```env
# Supabase
VITE_SUPABASE_URL=https://<seu-projeto>.supabase.co
VITE_SUPABASE_ANON_KEY=<sua-anon-key>

# Discord (link do servidor de suporte)
VITE_DISCORD_TICKET_URL=https://discord.gg/<seu-invite>
```

### Edge Functions (`supabase/functions/.env.local`)

```env
# Mercado Pago
MERCADOPAGO_ACCESS_TOKEN=<seu-access-token>
MERCADOPAGO_WEBHOOK_SECRET=<seu-webhook-secret>

# Riot Games
RIOT_API_KEY=<sua-api-key>

# Discord Bot
DISCORD_BOT_TOKEN=<seu-bot-token>
DISCORD_GUILD_ID=<id-do-servidor>
DISCORD_ORDERS_CATEGORY_ID=<id-da-categoria>

# Supabase (service role)
SUPABASE_URL=https://<seu-projeto>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<sua-service-role-key>

# Webhook secret interno
WEBHOOK_SECRET=<seu-secret-interno>
```

> ⚠️ **Nunca commite chaves reais.** Adicione `supabase/functions/.env.local` ao `.gitignore`.

---

## Scripts Disponíveis

| Script | Descrição |
|---|---|
| `npm run dev` | Inicia o servidor de desenvolvimento Vite |
| `npm run build` | Gera o bundle de produção (`dist/`) |
| `npm run preview` | Pré-visualiza o build de produção |
| `npm run lint` | Executa o ESLint |
| `npm run typecheck` | Verificação de tipos do frontend (tsc) |
| `npm run typecheck:edge` | Verificação de tipos das Edge Functions (deno check) |
| `npm test` | Testes unitários do frontend (Vitest) |
| `npm run test:edge` | Testes das Edge Functions (deno test) |
| `npm run check` | Pipeline completo: lint + typecheck + tests + build + deadcode |
| `npm run deadcode` | Detecta código morto com Knip |
| `npm run supabase:start` | Inicia o Supabase local |
| `npm run supabase:migrations:list` | Lista migrações do projeto linkado |
| `npm run supabase:schema:dump` | Exporta o schema público atual |
| `npm run functions:serve` | Serve Edge Functions localmente |
| `npm run functions:debug` | Serve Edge Functions em modo debug |

---

## Edge Functions (Supabase/Deno)

Todas as Edge Functions rodam em **Deno** e ficam em `supabase/functions/`.

| Função | Descrição |
|---|---|
| `create-pix-payment` | Cria um pagamento PIX no Mercado Pago e retorna o QR code |
| `mercadopago-webhook` | Recebe notificações de pagamento, verifica HMAC e confirma pedidos |
| `riot-account-rank` | Consulta o rank atual de uma conta via Riot API |
| `riot-league-cutoffs` | Busca cutoffs de LP do Grandmaster e Challenger |
| `riot-profile-icons` | Retorna ícones de perfil da Riot (endpoint público) |
| `sync-order-matches` | Sincroniza partidas de um pedido via Riot Match API |
| `verify-order-rank` | Verifica se o rank do cliente atingiu o rank alvo |
| `cancel-pending-order` | Cancela pedidos pendentes expirados sem pagamento |
| `expel-booster` | Remove um booster de um pedido ativo (admin) e registra o drop |
| `resolve-order-credentials` | Descriptografa e entrega credenciais da conta ao booster |
| `resolve-duo-account-credentials` | Entrega credenciais de conta duo ao booster autorizado |
| `discord-order-channel` | Cria/arquiva canais de Discord por pedido |
| `discord-init-channels` | Bootstrap dos canais do servidor Discord |
| `discord-join-server` | Adiciona usuário ao servidor Discord via OAuth |
| `discord-top3-announcement` | Publica o anúncio semanal do Top 3 de boosters |

### Funções sem verificação JWT

Configuradas como exceção em `supabase/config.toml`:

| Função | Motivo |
|---|---|
| `mercadopago-webhook` | Verifica HMAC próprio do Mercado Pago |
| `discord-order-channel` | Chamada por Database Webhook sem JWT |
| `discord-init-channels` | Chamada pelo fluxo de bootstrap |
| `riot-profile-icons` | Endpoint público sem autenticação |

---

## Banco de Dados

O schema é gerenciado por **migrações SQL incrementais** em `supabase/migrations/` (atualmente na migração `168`).

### Principais entidades

| Tabela / Função | Descrição |
|---|---|
| `profiles` | Perfil do usuário (role, display_name, avatar_url) |
| `booster_profiles` | Configurações do booster (serviços, rank, disponibilidade) |
| `orders` | Pedidos de boost (serviço, rank de/para, status, preço) |
| `order_matches` | Partidas sincronizadas via Riot API |
| `payments` | Registros de pagamento PIX |
| `payouts` | Pagamentos e saques para boosters |
| `duo_accounts` | Pool de contas para duo boost |
| `duo_account_reservations` | Histórico de reservas de contas duo |
| `booster_reviews` | Avaliações de clientes sobre boosters |
| `drops` | Penalidades por abandono de pedido |
| `order_events` | Log de eventos para auditoria |
| `chat_messages` | Mensagens do chat cliente-booster |
| `get_top_boosters()` | Ranking de boosters por performance |
| `get_available_boost_orders()` | Pedidos disponíveis para boosters (com filtros) |

### Row Level Security (RLS)
Todas as tabelas possuem RLS ativo:
- Clientes veem apenas seus próprios pedidos e pagamentos
- Boosters veem apenas pedidos atribuídos a eles
- Admins têm acesso completo via service role
- Dados sensíveis (credenciais de conta) têm acesso restrito por função

---

## Testes

O projeto usa **Vitest** para o frontend e **Deno Test** para as Edge Functions.

### Testes unitários (Vitest)

```bash
npm test
```

Cobertura principal:
- `shared/pricing.test.ts` — motor de preço completo (todos os serviços e extras)
- `shared/boostDomain.test.ts` — regras de domínio do boost
- `shared/security.test.ts` e `securityHardening.test.ts` — testes de segurança
- `src/stores/orderBuilderStore.test.ts` — store do Order Builder
- `src/lib/orderCompletionGate.test.ts` — gate de conclusão de pedidos
- `src/features/customer/order-builder/StepConfigure.test.tsx` — componente de configuração

### Testes das Edge Functions (Deno)

```bash
npm run test:edge
```

### Pipeline completo de qualidade

```bash
npm run check
# lint → typecheck → typecheck:edge → test → test:edge → build → deadcode
```

---

## Deploy

### Frontend — Vercel

1. Conecte o repositório no painel da Vercel
2. Configure as variáveis de ambiente `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`
3. O build é executado automaticamente a cada push na branch principal

O arquivo `vercel.json` já configura as reescritas de SPA necessárias para o React Router.

### Backend — Supabase

```bash
# Link do projeto
supabase link --project-ref <ref>

# Aplicar migrações
supabase db push

# Deploy das Edge Functions
supabase functions deploy
```

---

## Contribuindo

1. Crie uma branch a partir de `main`: `git checkout -b feat/minha-feature`
2. Antes de abrir o PR, rode o pipeline completo: `npm run check`
3. Siga as convenções de commits do projeto

---

## Licença

Este projeto é proprietário e de uso interno. Todos os direitos reservados.
