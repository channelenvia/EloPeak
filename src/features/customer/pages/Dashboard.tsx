import { Link, useNavigate } from 'react-router-dom'
import { Plus, ShoppingBag, MessageCircle, Zap, Sparkles } from 'lucide-react'
import { Button, Skeleton, EmptyState, StatCard } from '@/components/ui'
import { CustomerOrderCard } from '@/components/order/CustomerOrderCard'
import { useAuthStore } from '@/stores/authStore'
import { useCurrency } from '@/hooks/useCurrency'
import { useCustomerOrders } from '@/api/orders'
import { useCustomerDashboardStats } from '@/api/customers'
import type { Order } from '@/types'

// Fila de prioridade: pedidos "em andamento" primeiro, depois aguardando
// início, depois concluídos (mais recentes primeiro), resto por último --
// em vez de só mostrar os ativos, a home vira uma fila única do que precisa
// de atenção até o que já foi entregue.
const PRIORITY_GROUP: Record<string, number> = {
  drop_requested: 0, in_progress: 0, paused: 0, awaiting_customer: 0, assigned: 0,
  awaiting_assignment: 1, paid: 1, awaiting_payment: 1,
  completed: 2,
}

function orderTimestamp(order: Order): number {
  const ref = order.status === 'completed' && order.completed_at ? order.completed_at : order.created_at
  return new Date(ref).getTime()
}

function sortByPriority(orders: Order[]): Order[] {
  return [...orders].sort((a, b) => {
    const groupDiff = (PRIORITY_GROUP[a.status] ?? 3) - (PRIORITY_GROUP[b.status] ?? 3)
    if (groupDiff !== 0) return groupDiff
    return orderTimestamp(b) - orderTimestamp(a)
  })
}

const RECENT_ORDERS_GRID_LIMIT = 12

export function CustomerDashboard() {
  const { profile } = useAuthStore()
  const navigate = useNavigate()
  const currency = useCurrency()
  const { data: orders, isLoading } = useCustomerOrders(profile?.id, 'all', 20)
  const { data: stats, isLoading: statsLoading } = useCustomerDashboardStats(profile?.id)

  const activeCount = stats?.activeOrders ?? 0
  const recentOrders = sortByPriority(orders ?? [])

  const activeMsg = activeCount === 0
    ? 'Nenhum pedido ativo no momento.'
    : activeCount === 1
      ? 'Você tem 1 pedido ativo.'
      : `Você tem ${activeCount} pedidos ativos.`

  return (
    <div className="space-y-6">
      {/* Mesmo glow sutil de fundo do herói da home (bg-hero-glow) + destaque
          em gradiente no nome -- antes era um header liso, sem nenhum dos
          tokens de "glamour" (glow/gradient) já usados alhures no app. */}
      <div className="relative overflow-hidden rounded-2xl border border-border-subtle bg-bg-surface/60 px-6 py-5">
        <div className="absolute inset-0 bg-hero-glow opacity-70 pointer-events-none" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-ink">
              Bem-vindo, <span className="text-gradient-brand">{profile?.username}</span>
              <Sparkles className="ml-2 inline h-5 w-5 text-accent align-[-2px]" />
            </h1>
            <p className="text-sm text-ink-secondary mt-1">{activeMsg}</p>
          </div>
          <Button asChild>
            <Link to="/orders/new">
              <Plus className="h-4 w-4" />
              Novo Pedido
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Pedidos Ativos',   value: activeCount,                          icon: Zap,           color: 'text-brand bg-brand/10' },
          { label: 'Total de Pedidos', value: stats?.totalOrders ?? 0,               icon: ShoppingBag,   color: 'text-accent bg-accent/10'  },
          { label: 'Concluídos',       value: stats?.completedOrders ?? 0,           icon: ShoppingBag,   color: 'text-success bg-success/10' },
          { label: 'Total Gasto',      value: currency(stats?.totalSpent ?? 0),      icon: MessageCircle, color: 'text-info bg-info/10' },
        ].map(({ label, value, icon, color }) => (
          <StatCard
            key={label}
            label={label}
            // activeCount vem de stats também (activeCount = stats?.activeOrders
            // ?? 0) -- enquanto a query carrega, os 4 cards mostrariam "0" real
            // por um instante antes do valor de verdade chegar. Mesmo padrão de
            // Skeleton já usado no grid de pedidos logo abaixo.
            value={statsLoading ? <Skeleton className="h-6 w-12" /> : value}
            icon={icon}
            color={color}
            valueSize="lg"
          />
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-ink">Pedidos recentes</h2>
          <Button asChild variant="link" size="sm">
            <Link to="/orders">Ver todos →</Link>
          </Button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-2xl" />)}
          </div>
        ) : !orders?.length ? (
          <EmptyState
            icon={ShoppingBag}
            title="Sem pedidos ainda"
            description="Faça seu primeiro pedido e comece a subir."
            action={{ label: 'Começar Boost', onClick: () => navigate('/orders/new') }}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {recentOrders.slice(0, RECENT_ORDERS_GRID_LIMIT).map((order) => (
              <CustomerOrderCard key={order.id} order={order} currency={currency} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
