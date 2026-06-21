import { useQuery } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { EmptyState, Skeleton } from '@/components/ui'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'

export function AdminCustomersPage() {
  const { t } = useTranslation()
  const currency = useCurrency()

  const { data: customers, isLoading } = useQuery({
    queryKey: ['admin-customers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customer_profiles')
        .select('*, profiles(email, username, created_at)')
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data
    },
  })

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-ink">{t('admin.customers.title')}</h1>
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
              {customers.map((c) => {
                const p = c.profiles as { email: string; username: string; created_at: string } | null
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium text-ink">{p?.username ?? '—'}</TableCell>
                    <TableCell>{p?.email ?? '—'}</TableCell>
                    <TableCell>{c.total_orders}</TableCell>
                    <TableCell className="font-semibold">{currency(c.total_spent)}</TableCell>
                    <TableCell>{p?.created_at ? formatDate(p.created_at) : '—'}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
