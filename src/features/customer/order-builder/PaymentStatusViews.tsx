import { CheckCircle2, Clock, Loader2 } from 'lucide-react'

export function CenteredStatus({ label }: { label: string }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center" role="status">
      <Loader2 className="h-8 w-8 animate-spin text-brand" />
      <p className="text-sm font-medium text-ink-secondary">{label}</p>
    </div>
  )
}

export function PaymentConfirmed() {
  return (
    <div className="text-center py-8">
      <div className="h-16 w-16 rounded-2xl bg-success/10 flex items-center justify-center mx-auto mb-4">
        <CheckCircle2 className="h-8 w-8 text-success" />
      </div>
      <h2 className="text-xl font-bold text-ink mb-2">Pagamento Confirmado!</h2>
      <p className="text-sm text-ink-secondary">Pagamento aprovado. Redirecionando para os próximos passos…</p>
    </div>
  )
}

export function PixExpired() {
  return (
    <div className="text-center py-8 space-y-4">
      <div className="h-16 w-16 rounded-2xl bg-danger/10 flex items-center justify-center mx-auto">
        <Clock className="h-8 w-8 text-danger" />
      </div>
      <h2 className="text-xl font-bold text-ink">PIX Expirado</h2>
      <p className="text-sm text-ink-secondary">O pedido não foi pago e está sendo cancelado. Reiniciando o configurador…</p>
    </div>
  )
}
