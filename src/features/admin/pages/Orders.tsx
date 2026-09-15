import { useEffect, useMemo, useState } from 'react'
import { Clock, ShoppingBag } from 'lucide-react'
import { Skeleton, EmptyState, ErrorAlert, Button, Pagination, SearchInput } from '@/components/ui'
import { CustomerOrderCard } from '@/components/order/CustomerOrderCard'
import { ServiceFilterBar } from '@/components/order/ServiceFilterBar'
import { useServiceFilters } from '@/components/order/useServiceFilters'
import { OrderStatusFilterDropdown } from '@/components/order/OrderStatusFilterDropdown'
import { useOrderStatusFilter } from '@/components/order/useOrderStatusFilter'
import { useCurrency } from '@/hooks/useCurrency'
import { useAdminOrders, useAdminOrderTabCounts } from '@/api/orders'
import { AssignModal, CancelModal } from '../components/PendingReviewPanel'
import { usePendingReviewNow } from '../components/pendingReviewTime'
import type { Order } from '@/types'

export function AdminOrdersPage() {
  const statusFilter = useOrderStatusFilter('in_progress')
  const [search, setSearch] = useState('')
  const [assignOrder, setAssignOrder] = useState<Order | null>(null)
  const [cancelOrder, setCancelOrder] = useState<Order | null>(null)
  const nowTick = usePendingReviewNow()
  const currency = useCurrency()

  // Categoria/subtipo (fila, tier+dia de Clash) filtrados no cliente -- mesmo
  // padrão de AvailableJobs.tsx (booster) e "Meus Pedidos" (cliente). Serviço
  // sempre busca 'all' do servidor pra essa filtragem cobrir os 100 mais
  // recentes inteiros, não só os que já vieram de um tipo pré-filtrado.
  const { data: orders, isLoading, isError, refetch } = useAdminOrders(statusFilter.tab, 'all', statusFilter.includeCanceled)
  const { data: tabCounts } = useAdminOrderTabCounts()
  const serviceFilters = useServiceFilters(orders)
  const subCounts = statusFilter.subFilterCounts(serviceFilters.filtered)

  const filtered = statusFilter.applySubFilters(serviceFilters.filtered).filter((o) =>
    !search || o.id.toLowerCase().includes(search.toLowerCase())
  )

  // Prioriza pedidos em pending_review no topo da listagem para revisão ágil
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const aPending = a.status === 'pending_review' ? 1 : 0
      const bPending = b.status === 'pending_review' ? 1 : 0
      if (aPending !== bPending) return bPending - aPending
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  }, [filtered])

  const pendingReviewCount = useMemo(() => {
    return orders?.filter((o) => o.status === 'pending_review').length ?? 0
  }, [orders])

  const [page, setPage] = useState(1)
  const PAGE_SIZE = 12
  const pageOrders = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const hasNextPage = page * PAGE_SIZE < sorted.length
  // Reseta pra página 1 em qualquer mudança de filtro/busca -- só clampar
  // pra maxPage (comportamento anterior) deixava o admin "preso" na página
  // 2+ do conjunto ANTIGO ao trocar de filtro. Mesmo padrão de
  // BoosterOrdersPage (Orders.tsx do booster) e OrderHistory.tsx (cliente).
  useEffect(() => { setPage(1) }, [
    statusFilter.tab, statusFilter.dropped, statusFilter.overdue, statusFilter.includeCanceled,
    serviceFilters.category, serviceFilters.queue, serviceFilters.mode,
    serviceFilters.clashTier, serviceFilters.clashDay, search,
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-ink">Pedidos</h1>
        {pendingReviewCount > 0 && (
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-warning/15 text-warning border border-warning/30 flex items-center gap-1.5 animate-pulse-slow">
            <Clock className="h-3.5 w-3.5" />
            {pendingReviewCount} em revisão
          </span>
        )}
      </div>
      {(orders?.length ?? 0) >= 100 && (
        <p className="text-xs text-warning">Mostrando os 100 pedidos mais recentes deste filtro — pode haver mais.</p>
      )}

      {/* Filters -- busca + status à esquerda, tipo de serviço à direita. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            wrapperClassName="w-full sm:w-64 shrink-0"
            placeholder="Buscar por ID do pedido..."
            aria-label="Buscar por ID do pedido..."
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
      ) : isError ? (
        <div className="space-y-3">
          <ErrorAlert message="Não foi possível carregar os pedidos." />
          <Button size="sm" onClick={() => refetch()}>Tentar novamente</Button>
        </div>
      ) : !filtered.length ? (
        <EmptyState icon={ShoppingBag} title="Nenhum pedido encontrado" description="Ajuste os filtros ou o termo de busca." />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {pageOrders.map((order) => (
              <CustomerOrderCard
                key={order.id}
                order={order}
                currency={currency}
                basePath="/admin/orders"
                viewerRole="admin"
                nowTick={nowTick}
                onAssign={setAssignOrder}
                onCancel={setCancelOrder}
              />
            ))}
          </div>
          <Pagination page={page} hasNextPage={hasNextPage} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} />

          {cancelOrder && (
            <CancelModal order={cancelOrder} open={!!cancelOrder} onClose={() => setCancelOrder(null)} />
          )}
          {assignOrder && (
            <AssignModal order={assignOrder} open={!!assignOrder} onClose={() => setAssignOrder(null)} />
          )}
        </>
      )}
    </div>
  )
}
