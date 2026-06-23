import { useQuery } from '@tanstack/react-query'
import { DollarSign, TrendingUp, Clock } from 'lucide-react'
import { Card, Skeleton } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { formatDate } from '@/lib/utils'
import type { PayoutRecord } from '@/types'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'

export function BoosterEarningsPage() {
  const { profile } = useAuthStore()
  const { t } = useTranslation()
  const currency = useCurrency()

  const { data: payouts, isLoading } = useQuery({
    queryKey: ['booster-payouts', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payout_records')
        .select('*')
        .eq('booster_id', profile!.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as PayoutRecord[]
    },
    enabled: !!profile?.id,
  })

  const totalEarned = payouts?.filter(p => p.status === 'paid').reduce((s, p) => s + p.net_amount, 0) ?? 0
  const pending = payouts?.filter(p => p.status === 'pending').reduce((s, p) => s + p.net_amount, 0) ?? 0
  const thisMonth = payouts?.filter(p => {
    const d = new Date(p.created_at)
    const now = new Date()
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  }).reduce((s, p) => s + p.net_amount, 0) ?? 0

  const chartData = Array.from({ length: 6 }, (_, i) => {
    const d = new Date()
    d.setMonth(d.getMonth() - (5 - i))
    const label = d.toLocaleDateString('pt-BR', { month: 'short' })
    const amount = (payouts ?? [])
      .filter(p => {
        const pd = new Date(p.created_at)
        return pd.getMonth() === d.getMonth() && pd.getFullYear() === d.getFullYear()
      })
      .reduce((s, p) => s + Number(p.net_amount), 0)
    return { month: label.charAt(0).toUpperCase() + label.slice(1), amount }
  })

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold text-ink">{t('booster.earnings.title')}</h1>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {[
          { label: t('booster.earnings.totalEarned'), value: currency(totalEarned), icon: DollarSign, color: 'text-success bg-success/10' },
          { label: t('booster.earnings.thisMonth'), value: currency(thisMonth), icon: TrendingUp, color: 'text-brand bg-brand/10' },
          { label: t('booster.earnings.pendingPayout'), value: currency(pending), icon: Clock, color: 'text-warning bg-warning/10' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} padding="md">
            <div className={`h-8 w-8 rounded-lg ${color} flex items-center justify-center mb-3`}>
              <Icon className="h-4 w-4" />
            </div>
            <p className="text-xl font-bold text-ink">{value}</p>
            <p className="text-xs text-ink-secondary mt-0.5">{label}</p>
          </Card>
        ))}
      </div>

      {/* Chart */}
      <Card padding="md">
        <h3 className="text-sm font-semibold text-ink mb-4">{t('booster.earnings.monthlyChart')}</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData}>
            <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#555A70' }} />
            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#555A70' }} tickFormatter={(v) => currency(v as number)} />
            <Tooltip
              contentStyle={{ background: '#181C2E', border: '1px solid #1E2338', borderRadius: '0.75rem' }}
              labelStyle={{ color: '#F1F4FF', fontSize: 12 }}
              formatter={(v: number) => [currency(v), t('booster.earnings.earned')]}
            />
            <Bar dataKey="amount" fill="#5B6CFF" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Payout history */}
      <Card padding="md">
        <h3 className="text-sm font-semibold text-ink mb-4">{t('booster.earnings.payoutHistory')}</h3>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : !payouts?.length ? (
          <p className="text-sm text-ink-muted py-4 text-center">{t('booster.earnings.noPayouts')}</p>
        ) : (
          <div className="space-y-2">
            {payouts.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-2.5 border-b border-bg-elevated last:border-0">
                <div>
                  <p className="text-sm font-medium text-ink">{t('booster.earnings.order', { id: p.order_id.slice(0, 8).toUpperCase() })}</p>
                  <p className="text-xs text-ink-muted">{formatDate(p.created_at)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-success">{currency(p.net_amount)}</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    p.status === 'paid' ? 'bg-success/10 text-success' :
                    p.status === 'pending' ? 'bg-warning/10 text-warning' :
                    'bg-bg-elevated text-ink-muted'
                  }`}>
                    {p.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
