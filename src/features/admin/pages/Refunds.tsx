import { RefreshCw } from 'lucide-react'
import { EmptyState, Skeleton } from '@/components/ui'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { formatDateTime } from '@/lib/utils'
import type { Refund } from '@/types'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import { useAdminRefunds } from '@/api/admin'

const REFUND_STATUS_LABEL: Record<Refund['status'], string> = {
  pending: 'Pendente',
  succeeded: 'Concluído',
  failed: 'Falhou',
}

export function AdminRefundsPage() {
  const { t } = useTranslation()
  const currency = useCurrency()

  const { data: refunds, isLoading } = useAdminRefunds()

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-ink">{t('admin.refunds.title')}</h1>
      {(refunds?.length ?? 0) >= 100 && (
        <p className="text-xs text-warning">Mostrando os 100 reembolsos mais recentes — pode haver mais.</p>
      )}
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
                      {REFUND_STATUS_LABEL[r.status]}
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
