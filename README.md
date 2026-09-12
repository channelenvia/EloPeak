# 🚀 EloPeak — Plataforma de Elo Boost para League of Legends

> Plataforma completa e profissional de serviços de elo boost para League of Legends, com painel multi-role (cliente, booster, admin), aplicativo desktop com login automático e modo invisível (Booster Launcher), integração com a API da Riot Games, pagamentos via Mercado Pago (PIX) e automação em tempo real via Discord.

---

## 📋 Índice

- [Sobre o Projeto](#sobre-o-projeto)
- [Funcionalidades](#funcionalidades)
- [Booster Launcher (App Desktop)](#booster-launcher-app-desktop)
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
- [Licença](#licença)

---

## Sobre o Projeto

O **EloPeak** é um sistema SaaS completo de **elo boost** para League of Legends, focado no mercado brasileiro. A plataforma conecta clientes a boosters verificados de alto ELO, garantindo segurança de conta com arquitetura de zero-exposição de credenciais, rastreamento de partidas em tempo real via Riot Games API e pagamentos automatizados via PIX.

O ecossistema possui **quatro portais web** e um **aplicativo desktop dedicado**:
- **Portal Público** — landing page, páginas informativas de serviços, calculadora de preços, FAQ, perfis de boosters e candidatura.
- **Portal do Cliente** — contratação (Order Builder), acompanhamento em tempo real das partidas, chat ao vivo e histórico.
- **Portal do Booster** — feed de jobs disponíveis, aceite de pedidos, dashboard de performance, gestão de contas duo e solicitações de repasse/saque.
- **Portal Admin** — gestão operacional completa (pedidos, boosters, clientes, pagamentos, saques, reembolsos, penalidades/drops e contas duo).
- **Booster Launcher (Desktop)** — aplicativo Windows em Electron para o booster entrar na conta do cliente com um clique, sem nunca ter acesso à senha em texto puro, e com status offline integrado (Deceive).

---

## Funcionalidades

### 🎮 Área do Cliente
- **Order Builder multi-step** com seleção de serviço, configuração de elo/divisão/vitórias, opcionais e pagamento
- Acompanhamento de pedido em **tempo real** com sincronização automática de partidas via Riot API
- **Chat integrado** em tempo real com o booster responsável
- Histórico completo de pedidos com status e detalhes
- Pagamento instantâneo via **PIX** (Mercado Pago) com liberação automática após confirmação via webhook

### ⚔️ Área do Booster
- Feed de **jobs disponíveis** com filtros avançados (serviço, fila, divisão, valor)
- Aceite e gerenciamento de pedidos ativos com janela de exclusividade configurável
- **Dashboard de performance** com estatísticas (win rate, média de LP ganho, histórico de partidas)
- Gestão do pool de **contas duo** (para realização de Duo Boost com segurança)
- Painel financeiro com histórico de repasses e solicitação de saque
- Notificações sonoras e visuais para novos pedidos disponíveis
- Geração de token de acesso opaco para uso no **Booster Launcher**

### 🛡️ Área Admin
- Visão geral da operação com métricas e faturamento
- Gestão centralizada de **pedidos, boosters e clientes**
- Controle de **pagamentos, repasses (payouts) e reembolsos**
- Gerenciamento de **drops** (penalidades por abandono/cancelamento de pedido)
- Gestão do catálogo e credenciais do pool de **contas duo**
- Integração profunda com **Discord** (criação automática de canais privados para cada pedido, bot de avisos)

### 🔐 Segurança & Integridade
- Autenticação exclusiva via **Discord OAuth (PKCE)** — sem armazenamento de senhas locais da plataforma
- **Zero-Exposure de Credenciais**: o booster nunca visualiza usuário e senha da conta do cliente em texto puro; a autenticação é resolvida via token opaco diretamente pelo Launcher
- Row Level Security (RLS) rigoroso no PostgreSQL garantindo isolamento total por usuário/role
- Verificação criptográfica HMAC nos webhooks do Mercado Pago
- Rate limiting nas Edge Functions
- **Match Evidence Gate**: confirmação automática de conclusão de pedidos via verificação de histórico na Riot Match API
- Motor de preço compartilhado (`shared/pricing.ts`) como fonte única de verdade entre frontend e backend

---

## Booster Launcher (App Desktop)

O **Booster Launcher** (`launcher/`) é o aplicativo desktop oficial para boosters realizarem o serviço com máxima segurança e discrição:

- **Login no App via Discord OAuth**: autenticação idêntica à web com captura de callback local via PKCE (`http://127.0.0.1:<porta>/callback`).
- **Sessão Segura**: token persistido localmente via `safeStorage` do Electron (criptografia nativa DPAPI do Windows).
- **Injeção Automática no Riot Client**: o booster insere o token do pedido no app; o processo principal do Electron comunica-se com as Edge Functions (`resolve-order-credentials` / `resolve-duo-account-credentials`), resolve as credenciais em memória e as injeta diretamente na API REST local do Riot Client (`RiotClientServices.exe`).
- **Modo Invisível (Deceive integrado)**: integra o [Deceive](https://github.com/molenzwiebel/Deceive) para mascarar o status no chat do jogo como "offline", garantindo que amigos da conta do cliente não vejam o booster jogando durante o serviço.

---

## Stack Tecnológica

### Frontend (Web)
| Tecnologia | Uso |
|---|---|
| **React 18** | Framework UI reativo |
| **TypeScript 5** | Tipagem estática rigorosa |
| **Vite 6** | Build tool e dev server de alta velocidade |
| **React Router v7** | Roteamento SPA com code splitting |
| **TanStack Query v5** | Gerenciamento de cache e sincronização com backend |
| **Zustand v5** | Gerenciamento de estado global leve |
| **React Hook Form + Zod** | Formulários performáticos com validação de schemas |
| **Tailwind CSS v3** | Design system e estilização utilitária |
| **Radix UI** | Primitivas acessíveis e sem estilos impostos |
| **Framer Motion** | Micro-animações e transições suaves |
| **Lucide React** | Pacote de ícones |
| **i18next + react-i18next** | Internacionalização (pt-BR) |

### Desktop (Booster Launcher)
| Tecnologia | Uso |
|---|---|
| **Electron 33** | Plataforma cross-desktop para Windows |
| **TypeScript 5** | Tipagem estática em processos main e renderer |
| **electron-builder 25** | Empacotamento e criação de instaladores NSIS / Portable |
| **Deceive (v1.18.0)** | Utilitário para status offline no Riot Client |
| **DPAPI (safeStorage)** | Criptografia segura de credenciais locais |

### Backend / Infraestrutura
| Tecnologia | Uso |
|---|---|
| **Supabase** | BaaS — PostgreSQL, Auth, Realtime, Storage, Edge Functions |
| **PostgreSQL 15** | Banco de dados relacional com Row Level Security (RLS) |
| **Deno 2.x** | Runtime moderno para Edge Functions serverless |
| **Mercado Pago API** | Gateway de pagamento PIX e verificação de webhooks |
| **Riot Games API** | Consulta de elo atual, cutoffs, ícones e histórico de partidas |
| **Discord API** | Autenticação OAuth2 e automação de canais de suporte |
| **Vercel** | Hospedagem contínua do frontend web |

---

## Arquitetura

```
┌─────────────────────────────────────────────┐      ┌─────────────────────────────┐
│            Frontend (Vite / React)          │      │  Booster Launcher (Electron)│
│  ┌─────────┐ ┌──────────┐ ┌─────────────┐  │      │  ┌─────────┐ ┌───────────┐  │
│  │ Public  │ │ Customer │ │   Booster   │  │      │  │ Renderer│ │ Main Proc │  │
│  │ Portal  │ │  Portal  │ │   Portal    │  │      │  │  (UI)   │ │  (Deceive/│  │
│  │         │ │          │ │             │  │      │  │         │ │RiotClient)│  │
│  └─────────┘ └──────────┘ └─────────────┘  │      │  └─────────┘ └───────────┘  │
│                 ┌─────────┐                 │      └──────────────┬──────────────┘
│                 │  Admin  │                 │                     │
│                 │  Portal │                 │                     │
│                 └─────────┘                 │                     │
└──────────────────┬──────────────────────────┘                     │
                   │ supabase-js (REST + Realtime)                  │ Edge Functions
┌──────────────────▼────────────────────────────────────────────────▼──────────────┐
│                                     Supabase                                     │
│  ┌──────────┐                 ┌──────────┐                 ┌─────────────┐       │
│  │PostgREST │                 │   Auth   │                 │  Realtime   │       │
│  │  (RLS)   │                 │ (Discord)│                 │ (WebSocket) │       │
│  └──────────┘                 └──────────┘                 └─────────────┘       │
│  ┌───────────────────────────────────────────────────────────────────────┐       │
│  │                      Edge Functions (Deno)                            │       │
│  │  create-pix-payment          mercadopago-webhook                      │       │
│  │  riot-account-rank           sync-order-matches                       │       │
│  │  resolve-order-credentials   resolve-duo-account-credentials          │       │
│  │  discord-order-channel       cancel-pending-order   ...               │       │
│  └───────────────────────────────────────────────────────────────────────┘       │
└──────────────────────────────────────┬───────────────────────────────────────────┘
         │                             │                             │
┌────────▼─────────┐          ┌────────▼─────────┐          ┌────────▼─────────┐
│   Mercado Pago   │          │  Riot Games API  │          │   Discord API    │
└──────────────────┘          └──────────────────┘          └──────────────────┘
```

---

## Serviços Oferecidos

| Serviço | Descrição |
|---|---|
| **Solo Boost** | Booster joga na conta do cliente até a liga/divisão desejada |
| **Duo Boost** | Booster joga em duo com o cliente utilizando contas do pool oficial |
| **Win Boost** | Compra de pacote de vitórias avulsas |
| **MD5** | 5 partidas de posicionamento na temporada com garantia |
| **Coaching** | Sessões de mentoria 1-a-1 com boosters e jogadores de alto nível |
| **Clash** | Participação em torneios de fim de semana (Solo ou Duo) |

---

## Estrutura do Projeto

```
EloPeak/
├── src/                          # Código-fonte da aplicação Web (Vite + React)
│   ├── api/                      # Camada de queries e mutations (TanStack Query)
│   ├── app/                      # Setup central (providers, router, guards)
│   ├── components/ui/            # Design system e componentes reutilizáveis
│   ├── features/
│   │   ├── public/               # Landing page, calculadora, boosters públicos
│   │   ├── auth/                 # Fluxo de login via Discord
│   │   ├── customer/             # Portal do cliente (Order Builder, Detalhes)
│   │   ├── booster/              # Portal do booster (Jobs, Painel, Pagamentos)
│   │   └── admin/                # Portal admin (Gestão geral, Drops, Contas Duo)
│   ├── hooks/                    # Custom React hooks
│   ├── lib/                      # Supabase client, tipos de BD e utilitários
│   ├── locales/                  # Dicionários de internacionalização (pt-BR)
│   └── stores/                   # Stores Zustand (Auth, Order Builder, Sons)
│
├── launcher/                     # Aplicativo Desktop (Electron)
│   ├── src/main/                 # Processo principal (Riot Client API, OAuth, Deceive)
│   ├── src/preload/              # IPC bridge seguro entre main e renderer
│   ├── src/renderer/             # Interface desktop do booster
│   ├── vendor/deceive/           # Executável do Deceive (status offline no League)
│   └── scripts/                  # Scripts de empacotamento e conversão de ícones
│
├── shared/                       # Módulos compartilhados entre Web, Launcher e Deno
│   ├── pricing.ts                # Motor de cálculo de preços (fonte única da verdade)
│   ├── boostDomain.ts            # Regras e cutoffs do ecossistema League of Legends
│   └── *.test.ts                 # Testes unitários do domínio compartilhado
│
├── supabase/
│   ├── functions/                # Edge Functions serverless (Deno)
│   │   ├── _shared/              # Helpers compartilhados das Edge Functions
│   │   ├── create-pix-payment/   # Geração de cobrança PIX
│   │   ├── mercadopago-webhook/  # Confirmação de pagamentos com validação HMAC
│   │   ├── sync-order-matches/   # Sincronização e evidência de partidas na Riot
│   │   ├── resolve-order-credentials/ # Entrega segura de login para o Launcher
│   │   └── ...
│   ├── migrations/               # Migrações incrementais do banco PostgreSQL
│   └── schema/                   # Dump do schema consolidado
│
├── scripts/                      # Scripts de manutenção e automação
└── package.json                  # Dependências e scripts do projeto principal
```

---

## Pré-requisitos

- **Node.js** >= 20
- **npm** >= 10
- **Deno** >= 2.x (para rodar e testar as Edge Functions locais)
- **Supabase CLI** (`npm install -g supabase`)
- Contas configuradas nos provedores:
  - Projeto no **Supabase**
  - Aplicação no portal de desenvolvedores do **Discord**
  - Credenciais de aplicação no **Mercado Pago**
  - API Key válida da **Riot Games**

---

## Instalação e Configuração

### 1. Clonar o repositório

```bash
git clone <url-do-repositorio>
cd EloPeak
```

### 2. Configurar a Aplicação Web

```bash
# Instalar dependências da web
npm install

# Copiar arquivo de ambiente
cp .env.example .env
# Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env

# Iniciar servidor de desenvolvimento
npm run dev
# Acesse em: http://localhost:5173
```

### 3. Configurar o Booster Launcher (Desktop)

```bash
cd launcher

# Instalar dependências do Electron
npm install

# Criar configuração local
cp config.example.json config.json
# Preencha a URL e chave do Supabase em config.json

# Rodar em modo de desenvolvimento
npm run dev
```

### 4. Supabase Local e Migrações (Opcional)

```bash
# Iniciar stack local do Supabase
npm run supabase:start

# Aplicar migrações
supabase db reset
# ou, se linkado ao projeto remoto:
supabase db push

# Servir Edge Functions localmente
npm run functions:serve
```

---

## Variáveis de Ambiente

### Frontend Web (`.env`)

```env
# Supabase
VITE_SUPABASE_URL=https://<seu-projeto>.supabase.co
VITE_SUPABASE_ANON_KEY=<sua-anon-key>

# Discord
VITE_DISCORD_TICKET_URL=https://discord.gg/<seu-servidor>
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

# Supabase (Service Role)
SUPABASE_URL=https://<seu-projeto>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<sua-service-role-key>

# Webhook Secret interno
WEBHOOK_SECRET=<seu-secret-interno>
```

> ⚠️ **Aviso de Segurança**: Nunca faça commit de arquivos `.env` ou `.env.local`. Eles já estão mapeados no `.gitignore`.

---

## Scripts Disponíveis

### Aplicação Web & Monorepo

| Script | Descrição |
|---|---|
| `npm run dev` | Inicia o servidor de desenvolvimento Vite |
| `npm run build` | Compila o TypeScript e gera o bundle de produção (`dist/`) |
| `npm run preview` | Executa o build de produção localmente |
| `npm run lint` | Valida o código com ESLint |
| `npm run typecheck` | Executa verificação de tipos completa (`tsc`) |
| `npm run typecheck:edge`| Valida tipos das Edge Functions (`deno check`) |
| `npm test` | Executa a suíte de testes unitários do frontend (Vitest) |
| `npm run test:edge` | Executa os testes das Edge Functions (Deno Test) |
| `npm run check` | Pipeline completo de qualidade (lint, typecheck, tests, build) |
| `npm run deadcode` | Identifica código não utilizado com Knip |
| `npm run supabase:start`| Inicia o ambiente local do Supabase |
| `npm run functions:serve`| Executa as Edge Functions localmente |

### Booster Launcher (`cd launcher`)

| Script | Descrição |
|---|---|
| `npm run dev` | Compila o launcher e inicia o Electron em modo dev |
| `npm run build` | Compila os processos main e renderer em `launcher/dist/` |
| `npm run icon` | Gera os ícones `.ico` a partir do logo oficial |
| `npm run package` | Gera o instalador Windows (`NSIS`) e versão portátil em `launcher/release/` |

---

## Edge Functions (Supabase/Deno)

Todas as funções residem em `supabase/functions/` e executam sob o runtime Deno:

| Função | Descrição |
|---|---|
| `create-pix-payment` | Gera a cobrança PIX via Mercado Pago e retorna o QR Code e código Copia e Cola |
| `mercadopago-webhook` | Processa confirmação de pagamento com validação de assinatura HMAC |
| `riot-account-rank` | Consulta elo, divisão e vitórias de uma conta via Riot API |
| `riot-league-cutoffs` | Busca cutoffs atualizados de LP para Mestre, Grão-Mestre e Desafiante |
| `riot-profile-icons` | Fornece catálogo de ícones de perfil |
| `sync-order-matches` | Sincroniza partidas concluídas e valida avanço do boost |
| `verify-order-rank` | Confirma se o rank contratado foi atingido |
| `cancel-pending-order` | Cancela pedidos não pagos após a expiração |
| `expel-booster` | Remove booster de pedido com registro de penalidade (drop) |
| `resolve-order-credentials` | Descriptografa credenciais do cliente para o Launcher via token opaco |
| `resolve-duo-account-credentials`| Descriptografa credenciais de conta duo para o Launcher |
| `discord-order-channel` | Cria e arquiva canais de atendimento no Discord vinculados aos pedidos |
| `discord-init-channels` | Inicializa a estrutura de canais no servidor Discord |
| `discord-join-server` | Adiciona automaticamente o usuário ao Discord após login |
| `discord-top3-announcement` | Publica o ranking semanal dos melhores boosters |

---

## Banco de Dados

O banco de dados PostgreSQL é gerenciado através de migrações estruturadas em `supabase/migrations/`.

- **Isolamento de Papéis**: Políticas RLS (Row Level Security) garantem que clientes só tenham acesso aos seus próprios dados, e boosters apenas aos pedidos aceitos.
- **Auditoria**: A tabela `order_events` registra cada transição de estado, aceite de pedido, atribuição e atualização para total rastreabilidade.
- **Performance**: Índices dedicados para consultas frequentes de pedidos disponíveis, sincronização de partidas e métricas de desempenho.

---

## Testes

Testes unitários e de integração garantem que a lógica de negócios e segurança permaneçam consistentes:

```bash
# Rodar testes do frontend (Vitest)
npm test

# Rodar testes das Edge Functions (Deno)
npm run test:edge

# Rodar auditoria completa de qualidade
npm run check
```

---

## Deploy

- **Frontend (Web)**: Configurado para deploy contínuo na **Vercel** através do `vercel.json` (com redirecionamentos SPA).
- **Backend (Supabase)**: Migrações e Edge Functions aplicadas diretamente via Supabase CLI (`supabase db push` e `supabase functions deploy`).
- **Booster Launcher**: Compilado localmente ou via pipeline de CI gerando instaladores em `launcher/release/`.

---

## Licença

Este projeto é um software proprietário e confidencial. Todos os direitos reservados.
