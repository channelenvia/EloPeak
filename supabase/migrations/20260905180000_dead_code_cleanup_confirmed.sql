-- Sprint 1 de limpeza de código morto -- parte 2, itens de confiança média
-- confirmados com o usuário: alcançáveis via RPC (authenticated/anon tinham
-- EXECUTE) mas sem nenhum chamador interno nem referência em src/,
-- supabase/functions/ ou shared/. Se algo depender disso fora deste repo,
-- esta migration documenta exatamente o que existia pra reverter rápido.
drop function if exists public.dispute_order_completion(uuid, text);
drop function if exists public.calc_elo_price_cents(text, text, text, text, text, text);
drop function if exists public.elo_rank_verification_fresh(uuid);

-- md5_matches_remaining: só escrita (create-pix-payment), nunca lida por
-- nenhuma função, view ou tela.
alter table public.orders drop column if exists md5_matches_remaining;
