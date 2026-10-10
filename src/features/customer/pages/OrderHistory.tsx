import { QueryErrorNotice } from '@/components/QueryErrorNotice'
import { useEffect, useMemo, useState } from 'react'
import { CardGrid } from '@/components/ui/CardGrid'
import { PageHeader } from '@/components/ui/PageHeader'
import { useNavigate } from 'react-router-dom'
import { ShoppingBag } from 'lucide-react'
import { EmptyState, Pagination, Skeleton } from '@/components/ui'
import { CustomerOrderCard } from '@/components/order/CustomerOrderCard'
import { OrderListToolbar } from '@/components/order/OrderListToolbar'
import { useServiceFilters } from '@/components/order/useServiceFilters'
import { useOrderStatusFilter } from '@/components/order/useOrderStatusFilter'
import { sortOrdersByStatusPriority } from '@/lib/orderStatusPriority'
import { useAuthStore } from '@/stores/authStore'
import { useCurrency } from '@/hooks/useCurrency'
import { useCustomerOrders, useCustomerOrderTabCounts } from '@/api/orders'

export function OrderHistoryPage() {
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const currency = useCurrency()
  const statusFilter = useOrderStatusFilter()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 12

  // Capado em ORDERS_FETCH_LIMIT (client-side, não é paginação de servidor de
  // verdade) -- hasNextPage/maxPage abaixo são computados só sobre esse
  // array truncado. Um cliente com mais pedidos que o limite nunca vê os
  // mais antigos nem os encontra pela busca, silenciosamente. Mostra um
  // aviso quando o limite é batido em vez de implicar que a lista/busca é
  // completa (fix de verdade seria paginação/busca no servidor).
  const ORDERS_FETCH_LIMIT = 100
  const { data: orders, isLoading, isError, error, refetch } = useCustomerOrders(profile?.id, statusFilter.tab, ORDERS_FETCH_LIMIT, statusFilter.includeCanceled)
  const hitFetchLimit = (orders?.length ?? 0) >= ORDERS_FETCH_LIMIT
  const { data: tabCounts } = useCustomerOrderTabCounts(profile?.id)
  const serviceFilters = useServiceFilters(orders)
  const subCounts = statusFilter.subFilterCounts(serviceFilters.filtered)

  const filtered = useMemo(() => sortOrdersByStatusPriority(
    statusFilter.applySubFilters(serviceFilters.filtered).filter((o) =>
      !search || o.id.toLowerCase().includes(search.toLowerCase())
    ),
    'customer',
  ), [statusFilter, serviceFilters.filtered, search])

  const pageOrders = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const hasNextPage = page * PAGE_SIZE < filtered.length

  // Reseta pra página 1 em qualquer mudança de filtro/busca -- só clampar
  // pra maxPage (comportamento anterior) deixava o usuário "preso" na
  // página 2+ do conjunto ANTIGO ao trocar de filtro, mostrando resultados
  // do novo filtro só se ele por acaso também tivesse página suficiente.
  // Mesmo padrão já usado em BoosterOrdersPage (Orders.tsx do booster).
  useEffect(() => { setPage(1) }, [
    statusFilter.tab, statusFilter.dropped, statusFilter.overdue, statusFilter.includeCanceled,
    serviceFilters.category, serviceFilters.queue, serviceFilters.mode,
    serviceFilters.clashTier, serviceFilters.clashDay, search,
  ])

  return (
    <div className="space-y-6">
      <PageHeader title="Histórico de Pedidos" />

      {/* Filters -- busca + status à esquerda, tipo de serviço à direita. */}
      <OrderListToolbar
        search={search}
        onSearchChange={setSearch}
        statusFilter={statusFilter}
        tabCounts={tabCounts}
        subCounts={subCounts}
        serviceFilters={serviceFilters}
      />

      {hitFetchLimit && (
        <p className="text-xs text-ink-muted">
          Mostrando os primeiros {ORDERS_FETCH_LIMIT} pedidos. Filtros e busca não alcançam pedidos além desse limite.
        </p>
      )}

      {/* Order grid */}
      <QueryErrorNotice isError={isError} error={error} onRetry={refetch} />
      {isLoading ? (
        <CardGrid >
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-2xl" />)}
        </CardGrid>
      ) : !filtered.length ? (
        <EmptyState
          icon={ShoppingBag}
          title="Nenhum pedido encontrado"
          description={statusFilter.tab !== 'all' ? 'Tente mudar o filtro.' : 'Faça seu primeiro pedido para começar.'}
          action={statusFilter.tab === 'all' ? { label: 'Configurar Boost', onClick: () => navigate('/orders/new?new=1') } : undefined}
        />
      ) : (
        <>
          <CardGrid >
            {pageOrders.map((order) => (
              <CustomerOrderCard key={order.id} order={order} currency={currency} />
            ))}
          </CardGrid>
          <Pagination page={page} hasNextPage={hasNextPage} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} />
        </>
      )}
    </div>
  )
}
