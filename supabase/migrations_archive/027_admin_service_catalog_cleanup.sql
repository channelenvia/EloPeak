-- Limpeza do catálogo operacional:
-- - Placement Matches saiu do catálogo administrável/visível.
-- - MD5 continua existindo como service_type interno porque o fluxo de
--   Vitórias / MD5 grava pedidos como service_type='md5' e o backend valida
--   esse contrato separadamente.

update public.services
set is_active = false
where type = 'placement_matches';

update public.services
set
  name = 'Vitórias / MD5',
  short_description = 'Vitórias avulsas ou garantia MD5 para posicionamento',
  description = coalesce(description, 'Compre vitórias avulsas ou use o modo MD5 quando a conta ainda está no posicionamento.')
where type = 'win_boost';
