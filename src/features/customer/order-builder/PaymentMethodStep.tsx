import { ChevronLeft, ShieldCheck } from 'lucide-react'
import { Button, ErrorAlert } from '@/components/ui'
import { ActionBar } from '@/components/ui/ActionBar'
import { PaymentMethodPicker, type PaymentMethod } from '@/components/order/PaymentMethodPicker'
import { useCurrency } from '@/hooks/useCurrency'

interface PaymentMethodStepProps {
  insideModal: boolean
  totalPrice: number
  disabled: boolean
  pixErrorMessage: string | null
  saveError: string | null
  onSelect: (method: PaymentMethod) => void
  onBack: () => void
}

// Escolha da forma de pagamento (estado inicial, antes de gerar PIX/cartão).
export function PaymentMethodStep({
  insideModal, totalPrice, disabled, pixErrorMessage, saveError, onSelect, onBack,
}: PaymentMethodStepProps) {
  const currency = useCurrency()
  return (
    <div className="space-y-4">
      {/* Título só fora do Modal -- o Modal já tem o próprio cabeçalho (ver
          OrderBuilder.tsx). Aparece no fluxo de retomada em tela cheia. */}
      {!insideModal && <h2 className="text-lg font-bold text-ink">Pagamento</h2>}

      <div className="card-brand flex items-center justify-between rounded-2xl p-5">
        <div>
          <p className="text-xs text-ink-secondary">Total do Pedido</p>
          <p className="mt-0.5 text-2xl font-extrabold text-ink">{currency(totalPrice)}</p>
        </div>
      </div>

      <p className="text-sm font-medium text-ink-secondary">Como você prefere pagar?</p>
      <PaymentMethodPicker onSelect={onSelect} disabled={disabled} />

      {pixErrorMessage !== null && <ErrorAlert message={pixErrorMessage} />}
      {saveError && pixErrorMessage === null && <ErrorAlert message={saveError} />}

      {totalPrice <= 0 && (
        <p className="text-center text-xs text-danger">Configure seu pedido para ver o preço.</p>
      )}

      {!insideModal && (
        <ActionBar>
          <Button variant="secondary" onClick={onBack} leftIcon={<ChevronLeft className="h-4 w-4" />}>
            Voltar
          </Button>
        </ActionBar>
      )}

      <div className="flex items-start gap-3 text-xs text-ink-muted">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
        Processado pelo Mercado Pago. Não armazenamos seus dados bancários.
      </div>
    </div>
  )
}
