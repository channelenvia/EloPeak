import { useEffect, useState } from 'react'
import { CardGrid } from '@/components/ui/CardGrid'
import { PageHeader } from '@/components/ui/PageHeader'
import { ShoppingBag } from 'lucide-react'
import { EmptyState, Pagination, Skeleton } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { CompletedOrderCard } from '@/features/booster/components/CompletedOrderCard'
import { OrderListToolbar } from '@/components/order/OrderListToolbar'
import { useServiceFilters } from '@/components/order/useServiceFilters'
import { useOrderStatusFilter } from '@/components/order/useOrderStatusFilter'
import { useBoosterOrdersPage, useBoosterOrderTabCounts } from '@/api/orders'
import { useOwnBoosterTop3Status } from '@/api/boosters'
import { sortOrdersByStatusPriority } from '@/lib/orderStatusPriority'

const PAGE_SIZE = 12

export function BoosterOrdersPage() {
  const { profile } = useAuthStore()
  const statusFilter = useOrderStatusFilter()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const { data: isTop3 } = useOwnBoosterTop3Status(profile?.id)

  const { data, isLoading } = useBoosterOrdersPage(profile?.id, statusFilter.tab, page, PAGE_SIZE, statusFilter.includeCanceled)
  const { data: tabCounts } = useBoosterOrderTabCounts(profile?.id)

  const rawOrders = data?.orders ?? []
  const serviceFilters = useServiceFilters(rawOrders)
  const subCounts = statusFilter.subFilterCounts(serviceFilters.filtered)
  const orders = sortOrdersByStatusPriority(
    statusFilter.applySubFilters(serviceFilters.filtered)
      .filter((o) => !search || o.id.toLowerCase().includes(search.toLowerCase())),
    'booster',
  )
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
      <PageHeader title="Pedidos" description="Todos os pedidos atribuídos a você, organizados por status." />

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
      ) : !orders.length ? (
        <EmptyState icon={ShoppingBag} title="Nenhum pedido encontrado" description="Pedidos nesse status aparecerão aqui." />
      ) : (
        <>
          <CardGrid >
            {orders.map((order) => <CompletedOrderCard key={order.id} order={order} isTop3={isTop3} />)}
          </CardGrid>
          <Pagination page={page} hasNextPage={hasNextPage} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} />
        </>
      )}
    </div>
  )
}
