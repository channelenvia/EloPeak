# EloPeak

Plataforma de elo boost para League of Legends (mercado brasileiro): clientes contratam serviços, boosters de alto elo executam, e o admin opera tudo — com pagamento por PIX/cartão (Mercado Pago), consulta de rank e partidas na Riot API, automação no Discord e um app desktop (Booster Launcher) que loga na conta do cliente **sem o booster nunca ver a senha**.

> Software proprietário. Todos os direitos reservados.

## Documentação

Regras de negócio, decisões de arquitetura, inventário de variáveis/secrets e rotina de deploy ficam no **grafo de conhecimento** (`graphify-out/`, gerado localmente): `graphify query "<pergunta>"` ou `/graphify query "<pergunta>"` no Claude Code. Para o launcher: [`launcher/README.md`](launcher/README.md).

## Visão geral

| Portal | Para quem | O que faz |
|---|---|---|
| Público | visitantes | landing, serviços, calculadora de preço, FAQ, perfis de boosters, candidatura |
| Cliente | quem compra | Order Builder, pagamento, acompanhamento em tempo real, chat, contestação, avaliação |
| Booster | quem executa | jobs disponíveis (aceite com desafio), pedidos ativos, contas duo, ganhos e saques |
| Admin | operação | pedidos, boosters, clientes, pagamentos, reembolsos, drops, saques, reviews |
| Launcher (Windows) | booster | resolve o token do pedido e preenche o Riot Client; status offline via Deceive |

**Serviços:** Elo Boost (solo/duo, inclui Master+), Vitórias (Win Boost), MD5 (partidas de posicionamento), Coaching, Clash (solo/duo).

## Stack

* **Web:** React 19, TypeScript 6, Vite 8, React Router 7, TanStack Query 5, Zustand 5, React Hook Form + Zod 4, Tailwind CSS 4, Radix UI, Framer Motion, Recharts. Testes com Vitest + Testing Library.
* **Backend (Supabase):** PostgreSQL **17** com RLS, Auth (somente Discord), Realtime, Storage, `pg_cron`/`pg_net`/Vault e Edge Functions em Deno 2.
* **Integrações:** Mercado Pago (PIX e cartão com 3DS, webhook com HMAC), Riot Games API, Discord (OAuth + bot).
* **Desktop:** Electron 44 + TypeScript, `safeStorage` (DPAPI), Deceive vendorizado com verificação de hash.
* **Hospedagem:** Vercel (front, headers/CSP em `vercel.json`) e Supabase (banco + funções).

## Arquitetura

```
 Navegador (React, Vercel) ─┐                         ┌─ Mercado Pago  (PIX/cartão + webhook)
 Booster Launcher (Electron)┼─ JWT ─▶ Supabase ──────▶├─ Riot API      (rank, partidas)
                            │   PostgREST (RLS) · Auth│
                            │   Realtime · Storage    └─ Discord       (canais, avisos, OAuth)
                            └─▶ Edge Functions (Deno) ◀── pg_cron / triggers (Vault)
```

Princípios: **o servidor decide** (preço, aceite, drops, reembolsos, janela de saque — o front só exibe); **RLS + RPCs `SECURITY DEFINER`** em vez de escrita direta; **zero exposição de credenciais** (cifradas com chave do Vault, token opaco de 5 min e uso único); **fonte única de preço** em `shared/pricing.ts`.

## Estrutura

```
src/                  App web (api/ queries e mutations · app/ router e guards · components/ · features/{public,auth,customer,booster,admin} · hooks/ · lib/ · stores/)
shared/               Domínio compartilhado web + Deno + testes (pricing.ts, boostDomain.ts, clashDomain.ts)
supabase/
  config.toml         Config do ambiente LOCAL (não aplicar em produção)
  migrations/         Baseline do schema + migrations pendentes de produção
  functions/          27 Edge Functions (+ _shared/)
  tests/database/     Testes pgTAP
launcher/             App Electron (main · preload · renderer · vendor/deceive)
public/               Ícones de rank/lane, imagens, robots e sitemap
.github/workflows/    CI (web, database/pgTAP, launcher)
```

Edge Functions por área: **pagamento** (`create-pix-payment`, `create-card-payment`, `mercadopago-webhook`, `cancel-pending-order`) · **Riot** (`riot-account-rank`, `riot-league-cutoffs`, `riot-profile-icons`, `verify-order-rank`, `sync-order-matches`, `cron-sync-order-matches`) · **credenciais/aceite** (`resolve-order-credentials`, `resolve-duo-account-credentials`, `accept-challenge`, `accept-challenge-image`) · **admin** (`expel-booster`) · **Discord** (`discord-order-channel`, `discord-init-channels`, `discord-join-server`, `discord-chat-mention`, `discord-review-announcement`, `discord-top3-announcement`, `discord-admin-*-alert`, `discord-*-reminder`, `announce-*`).

## Começando

Pré-requisitos: Node ≥ 22.12, Deno ≥ 2, Docker, [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
npm install
# crie .env.local na raiz com VITE_SUPABASE_URL=http://127.0.0.1:54321 e VITE_SUPABASE_ANON_KEY=<anon de `supabase status`>
supabase start && supabase db reset
npm run dev                     # http://localhost:5173
```

Edge Functions locais: copie `supabase/functions/.env.example` para `supabase/functions/.env`, preencha e rode `npm run functions:serve`. Launcher: ver [`launcher/README.md`](launcher/README.md).

## Scripts

| Comando | Para quê |
|---|---|
| `npm run dev` / `build` / `preview` | desenvolvimento, bundle de produção, preview |
| `npm run lint` · `typecheck` · `typecheck:edge` | ESLint, `tsc -b`, `deno check` |
| `npm test` · `npm run test:edge` | Vitest · testes Deno |
| `npm run test:db` | pgTAP no Supabase local |
| `npm run deadcode` | knip |
| `npm run check` | tudo acima (menos pgTAP) + build |
| `npm run supabase:start` · `functions:serve` | stack local · Edge Functions locais |

## Qualidade e segurança

* CI em todo PR/push: lint, typecheck (web e Deno), vitest, testes Deno, knip, build, **banco do zero + pgTAP**, build do launcher.
* Segredos nunca no repositório; só a anon key (pública) aparece em arquivos versionados..
* Mudanças de banco: sempre migration nova + teste pgTAP; consulte as regras no grafo (`graphify query "regras ao mexer no banco"`).
* Merge **não** faz deploy: produção só muda com `supabase db push` / `supabase functions deploy` / deploy da Vercel, com confirmação.
