import { Clock, Copy, CheckCircle2, QrCode, X } from 'lucide-react'
import { ActionBar, Button } from '@/components/ui'
import { cn } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'

export interface PixWaitingPanelProps {
  totalPrice: number
  qrCode: string
  qrCodeBase64: string | null
  remaining: number | null
  countdownLabel: string
  copied: boolean
  copyError: string | null
  onCopy: () => void
  onCancel: () => void
  cancelling: boolean
}

// Tela "aguardando pagamento" do PIX, compacta e em coluna única: valor/tempo,
// QR code, código copia-e-cola e ações. Compartilhada pelo order-builder e por
// "Meus Pedidos".
export function PixWaitingPanel({
  totalPrice, qrCode, qrCodeBase64, remaining, countdownLabel, copied, copyError, onCopy, onCancel, cancelling,
}: PixWaitingPanelProps) {
  const currency = useCurrency()
  const isUrgent = (remaining ?? Number.POSITIVE_INFINITY) < 120

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-ink-muted">Total a pagar</p>
          <p className="text-2xl font-extrabold text-brand tabular-figures" data-tabular>{currency(totalPrice)}</p>
        </div>
        <div
          className={cn(
            'flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold tabular-figures',
            isUrgent ? 'bg-danger/10 text-danger' : 'bg-bg-raised text-ink-secondary',
          )}
          data-tabular
        >
          <Clock className="h-3.5 w-3.5" />
          {countdownLabel}
        </div>
      </div>

      <div className="flex flex-col items-center gap-2">
        {qrCodeBase64 ? (
          <div className="rounded-xl bg-white p-2.5">
            <img src={`data:image/png;base64,${qrCodeBase64}`} alt="QR Code PIX" className="h-44 w-44" />
          </div>
        ) : (
          <div className="flex h-[12.5rem] w-[12.5rem] flex-col items-center justify-center gap-2 rounded-xl bg-bg-raised px-5 text-center">
            <QrCode className="h-10 w-10 animate-pulse text-ink-muted" />
            <p className="text-xs text-ink-muted">Gerando o QR code… use o código abaixo enquanto isso.</p>
          </div>
        )}
        <p className="text-xs text-ink-muted">Escaneie no app do seu banco ou copie o código</p>
      </div>

      <div className="space-y-1.5">
        <div className="rounded-xl border border-border-subtle bg-bg-raised px-3 py-2.5">
          <p className="select-all truncate font-mono text-xs text-ink-secondary">{qrCode}</p>
        </div>
        {copyError && <p className="text-xs text-danger">{copyError}</p>}
        <p className="flex items-center justify-center gap-2 pt-1 text-xs text-ink-secondary">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-brand" />
          Aguardando pagamento
        </p>
      </div>

      <ActionBar className="border-t border-border-subtle pt-4">
        <Button variant="secondary" onClick={onCancel} loading={cancelling} leftIcon={<X className="h-4 w-4" />}>
          Cancelar pedido
        </Button>
        <Button
          variant={copied ? 'success' : 'primary'}
          leftIcon={copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          onClick={onCopy}
          disabled={cancelling}
        >
          {copied ? 'Copiado!' : 'Copiar código'}
        </Button>
      </ActionBar>

      <p className="text-center text-2xs text-ink-muted">
        Pedido salvo em Meus Pedidos · Pagamento seguro via Mercado Pago
      </p>
    </div>
  )
}
