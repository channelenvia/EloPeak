import { useState } from 'react'
import type { BoostMode, ClashDay, ClashTier, Order, QueueType, ServiceType } from '@/types'

// Mesmo agrupamento usado em AvailableJobs.tsx (booster) e StepService.tsx --
// win_boost/md5/placement_matches (legado) caem no mesmo balde "Wins",
// nunca aparecem como opções separadas de filtro.
export type ServiceCategory = 'all' | 'elo_boost' | 'win_boost' | 'clash' | 'coaching'

export function serviceCategoryOf(serviceType: ServiceType | null): ServiceCategory {
  if (serviceType === 'elo_boost') return 'elo_boost'
  if (serviceType === 'win_boost' || serviceType === 'md5' || serviceType === 'placement_matches') return 'win_boost'
  if (serviceType === 'clash') return 'clash'
  if (serviceType === 'coaching') return 'coaching'
  return 'all'
}

export const CLASH_TIERS: ClashTier[] = ['tier_4', 'tier_3', 'tier_2', 'tier_1']
export const CLASH_DAYS: ClashDay[] = ['saturday', 'sunday']

// Estado + lógica de filtro por serviço (e subtipos: fila pra Elo/Vitórias,
// tier+dia pra Clash) -- extraído de AvailableJobs.tsx (booster) pra
// reaproveitar o mesmo padrão em "Meus Pedidos" (cliente) e "Pedidos" (admin).
export function useServiceFilters(orders: Order[] | undefined) {
  // "Elo Boost como principal" é só posição na lista (ver SERVICE_CATEGORIES
  // em ServiceFilterBar.tsx) -- o padrão selecionado continua 'all'. Este
  // hook também alimenta AvailableJobs.tsx (pool de jobs do booster, sem
  // filtro de status), onde defaultar pra uma categoria só esconderia os
  // outros tipos de job por padrão sem o booster perceber.
  const [category, setCategoryRaw] = useState<ServiceCategory>('all')
  const [queue, setQueue] = useState<QueueType | 'all'>('all')
  const [mode, setMode] = useState<BoostMode | 'all'>('all')
  const [clashTier, setClashTier] = useState<ClashTier | 'all'>('all')
  const [clashDay, setClashDay] = useState<ClashDay | 'all'>('all')

  // Trocar de categoria zera os filtros de subtipo da categoria anterior --
  // um filtro de fila escolhido em Elo Boost não deve sobreviver ao trocar
  // pra Clash (onde fila nem existe) e voltar.
  function setCategory(next: ServiceCategory) {
    setCategoryRaw(next)
    setQueue('all')
    setMode('all')
    setClashTier('all')
    setClashDay('all')
  }

  const counts = (orders ?? []).reduce<Record<ServiceCategory, number>>((acc, o) => {
    const c = serviceCategoryOf(o.service_type)
    acc[c] = (acc[c] ?? 0) + 1
    return acc
  }, { all: orders?.length ?? 0, elo_boost: 0, win_boost: 0, clash: 0, coaching: 0 })

  // Contadores dos subfiltros (Fila/Modo/Tier/Dia) -- padrão de busca
  // facetada: o contador de cada campo reflete os OUTROS filtros já ativos
  // (categoria + o subfiltro irmão), nunca o próprio campo que está sendo
  // contado (senão a opção que falta escolher já apareceria com 0 ou um
  // número que não bate com o resultado real de clicar nela).
  const categoryOrders = (orders ?? []).filter((o) => category === 'all' || serviceCategoryOf(o.service_type) === category)
  const ordersForQueueCount = categoryOrders.filter((o) => mode === 'all' || o.boost_mode === mode)
  const ordersForModeCount = categoryOrders.filter((o) => queue === 'all' || o.queue_type === queue)
  const ordersForClashTierCount = categoryOrders.filter((o) => clashDay === 'all' || o.clash_day === clashDay)
  const ordersForClashDayCount = categoryOrders.filter((o) => clashTier === 'all' || o.clash_tier === clashTier)
  const queueCounts = ordersForQueueCount.reduce<Record<QueueType | 'all', number>>((acc, o) => {
    if (o.queue_type) acc[o.queue_type] = (acc[o.queue_type] ?? 0) + 1
    return acc
  }, { all: ordersForQueueCount.length, solo_duo: 0, flex: 0 })
  const modeCounts = ordersForModeCount.reduce<Record<BoostMode | 'all', number>>((acc, o) => {
    if (o.boost_mode) acc[o.boost_mode] = (acc[o.boost_mode] ?? 0) + 1
    return acc
  }, { all: ordersForModeCount.length, solo: 0, duo: 0 })
  const clashTierCounts = ordersForClashTierCount.reduce<Record<ClashTier | 'all', number>>((acc, o) => {
    if (o.clash_tier) acc[o.clash_tier] = (acc[o.clash_tier] ?? 0) + 1
    return acc
  }, { all: ordersForClashTierCount.length, tier_4: 0, tier_3: 0, tier_2: 0, tier_1: 0 })
  const clashDayCounts = ordersForClashDayCount.reduce<Record<ClashDay | 'all', number>>((acc, o) => {
    if (o.clash_day) acc[o.clash_day] = (acc[o.clash_day] ?? 0) + 1
    return acc
  }, { all: ordersForClashDayCount.length, saturday: 0, sunday: 0 })

  const filtered = (orders ?? []).filter((o) => {
    if (category !== 'all' && serviceCategoryOf(o.service_type) !== category) return false
    if (category === 'elo_boost' || category === 'win_boost') {
      if (queue !== 'all' && o.queue_type !== queue) return false
      if (mode !== 'all' && o.boost_mode !== mode) return false
    }
    if (category === 'clash') {
      if (clashTier !== 'all' && o.clash_tier !== clashTier) return false
      if (clashDay !== 'all' && o.clash_day !== clashDay) return false
    }
    return true
  })

  return {
    filtered, counts,
    category, setCategory,
    queue, setQueue, queueCounts,
    mode, setMode, modeCounts,
    clashTier, setClashTier, clashTierCounts,
    clashDay, setClashDay, clashDayCounts,
  }
}
