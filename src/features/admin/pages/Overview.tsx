import { useMemo } from 'react'
import { ShoppingBag, Users, TrendingUp } from 'lucide-react'
import { Card, OrderStatusBadge, Skeleton, StatCard, ErrorAlert } from '@/components/ui'
import { timeAgo } from '@/lib/utils'
import { Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import { useAdminDashboardStats } from '@/api/admin'

export function AdminOverview() {
  const { data: stats, isLoading, isError } = useAdminDashboardStats()
  const { t } = useTranslation()
  const currency = useCurrency()

  const recentOrders = stats?.recent_orders ?? []

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
        <ErrorAlert message="Não foi possível carregar as estatísticas do painel. Os valores abaixo podem estar incompletos ou desatualizados." />
      )}

      {/* KPI cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'Lucro da plataforma', value: currency(stats?.platform_profit ?? 0), icon: TrendingUp, color: 'text-brand bg-brand/10' },
            { label: t('admin.overview.activeOrders'), value: stats?.active_orders_count ?? 0, icon: ShoppingBag, color: 'text-brand bg-brand/10' },
            { label: t('admin.overview.pendingBoosters'), value: stats?.pending_boosters_count ?? 0, icon: Users, color: 'text-warning bg-warning/10' },
          ].map(({ label, value, icon, color }) => (
            <StatCard key={label} label={label} value={value} icon={icon} color={color} iconSize="md" />
          ))}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Orders chart */}
        <Card padding="md">
          <h3 className="text-sm font-semibold text-ink mb-4">{t('admin.overview.ordersWeek')}</h3>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData}>
              <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#6C6F75' }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#6C6F75' }} />
              <Tooltip
                contentStyle={{ background: '#141417', border: '1px solid #28282D', borderRadius: '0.75rem' }}
                labelStyle={{ color: '#EDEEEF', fontSize: 12 }}
              />
              <Bar dataKey="orders" fill="#22C55E" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <p className="sr-only">
            Pedidos por dia na última semana: {chartData.map((d) => `${d.day}: ${d.orders}`).join(', ')}.
          </p>
        </Card>

        {/* Recent orders */}
        <Card padding="md">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-ink">{t('admin.overview.recentOrders')}</h3>
            <Link to="/admin/orders" className="text-xs text-brand hover:underline">{t('admin.overview.viewAll')}</Link>
          </div>
          <div className="space-y-2">
            {recentOrders.map((order) => (
              <Link key={order.id} to={`/admin/orders/${order.id}`}>
                <div className="flex items-center justify-between py-2 hover:bg-bg-elevated rounded-lg px-2 -mx-2 transition-colors cursor-pointer">
                  <div>
                    <p className="text-xs font-mono text-ink">#{order.id?.slice(0, 8).toUpperCase()}</p>
                    <p className="text-[10px] text-ink-muted">{order.created_at && timeAgo(order.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-ink" data-tabular>{currency(order.total_price ?? 0)}</span>
                    {order.status && <OrderStatusBadge status={order.status} />}
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
