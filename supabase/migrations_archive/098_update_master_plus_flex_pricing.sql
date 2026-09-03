-- Atualiza os preços comerciais de Master+ para a fila Flex (Mestre ->
-- Grão-Mestre, Grão-Mestre -> Challenger e Mestre -> Challenger direto).
-- A migration 093 tinha derivado a fila Flex como SoloQ x 0,95 por falta de
-- tabela comercial própria -- agora o time comercial passou uma tabela real
-- para Flex, com degraus de PDL mais granulares (25/50 PDL) e faixa de preço
-- própria, então os valores antigos (0,95x) são substituídos aqui.
--
-- Fila solo_duo não é alterada por esta migration.

delete from public.master_plus_pricing
where queue_type = 'flex'
  and (current_tier, target_tier) in (
    ('master', 'grandmaster'),
    ('grandmaster', 'challenger'),
    ('master', 'challenger')
  );

insert into public.master_plus_pricing (current_tier, target_tier, queue_type, pdl_from, price) values
  -- Mestre -> Grão-Mestre (flex)
  ('master','grandmaster','flex',0,899.00),
  ('master','grandmaster','flex',25,834.90),
  ('master','grandmaster','flex',50,770.00),
  ('master','grandmaster','flex',75,704.90),
  ('master','grandmaster','flex',100,644.90),
  ('master','grandmaster','flex',125,580.00),
  ('master','grandmaster','flex',150,514.90),
  ('master','grandmaster','flex',175,450.00),
  ('master','grandmaster','flex',200,384.90),
  ('master','grandmaster','flex',225,320.00),
  ('master','grandmaster','flex',250,254.90),
  ('master','grandmaster','flex',275,194.90),
  ('master','grandmaster','flex',300,130.00),
  ('master','grandmaster','flex',325,64.90),
  -- Grão-Mestre -> Challenger (flex)
  ('grandmaster','challenger','flex',350,1250.00),
  ('grandmaster','challenger','flex',400,1144.90),
  ('grandmaster','challenger','flex',450,1040.00),
  ('grandmaster','challenger','flex',500,934.90),
  ('grandmaster','challenger','flex',550,830.00),
  ('grandmaster','challenger','flex',600,724.90),
  ('grandmaster','challenger','flex',650,620.00),
  ('grandmaster','challenger','flex',700,520.00),
  ('grandmaster','challenger','flex',750,414.90),
  ('grandmaster','challenger','flex',800,310.00),
  ('grandmaster','challenger','flex',850,204.90),
  ('grandmaster','challenger','flex',900,100.00),
  -- Mestre -> Challenger direto (flex)
  ('master','challenger','flex',0,2150.00),
  ('master','challenger','flex',100,1924.90),
  ('master','challenger','flex',200,1694.90),
  ('master','challenger','flex',300,1470.00),
  ('master','challenger','flex',350,1354.90),
  ('master','challenger','flex',400,1240.00),
  ('master','challenger','flex',500,1014.90),
  ('master','challenger','flex',600,790.00),
  ('master','challenger','flex',700,560.00),
  ('master','challenger','flex',800,334.90),
  ('master','challenger','flex',900,104.90);
