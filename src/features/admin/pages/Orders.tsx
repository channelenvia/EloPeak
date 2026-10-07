import { useEffect, useMemo, useState } from 'react'
import { CardGrid } from '@/components/ui/CardGrid'
import { PageHeader } from '@/components/ui/PageHeader'
import { Clock, ShoppingBag } from 'lucide-react'
import { Badge, Skeleton, EmptyState, ErrorAlert, Button, Pagination } from '@/components/ui'
import { CustomerOrderCard } from '@/components/order/CustomerOrderCard'
import { OrderListToolbar } from '@/components/order/OrderListToolbar'
import { useServiceFilters } from '@/components/order/useServiceFilters'
import { useOrderStatusFilter } from '@/components/order/useOrderStatusFilter'
import { useCurrency } from '@/hooks/useCurrency'
import { useAdminOrders, useAdminOrderTabCounts } from '@/api/orders'
import { AssignModal, CancelModal } from '../components/PendingReviewPanel'
import { usePendingReviewNow } from '../components/pendingReviewTime'
import type { Order } from '@/types'
import { sortOrdersByStatusPriority } from '@/lib/orderStatusPriority'

export function AdminOrdersPage() {
  const statusFilter = useOrderStatusFilter()
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
  const sorted = useMemo(() => sortOrdersByStatusPriority(filtered, 'admin'), [filtered])

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
      <PageHeader
        title="Pedidos"
        badges={pendingReviewCount > 0 && (
          <Badge variant="warning" className="px-2.5 py-1 font-semibold animate-pulse-slow">
            <Clock className="h-3.5 w-3.5" />
            {pendingReviewCount} em revisão
          </Badge>
        )}
      />
      {(orders?.length ?? 0) >= 100 && (
        <p className="text-xs text-warning">Mostrando os 100 pedidos mais recentes deste filtro — pode haver mais.</p>
      )}

      {/* Filters -- busca + status à esquerda, tipo de serviço à direita. */}
      <OrderListToolbar
        search={search}
        onSearchChange={setSearch}
        statusFilter={statusFilter}
        tabCounts={tabCounts}
        subCounts={subCounts}
        serviceFilters={serviceFilters}
      />

      {isLoading ? (
        <CardGrid >
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-2xl" />)}
        </CardGrid>
      ) : isError ? (
        <div className="space-y-3">
          <ErrorAlert message="Não foi possível carregar os pedidos." />
          <Button size="sm" onClick={() => refetch()}>Tentar novamente</Button>
        </div>
      ) : !filtered.length ? (
        <EmptyState icon={ShoppingBag} title="Nenhum pedido encontrado" description="Ajuste os filtros ou o termo de busca." />
      ) : (
        <>
          <CardGrid >
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
          </CardGrid>
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
