import { Link } from 'react-router-dom'
import { Users } from 'lucide-react'
import { EmptyState, Skeleton } from '@/components/ui'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { formatDate } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import { useAdminCustomers } from '@/api/customers'

export function AdminCustomersPage() {
  const { t } = useTranslation()
  const currency = useCurrency()

  const { data: customers, isLoading } = useAdminCustomers()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">{t('admin.customers.title')}</h1>
        <p className="text-sm text-ink-secondary mt-1">Mostrando apenas clientes com 1+ pedido nos últimos 30 dias.</p>
      </div>
      {(customers?.length ?? 0) >= 100 && (
        <p className="text-xs text-warning">Mostrando os 100 clientes mais recentes — pode haver mais.</p>
      )}
      <div className="card p-0">
        {isLoading ? <div className="p-4"><Skeleton className="h-48 w-full" /></div> :
          !customers?.length ? <EmptyState icon={Users} title={t('admin.customers.empty')} /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.customers.table.username')}</TableHead>
                <TableHead>{t('admin.customers.table.email')}</TableHead>
                <TableHead>{t('admin.customers.table.totalOrders')}</TableHead>
                <TableHead>{t('admin.customers.table.totalSpent')}</TableHead>
                <TableHead>{t('admin.customers.table.joined')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((c) => (
                <TableRow key={c.id} clickable>
                  <TableCell className="font-medium text-ink">
                    <Link to={`/admin/customers/${c.id}`} className="text-brand hover:underline">
                      {c.profiles?.username ?? '—'}
                    </Link>
                  </TableCell>
                  <TableCell>{c.profiles?.email ?? '—'}</TableCell>
                  <TableCell data-tabular>{c.total_orders}</TableCell>
                  <TableCell className="font-semibold" data-tabular>{currency(c.total_spent)}</TableCell>
                  <TableCell>{c.profiles?.created_at ? formatDate(c.profiles.created_at) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
