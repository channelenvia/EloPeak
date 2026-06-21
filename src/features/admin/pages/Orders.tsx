import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import { OrderStatusBadge, Skeleton, EmptyState } from '@/components/ui'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { supabase } from '@/lib/supabase'
import { timeAgo } from '@/lib/utils'
import type { Order, OrderStatus } from '@/types'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'

export function AdminOrdersPage() {
  const [status, setStatus] = useState<OrderStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const { t } = useTranslation()
  const currency = useCurrency()

  const STATUS_OPTS: { label: string; value: OrderStatus | 'all' }[] = [
    { label: t('admin.orders.filters.all'), value: 'all' },
    { label: t('admin.orders.filters.active'), value: 'in_progress' },
    { label: t('admin.orders.filters.awaiting'), value: 'awaiting_assignment' },
    { label: t('admin.orders.filters.disputed'), value: 'disputed' },
    { label: t('admin.orders.filters.completed'), value: 'completed' },
  ]

  const { data: orders, isLoading } = useQuery({
    queryKey: ['admin-orders', status],
    queryFn: async () => {
      let q = supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(100)
      if (status !== 'all') q = q.eq('status', status)
      const { data, error } = await q
      if (error) throw error
      return data as unknown as Order[]
    },
    refetchInterval: 20000,
  })

  const filtered = orders?.filter((o) =>
    !search || o.id.toLowerCase().includes(search.toLowerCase())
  ) ?? []

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-ink">{t('admin.orders.title')}</h1>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted pointer-events-none" />
          <input className="input-base pl-9" placeholder={t('admin.orders.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-1 bg-bg-surface border border-bg-elevated rounded-xl p-1">
          {STATUS_OPTS.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setStatus(value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${status === value ? 'bg-brand text-white' : 'text-ink-secondary hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="card p-0">
        {isLoading ? (
          <div className="p-4"><Skeleton className="h-64 w-full" /></div>
        ) : !filtered.length ? (
          <EmptyState icon={Search} title={t('admin.orders.empty')} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.orders.table.id')}</TableHead>
                <TableHead>{t('admin.orders.table.service')}</TableHead>
                <TableHead>{t('admin.orders.table.server')}</TableHead>
                <TableHead>{t('admin.orders.table.amount')}</TableHead>
                <TableHead>{t('admin.orders.table.status')}</TableHead>
                <TableHead>{t('admin.orders.table.created')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((order) => (
                <TableRow key={order.id} clickable>
                  <TableCell>
                    <Link to={`/admin/orders/${order.id}`} className="font-mono text-brand hover:underline text-xs">
                      #{order.id.slice(0, 8).toUpperCase()}
                    </Link>
                  </TableCell>
                  <TableCell className="text-ink capitalize">{(order.service_id as string).replace(/_/g, ' ')}</TableCell>
                  <TableCell>{order.server}</TableCell>
                  <TableCell className="font-semibold text-ink">{currency(order.total_price)}</TableCell>
                  <TableCell><OrderStatusBadge status={order.status} /></TableCell>
                  <TableCell>{timeAgo(order.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
