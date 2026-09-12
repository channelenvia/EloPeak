import { Link } from 'react-router-dom'
import { useState } from 'react'
import { CreditCard, DollarSign, ReceiptText } from 'lucide-react'
import { Card, EmptyState, Pagination, SearchInput, Skeleton } from '@/components/ui'
import { cn, formatDateTime, PAYMENT_STATUS_LABEL, PAYMENT_STATUS_COLOR } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import { useAdminPayments } from '@/api/admin'
import { usePagedList } from '@/hooks/usePagedList'

function StatusBadge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold', className)}>
      {children}
    </span>
  )
}

function StatCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: React.ElementType; tone: string }) {
  return (
    <Card padding="md" className="min-w-0">
      <div className="flex items-center gap-3">
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', tone)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-ink-muted">{label}</p>
          <p className="truncate text-lg font-black text-ink" data-tabular>{value}</p>
        </div>
      </div>
    </Card>
  )
}

// Pagamentos de clientes (PIX/Mercado Pago) -- separado dos repasses aos
// boosters (ver /admin/payouts), que agora vivem no ledger financeiro
// (migration 081), não mais nesta página.
export function AdminPaymentsPage() {
  const currency = useCurrency()

  const [search, setSearch] = useState('')
  const { data: paymentSummary, isLoading } = useAdminPayments()
  const payments = paymentSummary?.payments
  const filtered = (payments ?? []).filter((p) => {
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return p.order_id.toLowerCase().includes(q) || p.mp_payment_id.toLowerCase().includes(q)
  })
  const { page, pageItems, hasNextPage, onPrev, onNext } = usePagedList(filtered, 20, search)

  return (
    <div className="space-y-6">
      <div>
        <p className="section-label mb-2">Financeiro</p>
        <h1 className="text-2xl font-bold text-ink">Pagamentos de clientes</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-secondary">
          Cobranças PIX recebidas via Mercado Pago. Para repasses aos boosters, veja Solicitações de saque.
        </p>
        {(paymentSummary?.paidOrderCount ?? 0) > (payments?.length ?? 0) && (
          <p className="mt-1 text-xs text-warning">
            Mostrando os 150 pedidos pagos mais recentes. Os indicadores consideram todo o histórico.
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard label="Total recebido" value={currency(paymentSummary?.totalReceived ?? 0)} icon={DollarSign} tone="bg-success/10 text-success" />
        <StatCard label="Pedidos realizados" value={String(paymentSummary?.paidOrderCount ?? 0)} icon={ReceiptText} tone="bg-brand/10 text-brand" />
      </div>

      <SearchInput
        wrapperClassName="w-full sm:w-64 shrink-0"
        placeholder="Buscar por código do pedido..."
        aria-label="Buscar por código do pedido"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-2xl" />)}
        </div>
      ) : !filtered.length ? (
        <Card variant="operational" padding="none">
          <EmptyState icon={CreditCard} title={search ? 'Nenhum pagamento encontrado.' : 'Nenhum pedido pago encontrado.'} />
        </Card>
      ) : (
        <>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {pageItems.map((payment) => (
            <Link key={payment.id} to={`/admin/orders/${payment.order_id}`}>
              <Card variant="interactive" padding="md" className="h-full flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-xs font-bold text-brand">#{payment.order_id.slice(0, 8).toUpperCase()}</span>
                  <StatusBadge className={PAYMENT_STATUS_COLOR[payment.status] ?? 'border-border-strong bg-bg-raised text-ink-muted'}>
                    {PAYMENT_STATUS_LABEL[payment.status] ?? payment.status}
                  </StatusBadge>
                </div>
                <p className="text-lg font-black text-ink" data-tabular>{currency(payment.amount)}</p>
                <div className="flex items-center justify-between text-[11px] text-ink-muted">
                  <span className="capitalize">{payment.payment_method_type ?? '—'}</span>
                  <span className="font-mono">{payment.mp_payment_id.slice(-12)}</span>
                </div>
                <p className="text-[11px] text-ink-muted">{formatDateTime(payment.created_at)}</p>
              </Card>
            </Link>
          ))}
        </div>
        <Pagination page={page} hasNextPage={hasNextPage} onPrev={onPrev} onNext={onNext} />
        </>
      )}
    </div>
  )
}
