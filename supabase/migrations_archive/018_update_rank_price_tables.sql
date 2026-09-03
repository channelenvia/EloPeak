-- Atualiza preços comerciais informados em 2026-07-13.

-- MD5 Completo / placement_matches usa shared/pricing.ts no cálculo; esta
-- migration cobre a tabela Master+ que é lida do banco.
update public.master_plus_pricing
set price = case
  when current_tier = 'master' and target_tier = 'grandmaster' then 899.90
  when current_tier = 'grandmaster' and target_tier = 'challenger' then 1249.90
  when current_tier = 'master' and target_tier = 'challenger' then 2149.80
  else price
end
where (current_tier = 'master' and target_tier in ('grandmaster', 'challenger'))
   or (current_tier = 'grandmaster' and target_tier = 'challenger');
