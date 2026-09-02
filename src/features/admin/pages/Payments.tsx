import { Link } from 'react-router-dom'
import { CreditCard, DollarSign, ReceiptText } from 'lucide-react'
import { Card, EmptyState, Skeleton } from '@/components/ui'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { cn, formatDateTime, PAYMENT_STATUS_LABEL, PAYMENT_STATUS_COLOR } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import { useAdminPayments } from '@/api/admin'

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

  const { data: paymentSummary, isLoading } = useAdminPayments()
  const payments = paymentSummary?.payments

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

      <Card variant="operational" padding="none">
        {isLoading ? (
          <div className="p-4"><Skeleton className="h-48 w-full" /></div>
        ) : !payments?.length ? (
          <EmptyState icon={CreditCard} title="Nenhum pedido pago encontrado." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID Mercado Pago</TableHead>
                <TableHead>Pedido</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Método</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Data</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell><span className="font-mono text-xs text-ink-secondary">{payment.mp_payment_id.slice(-12)}</span></TableCell>
                  <TableCell>
                    <Link to={`/admin/orders/${payment.order_id}`} className="font-mono text-xs font-bold text-brand hover:underline">
                      {payment.order_id.slice(0, 8).toUpperCase()}
                    </Link>
                  </TableCell>
                  <TableCell className="font-semibold text-ink" data-tabular>{currency(payment.amount)}</TableCell>
                  <TableCell className="capitalize">{payment.payment_method_type ?? '—'}</TableCell>
                  <TableCell>
                    <StatusBadge className={PAYMENT_STATUS_COLOR[payment.status] ?? 'border-border-strong bg-bg-elevated text-ink-muted'}>
                      {PAYMENT_STATUS_LABEL[payment.status] ?? payment.status}
                    </StatusBadge>
                  </TableCell>
                  <TableCell>{formatDateTime(payment.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}
