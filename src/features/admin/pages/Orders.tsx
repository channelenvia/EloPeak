import { useState } from 'react'
import { Search } from 'lucide-react'
import { Skeleton, EmptyState, ErrorAlert, Button } from '@/components/ui'
import { CustomerOrderCard } from '@/components/order/CustomerOrderCard'
import { ServiceFilterBar } from '@/components/order/ServiceFilterBar'
import { useServiceFilters } from '@/components/order/useServiceFilters'
import { ORDER_STATUS_LABEL } from '@/lib/utils'
import type { OrderStatus } from '@/types'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import { useAdminOrders } from '@/api/orders'

// Mesmo rótulo de status usado em todo o resto do produto (ORDER_STATUS_LABEL) --
// só "Todos" é sintético, não existe como OrderStatus de verdade.
const STATUS_OPTS: { label: string; value: OrderStatus | 'all' }[] = [
  { label: 'Todos',                                value: 'all' },
  { label: ORDER_STATUS_LABEL.in_progress,         value: 'in_progress' },
  { label: ORDER_STATUS_LABEL.awaiting_assignment, value: 'awaiting_assignment' },
  { label: ORDER_STATUS_LABEL.completed,           value: 'completed' },
  // "Todos" nunca inclui cancelados (listAdminOrders já filtra) -- pra
  // auditoria, o admin ainda consegue vê-los explicitamente aqui.
  { label: ORDER_STATUS_LABEL.canceled,            value: 'canceled' },
]

export function AdminOrdersPage() {
  const [status, setStatus] = useState<OrderStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const { t } = useTranslation()
  const currency = useCurrency()

  // Categoria/subtipo (fila, tier+dia de Clash) filtrados no cliente -- mesmo
  // padrão de AvailableJobs.tsx (booster) e "Meus Pedidos" (cliente). Serviço
  // sempre busca 'all' do servidor pra essa filtragem cobrir os 100 mais
  // recentes inteiros, não só os que já vieram de um tipo pré-filtrado.
  const { data: orders, isLoading, isError, refetch } = useAdminOrders(status, 'all')
  const serviceFilters = useServiceFilters(orders)

  const filtered = serviceFilters.filtered.filter((o) =>
    !search || o.id.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-ink">{t('admin.orders.title')}</h1>
      {(orders?.length ?? 0) >= 100 && (
        <p className="text-xs text-warning">Mostrando os 100 pedidos mais recentes deste filtro — pode haver mais.</p>
      )}

      {/* Filters -- tudo numa linha só, quebra só se não couber. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-48 shrink-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-muted pointer-events-none" />
          <input className="input-base pl-8 py-1.5 text-xs" placeholder={t('admin.orders.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-1 bg-bg-surface/80 backdrop-blur-sm border border-bg-elevated rounded-xl p-1 overflow-x-auto">
          {STATUS_OPTS.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setStatus(value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 ${status === value ? 'bg-brand text-white' : 'text-ink-secondary hover:text-ink'}`}
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
        <EmptyState icon={Search} title={t('admin.orders.empty')} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((order) => (
            <CustomerOrderCard key={order.id} order={order} currency={currency} basePath="/admin/orders" />
          ))}
        </div>
      )}
    </div>
  )
}
