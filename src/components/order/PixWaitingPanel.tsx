import { Clock, Copy, CheckCircle2, QrCode, ShieldCheck, X } from 'lucide-react'
import { Button } from '@/components/ui'
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

// Tela "aguardando pagamento" do PIX -- QR + código copia-e-cola + indicador
// de status + Cancelar/Copiar. Markup puro (sem gerar/consultar PIX nenhum),
// extraído de StepPayment (order-builder, pedido acabou de ser criado) pra
// ser reaproveitado também pelo popup de "Meus Pedidos" (pedido já existia,
// aguardando pagamento). Os dois PRECISAM ficar visualmente idênticos --
// mesmo motivo do OrderRankRow: o cliente vê os dois em momentos diferentes
// do mesmo fluxo de pagamento.
export function PixWaitingPanel({
  totalPrice, qrCode, qrCodeBase64, remaining, countdownLabel, copied, copyError, onCopy, onCancel, cancelling,
}: PixWaitingPanelProps) {
  const currency = useCurrency()

  return (
    <div className="space-y-5">
      {/* Amount + timer */}
      <div className="flex items-center justify-between bg-bg-elevated rounded-2xl px-5 py-4">
        <div>
          <p className="text-xs text-ink-muted">Total a pagar</p>
          <p className="text-2xl font-extrabold text-brand mt-0.5">{currency(totalPrice)}</p>
        </div>
        <div className={`flex items-center gap-1.5 text-sm font-bold ${(remaining ?? Number.POSITIVE_INFINITY) < 120 ? 'text-danger' : 'text-ink-secondary'}`}>
          <Clock className="h-4 w-4" />
          {countdownLabel}
        </div>
      </div>

      {/* QR code */}
      <div className="flex flex-col items-center gap-4">
        {qrCodeBase64 ? (
          <div className="p-3 bg-white rounded-2xl shadow-sm border border-bg-elevated">
            <img
              src={`data:image/png;base64,${qrCodeBase64}`}
              alt="QR Code PIX"
              className="w-64 h-64"
            />
          </div>
        ) : (
          <div className="w-64 h-64 bg-bg-elevated rounded-2xl flex flex-col items-center justify-center gap-2 text-center px-4">
            <QrCode className="h-12 w-12 text-ink-muted animate-pulse" />
            <p className="text-[11px] text-ink-muted">Gerando imagem do QR code… use o código copia-e-cola abaixo enquanto isso.</p>
          </div>
        )}
        <p className="text-xs text-ink-muted">Válido por 30 minutos</p>
      </div>

      {/* Copy code */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-ink-secondary uppercase tracking-wide">
          Ou copie o código PIX Copia e Cola
        </p>
        <div className="bg-bg-elevated rounded-xl px-3 py-2.5 text-xs font-mono text-ink-secondary truncate">
          {qrCode.slice(0, 60)}…
        </div>
        {copyError && <p className="text-xs text-danger">{copyError}</p>}
      </div>

      {/* Status indicator */}
      <div className="flex items-center gap-2 text-xs text-ink-secondary bg-bg-surface/80 backdrop-blur-sm border border-bg-elevated rounded-xl px-4 py-3">
        <div className="h-2 w-2 rounded-full bg-brand animate-pulse" />
        Aguardando confirmação do pagamento…
      </div>

      <p className="text-[11px] text-center text-ink-muted">
        Este pedido continuará salvo em Meus pedidos para você pagar depois.
      </p>

      {/* Security */}
      <div className="flex items-start gap-2.5 text-xs text-ink-muted">
        <ShieldCheck className="h-3.5 w-3.5 text-success mt-0.5 shrink-0" />
        Pagamento processado com segurança pelo Mercado Pago. Seus dados bancários nunca passam por nossos servidores.
      </div>

      <div className="flex items-center justify-between">
        <Button
          size="lg"
          variant="danger-ghost"
          onClick={onCancel}
          loading={cancelling}
          leftIcon={<X className="h-4 w-4" />}
          className="w-40 shrink-0"
        >
          Cancelar
        </Button>
        <Button
          size="lg"
          variant={copied ? 'success' : 'secondary'}
          leftIcon={copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          onClick={onCopy}
          className="w-40 shrink-0"
        >
          {copied ? 'Copiado!' : 'Copiar'}
        </Button>
      </div>
    </div>
  )
}
