import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, ShoppingBag, MessageCircle, Zap } from 'lucide-react'
import { Button, Card, OrderStatusBadge, Skeleton, EmptyState } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { timeAgo } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import type { Order } from '@/types'

function useRecentOrders(customerId: string) {
  return useQuery({
    queryKey: ['customer-orders', customerId, 'recent'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(5)

      if (error) throw error
      return data as unknown as Order[]
    },
  })
}

export function CustomerDashboard() {
  const { profile } = useAuthStore()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const currency = useCurrency()
  const { data: orders, isLoading } = useRecentOrders(profile?.id ?? '')

  const activeOrders = orders?.filter(o =>
    ['paid', 'awaiting_assignment', 'assigned', 'in_progress', 'paused', 'awaiting_customer'].includes(o.status)
  ) ?? []

  const completedCount = orders?.filter(o => o.status === 'completed').length ?? 0

  const hour = new Date().getHours()
  const greeting = hour < 12
    ? t('customer.dashboard.morning')
    : hour < 18
      ? t('customer.dashboard.afternoon')
      : t('customer.dashboard.evening')

  const activeMsg = activeOrders.length === 0
    ? t('customer.dashboard.noActive')
    : activeOrders.length === 1
      ? t('customer.dashboard.activeCount', { count: 1 })
      : t('customer.dashboard.activeCountPlural', { count: activeOrders.length })

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">
            {greeting}, {profile?.username} 👋
          </h1>
          <p className="text-ink-secondary mt-1">{activeMsg}</p>
        </div>
        <Button asChild>
          <Link to="/orders/new">
            <Plus className="h-4 w-4" />
            {t('customer.dashboard.newOrder')}
          </Link>
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: t('customer.dashboard.stats.active'),    value: activeOrders.length,  icon: Zap,           color: 'text-brand bg-brand-muted' },
          { label: t('customer.dashboard.stats.total'),     value: orders?.length ?? 0,  icon: ShoppingBag,   color: 'text-accent bg-accent/10'  },
          { label: t('customer.dashboard.stats.completed'), value: completedCount,        icon: ShoppingBag,   color: 'text-success bg-success/10' },
          { label: t('customer.dashboard.stats.spent'),     value: currency(orders?.reduce((s, o) => s + o.total_price, 0) ?? 0), icon: MessageCircle, color: 'text-info bg-info/10' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} padding="md">
            <div className={`h-8 w-8 rounded-lg ${color} flex items-center justify-center mb-3`}>
              <Icon className="h-4 w-4" />
            </div>
            <p className="text-2xl font-bold text-ink">{value}</p>
            <p className="text-xs text-ink-secondary mt-0.5">{label}</p>
          </Card>
        ))}
      </div>

      {/* Active orders */}
      {activeOrders.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-ink mb-3">{t('customer.dashboard.activeTitle')}</h2>
          <div className="space-y-3">
            {activeOrders.map((order) => (
              <OrderCard key={order.id} order={order} currency={currency} />
            ))}
          </div>
        </div>
      )}

      {/* Recent orders */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-ink">{t('customer.dashboard.recentTitle')}</h2>
          <Button asChild variant="ghost" size="sm">
            <Link to="/orders">{t('customer.dashboard.viewAll')}</Link>
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="card p-4"><Skeleton className="h-12 w-full" /></div>
            ))}
          </div>
        ) : !orders?.length ? (
          <EmptyState
            icon={ShoppingBag}
            title={t('customer.dashboard.empty')}
            description={t('customer.dashboard.emptyDesc')}
            action={{ label: t('customer.dashboard.startBoost'), onClick: () => navigate('/orders/new') }}
          />
        ) : (
          <div className="space-y-3">
            {orders.slice(0, 5).map((order) => (
              <OrderCard key={order.id} order={order} currency={currency} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function OrderCard({ order, currency }: { order: Order; currency: (amount: number) => string }) {
  return (
    <Link to={`/orders/${order.id}`}>
      <Card className="flex items-center justify-between gap-4 hover:border-brand/20 hover:shadow-card-hover transition-all duration-150 cursor-pointer">
        <div className="flex items-center gap-4 min-w-0">
          <div className="h-10 w-10 rounded-xl bg-brand-muted flex items-center justify-center shrink-0">
            <Zap className="h-5 w-5 text-brand" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink truncate">
              #{order.id.slice(0, 8).toUpperCase()}
            </p>
            <p className="text-xs text-ink-muted mt-0.5">{timeAgo(order.created_at)}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <span className="hidden sm:block text-sm font-semibold text-ink">
            {currency(order.total_price)}
          </span>
          <OrderStatusBadge status={order.status} />
        </div>
      </Card>
    </Link>
  )
}
