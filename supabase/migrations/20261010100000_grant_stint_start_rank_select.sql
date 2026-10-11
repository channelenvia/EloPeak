-- public.orders usa grants de SELECT por coluna para impedir que o payload
-- cifrado de game_credentials seja exposto ao browser. A migration que criou
-- stint_start_rank passou a incluir a coluna em ORDER_SAFE_COLUMNS, mas não a
-- adicionou a essa allow-list. Com isso, qualquer consulta autenticada usando
-- a projeção compartilhada falhava por inteiro com "permission denied for
-- table orders" (incluindo Painel e Pedidos do booster).
grant select (stint_start_rank)
  on public.orders to authenticated;
