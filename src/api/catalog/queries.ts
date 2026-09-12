import { supabase } from '@/lib/supabase'
import { normalizeApiError } from '@/api/core/errors'
import type { ServiceType, QueueType, BoostMode } from '@/types'

// Resolve slug/tipo (o que o configurador guarda no store, ex.: 'lol',
// 'elo_boost') pro uuid real de games/services -- create-pix-payment exige
// os uuids em service_id/game_id, o store nunca guarda eles diretamente.
export async function getCatalogGameIdBySlug(slug: string): Promise<string | null> {
  const { data, error } = await supabase.from('games').select('id').eq('slug', slug).maybeSingle()
  if (error) throw normalizeApiError(error)
  return data?.id ?? null
}

export async function getCatalogServiceId(gameId: string, serviceType: ServiceType): Promise<string | null> {
  const { data, error } = await supabase.from('services').select('id').eq('game_id', gameId).eq('type', serviceType).maybeSingle()
  if (error) throw normalizeApiError(error)
  return data?.id ?? null
}

// Preço do Master+ vem da tabela comercial -- depende do par (tier atual,
// tier alvo), da fila e do degrau de PDL atual (varia a cada 100 PDL). Pega
// o maior degrau que não ultrapassa o PDL atual (order by pdl_from desc +
// limit 1); acima do último degrau cadastrado usa o preço do último (mais
// barato). Se a combinação ainda não tem preço configurado, price vem null.
export async function getMasterPlusPriceRow(params: {
  currentTier: string
  targetTier: string
  queueType: QueueType
  boostMode: BoostMode
  pdlFrom: number
}): Promise<{ price: number | null } | null> {
  const { data, error } = await supabase
    .from('master_plus_pricing')
    .select('price')
    .eq('current_tier', params.currentTier)
    .eq('target_tier', params.targetTier)
    .eq('queue_type', params.queueType)
    .eq('boost_mode', params.boostMode)
    .lte('pdl_from', params.pdlFrom)
    .order('pdl_from', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw normalizeApiError(error)
  return data
}
