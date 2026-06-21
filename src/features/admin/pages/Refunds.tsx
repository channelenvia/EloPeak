import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { EmptyState, Skeleton } from '@/components/ui'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { supabase } from '@/lib/supabase'
import { formatDateTime } from '@/lib/utils'
import type { Refund } from '@/types'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'

export function AdminRefundsPage() {
  const { t } = useTranslation()
  const currency = useCurrency()

  const { data: refunds, isLoading } = useQuery({
    queryKey: ['admin-refunds'],
    queryFn: async () => {
      const { data, error } = await supabase.from('refunds').select('*').order('created_at', { ascending: false }).limit(100)
      if (error) throw error
      return data as Refund[]
    },
  })

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-ink">{t('admin.refunds.title')}</h1>
      <div className="card p-0">
        {isLoading ? <div className="p-4"><Skeleton className="h-48 w-full" /></div> :
          !refunds?.length ? <EmptyState icon={RefreshCw} title={t('admin.refunds.empty')} /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.refunds.table.id')}</TableHead>
                <TableHead>{t('admin.refunds.table.order')}</TableHead>
                <TableHead>{t('admin.refunds.table.amount')}</TableHead>
                <TableHead>{t('admin.refunds.table.reason')}</TableHead>
                <TableHead>{t('admin.refunds.table.status')}</TableHead>
                <TableHead>{t('admin.refunds.table.date')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {refunds.map((r) => (
                <TableRow key={r.id}>
                  <TableCell><span className="font-mono text-xs">{r.mp_refund_id.slice(-10)}</span></TableCell>
                  <TableCell><span className="font-mono text-xs text-brand">{r.order_id.slice(0, 8).toUpperCase()}</span></TableCell>
                  <TableCell className="font-semibold text-ink">{currency(r.amount)}</TableCell>
                  <TableCell>{r.reason}</TableCell>
                  <TableCell>
                    <span className={`badge capitalize ${r.status === 'succeeded' ? 'text-success bg-success/10' : r.status === 'failed' ? 'text-danger bg-danger/10' : 'text-warning bg-warning/10'}`}>
                      {r.status}
                    </span>
                  </TableCell>
                  <TableCell>{formatDateTime(r.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
