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
    queue, setQueue,
    mode, setMode,
    clashTier, setClashTier,
    clashDay, setClashDay,
  }
}
