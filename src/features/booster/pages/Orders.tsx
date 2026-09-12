import { useEffect, useState } from 'react'
import { ShoppingBag } from 'lucide-react'
import { EmptyState, Pagination, SearchInput, Skeleton } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { CompletedOrderCard } from '@/features/booster/components/CompletedOrderCard'
import { ServiceFilterBar } from '@/components/order/ServiceFilterBar'
import { useServiceFilters } from '@/components/order/useServiceFilters'
import { OrderStatusFilterDropdown } from '@/components/order/OrderStatusFilterDropdown'
import { useOrderStatusFilter } from '@/components/order/useOrderStatusFilter'
import { useBoosterOrdersPage, useBoosterOrderTabCounts } from '@/api/orders'
import { useOwnBoosterTop3Status } from '@/api/boosters'

const PAGE_SIZE = 12

export function BoosterOrdersPage() {
  const { profile } = useAuthStore()
  const statusFilter = useOrderStatusFilter('in_progress')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const { data: isTop3 } = useOwnBoosterTop3Status(profile?.id)

  const { data, isLoading } = useBoosterOrdersPage(profile?.id, statusFilter.tab, page, PAGE_SIZE, statusFilter.includeCanceled)
  const { data: tabCounts } = useBoosterOrderTabCounts(profile?.id)

  const rawOrders = data?.orders ?? []
  const serviceFilters = useServiceFilters(rawOrders)
  const subCounts = statusFilter.subFilterCounts(serviceFilters.filtered)
  const orders = statusFilter.applySubFilters(serviceFilters.filtered)
    .filter((o) => !search || o.id.toLowerCase().includes(search.toLowerCase()))
  const hasNextPage = data?.nextOffset !== undefined

  // Paginação é do servidor (useBoosterOrdersPage busca só a página atual),
  // mas dropped/overdue e os filtros de serviço são aplicados client-side EM
  // CIMA da página já buscada -- sem resetar a página ao mudar qualquer um
  // deles, o booster podia ficar preso numa página 2+ que o filtro client-side
  // zerou, mesmo havendo pedidos correspondentes na página 1. tab já cobre
  // includeCanceled (setIncludeCanceled troca a aba, ver useOrderStatusFilter).
  useEffect(() => { setPage(1) }, [
    statusFilter.tab, statusFilter.dropped, statusFilter.overdue,
    serviceFilters.category, serviceFilters.queue, serviceFilters.mode,
    serviceFilters.clashTier, serviceFilters.clashDay,
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Pedidos</h1>
        <p className="text-sm text-ink-secondary mt-1">Todos os pedidos atribuídos a você, organizados por status.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            wrapperClassName="w-full sm:w-64 shrink-0"
            placeholder="Buscar por ID do pedido..."
            aria-label="Buscar por ID do pedido"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <OrderStatusFilterDropdown
            tab={statusFilter.tab}
            onTabChange={statusFilter.setTab}
            counts={tabCounts}
            dropped={statusFilter.dropped}
            onDroppedChange={statusFilter.setDropped}
            droppedCount={subCounts.dropped}
            overdue={statusFilter.overdue}
            onOverdueChange={statusFilter.setOverdue}
            overdueCount={subCounts.overdue}
            includeCanceled={statusFilter.includeCanceled}
            onIncludeCanceledChange={statusFilter.setIncludeCanceled}
          />
        </div>
        <ServiceFilterBar
          category={serviceFilters.category}
          onCategoryChange={serviceFilters.setCategory}
          counts={serviceFilters.counts}
          queue={serviceFilters.queue}
          onQueueChange={serviceFilters.setQueue}
          queueCounts={serviceFilters.queueCounts}
          mode={serviceFilters.mode}
          onModeChange={serviceFilters.setMode}
          modeCounts={serviceFilters.modeCounts}
          clashTier={serviceFilters.clashTier}
          onClashTierChange={serviceFilters.setClashTier}
          clashTierCounts={serviceFilters.clashTierCounts}
          clashDay={serviceFilters.clashDay}
          onClashDayChange={serviceFilters.setClashDay}
          clashDayCounts={serviceFilters.clashDayCounts}
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
