-- 172_public_booster_reviews_with_nickname_and_service.sql
-- O perfil público do booster agora lista, por avaliação: nickname do
-- cliente e serviço contratado (além de nota/comentário, que já eram
-- públicos via reviews_public_read quando is_public = true). profiles só
-- permite SELECT da própria linha (profiles_read_own) e orders é restrito a
-- customer/booster/admin, então o client anônimo não consegue ler
-- profiles.username nem orders.service_type direto -- precisa de uma função
-- SECURITY DEFINER, mesmo padrão de get_order_customer_nickname (migration
-- 171), mas liberada pra qualquer chamador (inclusive anon) já que só expõe
-- dados de reviews com is_public = true, que já são públicos por definição.

create or replace function public.get_public_booster_reviews(p_booster_id uuid)
returns table (
  id uuid,
  rating smallint,
  content text,
  created_at timestamptz,
  customer_nickname text,
  service_type text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    r.id,
    r.rating,
    r.content,
    r.created_at,
    coalesce(p.username, 'Cliente EloPeak') as customer_nickname,
    o.service_type::text as service_type
  from public.reviews r
  join public.orders o on o.id = r.order_id
  left join public.profiles p on p.id = r.customer_id
  where r.booster_id = p_booster_id
    and r.is_public = true
  order by r.created_at desc
  limit 100;
$$;

revoke all on function public.get_public_booster_reviews(uuid) from public;
grant execute on function public.get_public_booster_reviews(uuid) to anon, authenticated;
