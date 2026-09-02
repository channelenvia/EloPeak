import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ShoppingBag, Search } from 'lucide-react'
import { EmptyState, Pagination, Skeleton } from '@/components/ui'
import { CustomerOrderCard } from '@/components/order/CustomerOrderCard'
import { ServiceFilterBar } from '@/components/order/ServiceFilterBar'
import { useServiceFilters } from '@/components/order/useServiceFilters'
import { useAuthStore } from '@/stores/authStore'
import { useCurrency } from '@/hooks/useCurrency'
import { ORDER_STATUS_GROUP_LABEL } from '@/lib/utils'
import { useCustomerOrders } from '@/api/orders'

// Padronizado com booster/Orders.tsx e admin/Orders.tsx: sempre as mesmas 3
// abas (Todos/Em andamento/Concluído). listCustomerOrders já exclui draft e
// canceled/refunded/disputed no servidor, então "tudo que não é completed"
// aqui já é, por definição, o grupo "em andamento".
type StatusFilter = 'all' | 'in_progress' | 'completed'

const STATUS_FILTERS: { label: string; value: StatusFilter }[] = [
  { label: ORDER_STATUS_GROUP_LABEL.in_progress, value: 'in_progress' },
  { label: ORDER_STATUS_GROUP_LABEL.completed,   value: 'completed'  },
  { label: 'Todos',                             value: 'all'        },
]

export function OrderHistoryPage() {
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const { t } = useTranslation()
  const currency = useCurrency()
  const [filter, setFilter] = useState<StatusFilter>('in_progress')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 12

  const { data: orders, isLoading } = useCustomerOrders(profile?.id, 100)
  const serviceFilters = useServiceFilters(orders)

  const filtered = serviceFilters.filtered.filter((o) => {
    if (filter === 'in_progress' && o.status === 'completed') return false
    if (filter === 'completed' && o.status !== 'completed') return false
    if (search && !o.id.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const pageOrders = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const hasNextPage = page * PAGE_SIZE < filtered.length

  // Qualquer filtro/busca muda o resultado -- clampa de volta pra última
  // página válida em vez de deixar o usuário preso numa página vazia.
  const maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  useEffect(() => { if (page > maxPage) setPage(maxPage) }, [maxPage, page])

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
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-base pl-8 py-1.5 text-xs"
            />
          </div>
          <div className="flex gap-1 bg-bg-surface/80 backdrop-blur-sm border border-border-subtle rounded-xl p-1">
            {STATUS_FILTERS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filter === value ? 'bg-brand text-white' : 'text-ink-secondary hover:text-ink'
                }`}
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

      {/* Order grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-2xl" />)}
        </div>
      ) : !filtered.length ? (
        <EmptyState
          icon={ShoppingBag}
          title={t('customer.history.empty')}
          description={filter !== 'all' ? t('customer.history.emptyFilter') : t('customer.history.emptyAll')}
          action={filter === 'all' ? { label: t('customer.history.startBoost'), onClick: () => navigate('/orders/new?new=1') } : undefined}
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
