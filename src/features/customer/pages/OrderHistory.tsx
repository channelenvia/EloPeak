import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ShoppingBag, Search } from 'lucide-react'
import { EmptyState, Skeleton } from '@/components/ui'
import { CustomerOrderCard } from '@/components/order/CustomerOrderCard'
import { ServiceFilterBar } from '@/components/order/ServiceFilterBar'
import { useServiceFilters } from '@/components/order/useServiceFilters'
import { useAuthStore } from '@/stores/authStore'
import { useCurrency } from '@/hooks/useCurrency'
import { ORDER_STATUS_LABEL } from '@/lib/utils'
import { useCustomerOrders } from '@/api/orders'
import type { OrderStatus } from '@/types'

// Mesmo rótulo de status usado em todo o resto do produto (ORDER_STATUS_LABEL,
// o texto dentro do OrderStatusBadge) -- só "Todos" é um valor sintético que
// não existe como OrderStatus de verdade.
const STATUS_FILTERS: { label: string; value: OrderStatus | 'all' }[] = [
  { label: 'Todos',                            value: 'all'        },
  { label: ORDER_STATUS_LABEL.in_progress,     value: 'in_progress'},
  { label: ORDER_STATUS_LABEL.completed,       value: 'completed'  },
]

export function OrderHistoryPage() {
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const { t } = useTranslation()
  const currency = useCurrency()
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all')
  const [search, setSearch] = useState('')

  const { data: orders, isLoading } = useCustomerOrders(profile?.id, 100)
  const serviceFilters = useServiceFilters(orders)

  const filtered = serviceFilters.filtered.filter((o) => {
    if (filter !== 'all' && o.status !== filter) return false
    if (search && !o.id.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">{t('customer.history.title')}</h1>

      {/* Filters -- tudo numa linha só, quebra só se não couber. */}
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
        <div className="flex gap-1 bg-bg-surface/80 backdrop-blur-sm border border-bg-elevated rounded-xl p-1">
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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((order) => (
            <CustomerOrderCard key={order.id} order={order} currency={currency} />
          ))}
        </div>
      )}
    </div>
  )
}
