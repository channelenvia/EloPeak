import { useMemo } from 'react'
import { ShoppingBag, Users, TrendingUp } from 'lucide-react'
import { Card, OrderStatusBadge, Skeleton, StatCard, ErrorAlert } from '@/components/ui'
import { timeAgo } from '@/lib/utils'
import { Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import { useAdminDashboardStats } from '@/api/admin'
import { PendingReviewPanel } from '../components/PendingReviewPanel'

// Cores do gráfico lidas dos mesmos tokens usados no resto do app (ver
// globals.css) em vez de hex cravado -- Recharts não consegue ler classes
// Tailwind, mas aceita qualquer string CSS válida, incluindo rgb(var(...)).
const CHART_INK_MUTED = 'rgb(var(--color-ink-muted))'
const CHART_INK = 'rgb(var(--color-ink))'
const CHART_SURFACE = 'rgb(var(--color-bg-surface))'
const CHART_BORDER = 'rgb(var(--color-border-subtle))'
const CHART_BRAND = 'rgb(var(--color-brand))'

export function AdminOverview() {
  const { data: stats, isLoading, isError } = useAdminDashboardStats()
  const { t } = useTranslation()
  const currency = useCurrency()

  const recentOrders = stats?.recent_orders ?? []
  const pendingBoosters = stats?.pending_boosters_count ?? 0
  const needsAttention = pendingBoosters > 0

  const chartData = useMemo(() =>
    (stats?.daily_orders ?? []).map(({ day, count }) => {
      const label = new Date(`${day}T00:00:00`).toLocaleDateString('pt-BR', { weekday: 'short' })
      return { day: label.charAt(0).toUpperCase() + label.slice(1, 3), orders: count }
    })
  , [stats?.daily_orders])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">{t('admin.overview.title')}</h1>
        <div className="flex items-center gap-2 text-xs text-ink-muted">
          <div className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-slow" />
          {t('admin.overview.live')}
        </div>
      </div>

      {isError && (
        <ErrorAlert message="Não foi possível carregar as estatísticas. Valores podem estar desatualizados." />
      )}

      <PendingReviewPanel />

      {/* KPIs -- mesmo widget (StatCard) usado no dashboard do cliente, pra
          manter a formatação consistente entre papéis. Boosters pendentes
          continua clicável e muda de cor quando precisa de atenção. */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link to="/admin/boosters">
            <StatCard
              label={t('admin.overview.pendingBoosters')}
              value={pendingBoosters}
              icon={Users}
              color={needsAttention ? 'text-warning bg-warning/10' : 'text-brand bg-brand/10'}
              valueSize="lg"
            />
          </Link>
          <StatCard
            label="Lucro da plataforma"
            value={currency(stats?.platform_profit ?? 0)}
            icon={TrendingUp}
            color="text-success bg-success/10"
            valueSize="lg"
          />
          <StatCard
            label={t('admin.overview.activeOrders')}
            value={stats?.active_orders_count ?? 0}
            icon={ShoppingBag}
            color="text-info bg-info/10"
            valueSize="lg"
          />
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Orders chart -- centralizado verticalmente no card, altura maior
            que a versão anterior (ficava espremido demais). */}
        <Card variant="operational" padding="md" className="flex flex-col">
          <h3 className="text-sm font-semibold text-ink mb-3">{t('admin.overview.ordersWeek')}</h3>
          <div className="flex-1 flex items-center justify-center">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData}>
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: CHART_INK_MUTED }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: CHART_INK_MUTED }} />
                <Tooltip
                  contentStyle={{ background: CHART_SURFACE, border: `1px solid ${CHART_BORDER}`, borderRadius: '0.75rem' }}
                  labelStyle={{ color: CHART_INK, fontSize: 12 }}
                />
                <Bar dataKey="orders" fill={CHART_BRAND} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="sr-only">
            Pedidos por dia na última semana: {chartData.map((d) => `${d.day}: ${d.orders}`).join(', ')}.
          </p>
        </Card>

        {/* Recent orders */}
        <Card variant="operational" padding="md">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-ink">{t('admin.overview.recentOrders')}</h3>
            <Link to="/admin/orders" className="text-xs text-brand hover:underline">{t('admin.overview.viewAll')}</Link>
          </div>
          <div className="divide-y divide-border-subtle max-h-[300px] overflow-y-auto">
            {recentOrders.map((order) => (
              <Link key={order.id} to={`/admin/orders/${order.id}`}>
                <div className="flex items-center justify-between py-2 hover:bg-bg-interactive rounded-lg px-2 -mx-2 transition-colors cursor-pointer">
                  <div>
                    <p className="text-xs font-mono text-ink">#{order.id?.slice(0, 8).toUpperCase()}</p>
                    <p className="text-[10px] text-ink-muted">{order.created_at && timeAgo(order.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-ink tabular-figures" data-tabular>{currency(order.total_price ?? 0)}</span>
                    {order.status && (
                      <OrderStatusBadge order={{ status: order.status, assigned_booster_id: order.assigned_booster_id ?? null }} />
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
