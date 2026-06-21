import { useQuery } from '@tanstack/react-query'
import { DollarSign } from 'lucide-react'
import { EmptyState, Skeleton } from '@/components/ui'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { supabase } from '@/lib/supabase'
import { formatDateTime } from '@/lib/utils'
import type { Payment } from '@/types'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'

function PaymentStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    paid: 'text-success bg-success/10',
    pending: 'text-warning bg-warning/10',
    failed: 'text-danger bg-danger/10',
    refunded: 'text-ink-secondary bg-bg-elevated',
    disputed: 'text-danger bg-danger/10',
  }
  return (
    <span className={`badge ${colors[status] ?? 'text-ink-muted bg-bg-overlay'} capitalize`}>
      {status}
    </span>
  )
}

export function AdminPaymentsPage() {
  const { t } = useTranslation()
  const currency = useCurrency()

  const { data: payments, isLoading } = useQuery({
    queryKey: ['admin-payments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data as Payment[]
    },
  })

  const totalPaid = payments?.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0) ?? 0

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">{t('admin.payments.title')}</h1>
        <div className="card px-4 py-2">
          <p className="text-xs text-ink-muted">{t('admin.payments.totalCollected')}</p>
          <p className="text-lg font-bold text-success">{currency(totalPaid)}</p>
        </div>
      </div>

      <div className="card p-0">
        {isLoading ? <div className="p-4"><Skeleton className="h-48 w-full" /></div> :
          !payments?.length ? <EmptyState icon={DollarSign} title={t('admin.payments.empty')} /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.payments.table.id')}</TableHead>
                <TableHead>{t('admin.payments.table.order')}</TableHead>
                <TableHead>{t('admin.payments.table.amount')}</TableHead>
                <TableHead>{t('admin.payments.table.method')}</TableHead>
                <TableHead>{t('admin.payments.table.status')}</TableHead>
                <TableHead>{t('admin.payments.table.date')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell><span className="font-mono text-xs text-ink-secondary">{p.mp_payment_id.slice(-12)}</span></TableCell>
                  <TableCell><span className="font-mono text-xs text-brand">{p.order_id.slice(0, 8).toUpperCase()}</span></TableCell>
                  <TableCell className="font-semibold text-ink">{currency(p.amount)}</TableCell>
                  <TableCell className="capitalize">{p.payment_method_type ?? '—'}</TableCell>
                  <TableCell><PaymentStatusBadge status={p.status} /></TableCell>
                  <TableCell>{formatDateTime(p.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
