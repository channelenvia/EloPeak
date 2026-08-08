import { useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardList, Search } from 'lucide-react'
import { EmptyState, Skeleton } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { cn, ORDER_STATUS_LABEL } from '@/lib/utils'
import { CompletedOrderCard } from '@/features/booster/components/CompletedOrderCard'
import { ServiceFilterBar } from '@/components/order/ServiceFilterBar'
import { useServiceFilters } from '@/components/order/useServiceFilters'
import { useBoosterOrdersInfinite } from '@/api/orders'
import type { BoosterOrdersTab } from '@/api/orders'
import { useOwnBoosterTop3Status } from '@/api/boosters'

// Agrupa o enum real de order_status em abas — nenhum status é excluído,
// só reorganizado para o contexto de "pedidos do booster" (o pool de pedidos
// ainda não aceitos, awaiting_assignment, é responsabilidade da página Jobs).
// Mesmo rótulo de status usado em todo o resto do produto (ORDER_STATUS_LABEL).
const TABS: { key: BoosterOrdersTab; label: string }[] = [
  { key: 'active',    label: ORDER_STATUS_LABEL.in_progress },
  { key: 'completed', label: ORDER_STATUS_LABEL.completed   },
  { key: 'canceled',  label: ORDER_STATUS_LABEL.canceled    },
]

type TabKey = BoosterOrdersTab

// Page size scales with viewport so wider screens (more grid columns) load
// proportionally more cards per batch than a single mobile column would.
function getPageSize(): number {
  if (typeof window === 'undefined') return 12
  const w = window.innerWidth
  if (w >= 1280) return 18 // xl: 3 cols × 6 rows
  if (w >= 768) return 12  // md: 2 cols × 6 rows
  return 6                 // mobile: 1 col × 6 rows
}

export function BoosterOrdersPage() {
  const { profile } = useAuthStore()
  const pageSize = useMemo(getPageSize, [])
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<TabKey>('active')
  const [search, setSearch] = useState('')

  const { data: isTop3 } = useOwnBoosterTop3Status(profile?.id)

  const {
    data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useBoosterOrdersInfinite(profile?.id, tab, pageSize)

  const rawOrders = data?.pages.flatMap((p) => p.orders) ?? []
  const serviceFilters = useServiceFilters(rawOrders)
  const orders = serviceFilters.filtered
    .filter((o) => !search || o.id.toLowerCase().includes(search.toLowerCase()))

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage()
      }
    }, { rootMargin: '200px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Pedidos</h1>
        <p className="text-sm text-ink-secondary mt-1">Todos os pedidos atribuídos a você, organizados por status.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-48 shrink-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-muted pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar por código do pedido..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-base pl-8 py-1.5 text-xs"
          />
        </div>
        <div className="flex gap-1 bg-bg-surface/80 backdrop-blur-sm border border-bg-elevated rounded-xl p-1">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                tab === key ? 'bg-brand text-white' : 'text-ink-secondary hover:text-ink',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <ServiceFilterBar
          category={serviceFilters.category}
          onCategoryChange={serviceFilters.setCategory}
          counts={serviceFilters.counts}
          queue={serviceFilters.queue}
          onQueueChange={serviceFilters.setQueue}
          mode={serviceFilters.mode}
          onModeChange={serviceFilters.setMode}
          clashTier={serviceFilters.clashTier}
          onClashTierChange={serviceFilters.setClashTier}
          clashDay={serviceFilters.clashDay}
          onClashDayChange={serviceFilters.setClashDay}
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-2xl" />)}
        </div>
      ) : !orders.length ? (
        <EmptyState icon={ClipboardList} title="Nenhum pedido aqui" description="Pedidos nesse status aparecerão aqui." />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {orders.map((order) => <CompletedOrderCard key={order.id} order={order} isTop3={isTop3} />)}
          </div>
          <div ref={sentinelRef} className="h-4" />
          {isFetchingNextPage && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {[...Array(Math.min(3, pageSize))].map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-2xl" />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}
