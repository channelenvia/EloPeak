import { useEffect, useState } from 'react'
import { Search, ShoppingBag } from 'lucide-react'
import { EmptyState, Pagination, Skeleton } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { cn, ORDER_STATUS_GROUP_LABEL } from '@/lib/utils'
import { CompletedOrderCard } from '@/features/booster/components/CompletedOrderCard'
import { ServiceFilterBar } from '@/components/order/ServiceFilterBar'
import { useServiceFilters } from '@/components/order/useServiceFilters'
import { useBoosterOrdersPage } from '@/api/orders'
import type { BoosterOrdersTab } from '@/api/orders'
import { useOwnBoosterTop3Status } from '@/api/boosters'

// Padronizado com OrderHistory.tsx (cliente) e admin/Orders.tsx: sempre as
// mesmas 3 abas (Todos/Em andamento/Concluído). O pool de pedidos ainda não
// aceitos (awaiting_assignment) é responsabilidade da página Jobs -- aqui só
// entram pedidos já atribuídos a este booster. canceled/refunded/disputed
// nunca aparecem pro booster (não é tela de auditoria).
const TABS: { key: BoosterOrdersTab; label: string }[] = [
  { key: 'active',    label: ORDER_STATUS_GROUP_LABEL.in_progress },
  { key: 'completed', label: ORDER_STATUS_GROUP_LABEL.completed   },
  { key: 'all',       label: 'Todos' },
]

type TabKey = BoosterOrdersTab
const PAGE_SIZE = 12

export function BoosterOrdersPage() {
  const { profile } = useAuthStore()
  const [tab, setTab] = useState<TabKey>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const { data: isTop3 } = useOwnBoosterTop3Status(profile?.id)

  const { data, isLoading } = useBoosterOrdersPage(profile?.id, tab, page, PAGE_SIZE)

  const rawOrders = data?.orders ?? []
  const serviceFilters = useServiceFilters(rawOrders)
  const orders = serviceFilters.filtered
    .filter((o) => !search || o.id.toLowerCase().includes(search.toLowerCase()))
  const hasNextPage = data?.nextOffset !== undefined

  // Trocar de aba/busca sem voltar pra página 1 podia deixar o booster numa
  // página que não existe mais nesse recorte.
  useEffect(() => { setPage(1) }, [tab])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Pedidos</h1>
        <p className="text-sm text-ink-secondary mt-1">Todos os pedidos atribuídos a você, organizados por status.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-48 shrink-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-muted pointer-events-none" />
            <input
              type="text"
              placeholder="Buscar por ID do pedido..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-base pl-8 py-1.5 text-xs"
            />
          </div>
          <div className="flex gap-1 bg-bg-surface/80 backdrop-blur-sm border border-border-subtle rounded-xl p-1">
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
        <EmptyState icon={ShoppingBag} title="Nenhum pedido encontrado" description="Pedidos nesse status aparecerão aqui." />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {orders.map((order) => <CompletedOrderCard key={order.id} order={order} isTop3={isTop3} />)}
          </div>
          <Pagination page={page} hasNextPage={hasNextPage} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} />
        </>
      )}
    </div>
  )
}
