import { useEffect, useState } from 'react'
import { Search, ShoppingBag } from 'lucide-react'
import { Skeleton, EmptyState, ErrorAlert, Button, Pagination } from '@/components/ui'
import { CustomerOrderCard } from '@/components/order/CustomerOrderCard'
import { ServiceFilterBar } from '@/components/order/ServiceFilterBar'
import { useServiceFilters } from '@/components/order/useServiceFilters'
import { OrderStatusFilterDropdown } from '@/components/order/OrderStatusFilterDropdown'
import { useOrderStatusFilter } from '@/components/order/useOrderStatusFilter'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import { useAdminOrders, useAdminOrderTabCounts } from '@/api/orders'

export function AdminOrdersPage() {
  const statusFilter = useOrderStatusFilter('in_progress')
  const [search, setSearch] = useState('')
  const { t } = useTranslation()
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

  const [page, setPage] = useState(1)
  const PAGE_SIZE = 12
  const pageOrders = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const hasNextPage = page * PAGE_SIZE < filtered.length
  const maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  useEffect(() => { if (page > maxPage) setPage(maxPage) }, [maxPage, page])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">{t('admin.orders.title')}</h1>
      {(orders?.length ?? 0) >= 100 && (
        <p className="text-xs text-warning">Mostrando os 100 pedidos mais recentes deste filtro — pode haver mais.</p>
      )}

      {/* Filters -- busca + status à esquerda, tipo de serviço à direita. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-48 shrink-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-muted pointer-events-none" />
            <input className="input-base pl-8 py-1.5 text-xs" placeholder={t('admin.orders.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
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
        <EmptyState icon={ShoppingBag} title={t('admin.orders.empty')} description="Ajuste os filtros ou o termo de busca." />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {pageOrders.map((order) => (
              <CustomerOrderCard key={order.id} order={order} currency={currency} basePath="/admin/orders" viewerRole="admin" />
            ))}
          </div>
          <Pagination page={page} hasNextPage={hasNextPage} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} />
        </>
      )}
    </div>
  )
}
