import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ShoppingBag, Search } from 'lucide-react'
import { EmptyState, Pagination, Skeleton } from '@/components/ui'
import { CustomerOrderCard } from '@/components/order/CustomerOrderCard'
import { ServiceFilterBar } from '@/components/order/ServiceFilterBar'
import { useServiceFilters } from '@/components/order/useServiceFilters'
import { OrderStatusFilterDropdown } from '@/components/order/OrderStatusFilterDropdown'
import { useOrderStatusFilter } from '@/components/order/useOrderStatusFilter'
import { useAuthStore } from '@/stores/authStore'
import { useCurrency } from '@/hooks/useCurrency'
import { useCustomerOrders, useCustomerOrderTabCounts } from '@/api/orders'

export function OrderHistoryPage() {
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const { t } = useTranslation()
  const currency = useCurrency()
  const statusFilter = useOrderStatusFilter('in_progress')
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
  const { data: orders, isLoading } = useCustomerOrders(profile?.id, statusFilter.tab, ORDERS_FETCH_LIMIT, statusFilter.includeCanceled)
  const hitFetchLimit = (orders?.length ?? 0) >= ORDERS_FETCH_LIMIT
  const { data: tabCounts } = useCustomerOrderTabCounts(profile?.id)
  const serviceFilters = useServiceFilters(orders)
  const subCounts = statusFilter.subFilterCounts(serviceFilters.filtered)

  const filtered = statusFilter.applySubFilters(serviceFilters.filtered).filter((o) =>
    !search || o.id.toLowerCase().includes(search.toLowerCase())
  )

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
      <h1 className="text-2xl font-bold text-ink">{t('customer.history.title')}</h1>

      {/* Filters -- busca + status à esquerda, tipo de serviço à direita. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-48 shrink-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-muted pointer-events-none" />
            <input
              type="text"
              placeholder={t('customer.history.search')}
              aria-label={t('customer.history.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-base pl-8 py-1.5 text-xs"
            />
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

      {hitFetchLimit && (
        <p className="text-xs text-ink-muted">
          Mostrando os primeiros {ORDERS_FETCH_LIMIT} pedidos. Filtros e busca não alcançam pedidos além desse limite.
        </p>
      )}

      {/* Order grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-2xl" />)}
        </div>
      ) : !filtered.length ? (
        <EmptyState
          icon={ShoppingBag}
          title={t('customer.history.empty')}
          description={statusFilter.tab !== 'all' ? t('customer.history.emptyFilter') : t('customer.history.emptyAll')}
          action={statusFilter.tab === 'all' ? { label: t('customer.history.startBoost'), onClick: () => navigate('/orders/new?new=1') } : undefined}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {pageOrders.map((order) => (
              <CustomerOrderCard key={order.id} order={order} currency={currency} />
            ))}
          </div>
          <Pagination page={page} hasNextPage={hasNextPage} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} />
        </>
      )}
    </div>
  )
}
