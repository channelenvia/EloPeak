import { Link } from 'react-router-dom'
import { CardGrid } from '@/components/ui/CardGrid'
import { PageHeader } from '@/components/ui/PageHeader'
import { useState } from 'react'
import { Users, ShoppingBag, Wallet } from 'lucide-react'
import { Card, EmptyState, Pagination, SearchInput, Skeleton } from '@/components/ui'
import { formatDate } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import { useAdminCustomers } from '@/api/customers'
import { usePagedList } from '@/hooks/usePagedList'

export function AdminCustomersPage() {
  const currency = useCurrency()
  const [search, setSearch] = useState('')

  const { data: customers, isLoading } = useAdminCustomers()
  const filtered = (customers ?? []).filter((c) => {
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return (c.profiles?.username ?? '').toLowerCase().includes(q) || (c.profiles?.email ?? '').toLowerCase().includes(q)
  })
  const { page, pageItems, hasNextPage, onPrev, onNext } = usePagedList(filtered, 20, search)

  return (
    <div className="space-y-6">
      <PageHeader title="Clientes" description="Mostrando apenas clientes com 1+ pedido nos últimos 30 dias." />
      {(customers?.length ?? 0) >= 100 && (
        <p className="text-xs text-warning">Mostrando os 100 clientes mais recentes — pode haver mais.</p>
      )}

      <SearchInput
        wrapperClassName="w-full sm:w-64 shrink-0"
        placeholder="Buscar por nome ou email…"
        aria-label="Buscar por nome ou email"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {isLoading ? (
        <CardGrid cols={4}>
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-2xl" />)}
        </CardGrid>
      ) : !filtered.length ? (
        <Card variant="operational" padding="none">
          <EmptyState icon={Users} title={search ? 'Nenhum cliente encontrado.' : 'Nenhum cliente com pedidos nos últimos 30 dias'} />
        </Card>
      ) : (
        <>
        <CardGrid cols={4}>
          {pageItems.map((c) => (
            <Link key={c.id} to={`/admin/customers/${c.id}`}>
              <Card variant="interactive" padding="md" className="h-full flex flex-col gap-3">
                <div className="min-w-0">
                  <p className="text-brand font-semibold text-sm truncate">{c.profiles?.username ?? '—'}</p>
                  <p className="text-xs text-ink-muted truncate">{c.profiles?.email ?? '—'}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-bg-raised/40 p-2">
                    <div className="flex items-center gap-1.5">
                      <ShoppingBag className="h-3.5 w-3.5 text-brand shrink-0" />
                      <p className="text-sm font-bold text-ink" data-tabular>{c.total_orders}</p>
                    </div>
                    <p className="text-2xs text-ink-muted mt-1 leading-tight uppercase tracking-wide">Pedidos</p>
                  </div>
                  <div className="rounded-xl bg-bg-raised/40 p-2">
                    <div className="flex items-center gap-1.5">
                      <Wallet className="h-3.5 w-3.5 text-success shrink-0" />
                      <p className="text-sm font-bold text-ink truncate" data-tabular>{currency(c.total_spent)}</p>
                    </div>
                    <p className="text-2xs text-ink-muted mt-1 leading-tight uppercase tracking-wide">Total Gasto</p>
                  </div>
                </div>
                <p className="text-xs text-ink-muted mt-auto">Entrou {c.profiles?.created_at ? formatDate(c.profiles.created_at) : '—'}</p>
              </Card>
            </Link>
          ))}
        </CardGrid>
        <Pagination page={page} hasNextPage={hasNextPage} onPrev={onPrev} onNext={onNext} />
        </>
      )}
    </div>
  )
}
