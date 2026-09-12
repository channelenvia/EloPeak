import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/api/core/queryKeys'
import type { ServiceType, QueueType, BoostMode } from '@/types'
import { getCatalogGameIdBySlug, getCatalogServiceId, getMasterPlusPriceRow } from './queries'

// staleTime longo -- catálogo (games/services) muda raríssimo, não precisa
// refetch a cada montagem do Order Builder.
const CATALOG_STALE_TIME = 1000 * 60 * 30

export function useCatalogGameId(slug: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.catalog.gameId(slug ?? ''),
    queryFn: () => getCatalogGameIdBySlug(slug!),
    enabled: !!slug,
    staleTime: CATALOG_STALE_TIME,
  })
}

export function useCatalogServiceId(gameId: string | null | undefined, serviceType: ServiceType | null | undefined) {
  return useQuery({
    queryKey: queryKeys.catalog.serviceId(gameId ?? '', serviceType ?? ''),
    queryFn: () => getCatalogServiceId(gameId!, serviceType!),
    enabled: !!gameId && !!serviceType,
    staleTime: CATALOG_STALE_TIME,
  })
}

export function useMasterPlusPriceRow(params: {
  currentTier: string | undefined
  targetTier: string | undefined
  queueType: QueueType
  boostMode: BoostMode
  pdlFrom: number
  enabled: boolean
}) {
  return useQuery({
    queryKey: queryKeys.catalog.masterPlusPrice(params.currentTier ?? '', params.targetTier ?? '', params.queueType, params.boostMode, params.pdlFrom),
    queryFn: () => getMasterPlusPriceRow({
      currentTier: params.currentTier!, targetTier: params.targetTier!, queueType: params.queueType, boostMode: params.boostMode, pdlFrom: params.pdlFrom,
    }),
    enabled: params.enabled && !!params.currentTier && !!params.targetTier,
  })
}
