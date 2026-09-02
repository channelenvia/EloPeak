import { useEffect, useState } from 'react'
import { Search, ShoppingBag } from 'lucide-react'
import { Skeleton, EmptyState, ErrorAlert, Button, Pagination } from '@/components/ui'
import { CustomerOrderCard } from '@/components/order/CustomerOrderCard'
import { ServiceFilterBar } from '@/components/order/ServiceFilterBar'
import { useServiceFilters } from '@/components/order/useServiceFilters'
import { ORDER_STATUS_GROUP_LABEL } from '@/lib/utils'
import type { AdminOrdersTab } from '@/api/orders'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import { useAdminOrders } from '@/api/orders'

// Padronizado com OrderHistory.tsx (cliente) e booster/Orders.tsx: sempre as
// mesmas 3 abas (Todos/Em andamento/Concluído). "Em andamento" aqui inclui
// todo pedido "aguardando algo" (pagamento, booster, credenciais, drop) --
// não é mais uma aba própria separada de "Aguardando Booster".
const STATUS_OPTS: { label: string; value: Exclude<AdminOrdersTab, 'canceled'> }[] = [
  { label: ORDER_STATUS_GROUP_LABEL.in_progress, value: 'in_progress' },
  { label: ORDER_STATUS_GROUP_LABEL.completed,   value: 'completed' },
  { label: 'Todos',                              value: 'all' },
]

export function AdminOrdersPage() {
  const [tab, setTab] = useState<AdminOrdersTab>('in_progress')
  const [search, setSearch] = useState('')
  const { t } = useTranslation()
  const currency = useCurrency()

  // Categoria/subtipo (fila, tier+dia de Clash) filtrados no cliente -- mesmo
  // padrão de AvailableJobs.tsx (booster) e "Meus Pedidos" (cliente). Serviço
  // sempre busca 'all' do servidor pra essa filtragem cobrir os 100 mais
  // recentes inteiros, não só os que já vieram de um tipo pré-filtrado.
  const { data: orders, isLoading, isError, refetch } = useAdminOrders(tab, 'all')
  const serviceFilters = useServiceFilters(orders)

  const filtered = serviceFilters.filtered.filter((o) =>
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
          <div className="flex gap-1 bg-bg-surface/80 backdrop-blur-sm border border-border-subtle rounded-xl p-1 overflow-x-auto">
            {STATUS_OPTS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => setTab(value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 ${tab === value ? 'bg-brand text-white' : 'text-ink-secondary hover:text-ink'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {/* Auditoria à parte do grupo padrão -- cancelados/reembolsados/disputados
              nunca aparecem em Todos/Em andamento/Concluído, só aqui, opt-in. */}
          <button
            onClick={() => setTab(tab === 'canceled' ? 'all' : 'canceled')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 border ${
              tab === 'canceled'
                ? 'bg-danger/10 text-danger border-danger/20'
                : 'text-ink-muted border-transparent hover:text-ink-secondary hover:border-border-subtle'
            }`}
            title="Auditoria: pedidos cancelados, reembolsados e disputados"
          >
            Ver cancelados
          </button>
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
