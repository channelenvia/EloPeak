-- Novo serviço Clash (Solo Clash / Duo Clash). Valor de enum isolado em sua
-- própria migration -- Postgres não permite usar um valor de enum recém
-- adicionado na mesma transação que o criou.
alter type public.service_type add value 'clash';
