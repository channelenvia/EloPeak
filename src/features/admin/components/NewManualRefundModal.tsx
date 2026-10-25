import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ActionBar } from '@/components/ui/ActionBar'
import { Button, ErrorAlert, Modal } from '@/components/ui'
import { useCurrency } from '@/hooks/useCurrency'
import { useProfileUsername } from '@/api/admin'
import { useAdminCreateManualRefund, useOrder, useOrderSettlementPreview } from '@/api/orders'
import { ORDER_ID_PATTERN } from './refundUtils'

// Reembolso aqui é sempre tratado manualmente entre admin e cliente (PIX de
// volta por fora, combinado via DM/ticket, ou estorno do cartão no painel do
// Mercado Pago) -- este formulário só registra o
// que já aconteceu, não chama o Mercado Pago. Por isso pede o ID completo do
// pedido (não dá pra buscar por texto parcial) e mostra cliente/valor total
// do pedido encontrado como confirmação antes de deixar submeter.
interface ManualRefundFormData {
  orderId: string
  reason: string
}

export function NewManualRefundModal({ open, onClose, initialOrderId = '' }: { open: boolean; onClose: () => void; initialOrderId?: string }) {
  const currency = useCurrency()
  const createRefund = useAdminCreateManualRefund()

  const { register, handleSubmit, watch, reset, formState: { errors, isValid } } = useForm<ManualRefundFormData>({
    resolver: zodResolver(z.object({
      orderId: z.string().refine((v) => ORDER_ID_PATTERN.test(v.trim()), 'ID inválido — cole o UUID completo do pedido (visível na URL da página do pedido).'),
      reason: z.string().trim().min(10, 'Motivo deve ter pelo menos 10 caracteres.').max(500),
    })),
    defaultValues: { orderId: initialOrderId, reason: '' },
    mode: 'onChange',
  })

  const orderId = watch('orderId')
  const trimmedId = orderId.trim()
  const looksLikeUuid = ORDER_ID_PATTERN.test(trimmedId)
  const { data: lookupOrder, isFetching: lookupLoading } = useOrder(looksLikeUuid ? trimmedId : undefined)
  const { data: customerUsername } = useProfileUsername(lookupOrder?.customer_id)

  const { data: preview, isFetching: previewLoading } = useOrderSettlementPreview(lookupOrder ? trimmedId : undefined)

  function close() {
    onClose()
    reset({ orderId: '', reason: '' })
  }

  const isUnderReview = lookupOrder?.status === 'under_review'
  const canSubmit = isValid && looksLikeUuid && !!lookupOrder && isUnderReview && !!preview && preview.refund_amount > 0

  function onSubmit(data: ManualRefundFormData) {
    createRefund.mutate({ orderId: data.orderId.trim(), reason: data.reason.trim() }, { onSuccess: close })
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) close() }}
      title="Marcar pra reembolsar"
      description="Cria o item em A reembolsar, sem chamar o Mercado Pago. Devolva o dinheiro por fora (PIX manual ou estorno do cartão no painel do Mercado Pago) e confirme no check: só então o pedido vira Reembolsado."
    >
      <div>
        <label htmlFor="manual-refund-order-id" className="text-xs font-semibold text-ink-secondary block mb-1.5">Número do pedido (ID completo)</label>
        <input
          id="manual-refund-order-id"
          {...register('orderId')}
          placeholder="Cole o ID completo do pedido…"
          className="input-base w-full text-sm font-mono"
        />
        {trimmedId.length > 0 && errors.orderId && (
          <p className="text-xs text-warning mt-1">{errors.orderId.message}</p>
        )}
        {looksLikeUuid && lookupLoading && <p className="text-xs text-ink-muted mt-1">Buscando pedido…</p>}
        {looksLikeUuid && !lookupLoading && !lookupOrder && <p className="text-xs text-danger mt-1">Pedido não encontrado.</p>}
        {lookupOrder && (
          <p className="text-xs text-ink-secondary mt-1.5 bg-bg-raised rounded-lg px-3 py-2">
            Cliente: <span className="font-semibold text-ink">{customerUsername ?? 'Carregando…'}</span> · Total do pedido: <span className="font-semibold text-ink">{currency(lookupOrder.total_price)}</span>
          </p>
        )}
      </div>

      {lookupOrder && !isUnderReview && (
        <p className="text-xs text-warning">Marque o pedido como &quot;Analisar&quot; antes de reembolsar ou cancelar.</p>
      )}
      {lookupOrder && previewLoading && <p className="text-xs text-ink-muted">Calculando…</p>}
      {preview && (
        <div className="rounded-lg bg-bg-raised px-3 py-2.5 text-xs space-y-1" data-testid="settlement-preview">
          <p className="font-semibold text-ink-secondary">Cálculo (definido pelo sistema)</p>
          <p>Valor pago: <span className="font-semibold text-ink">{currency(preview.paid)}</span> · Progresso: <span className="font-semibold text-ink">{preview.progress_pct}%</span></p>
          <p>Booster recebe pelo progresso: <span className="font-semibold text-ink">{currency(preview.booster_credit)}</span></p>
          <p>Reembolso ao cliente: <span className="font-semibold text-success">{currency(preview.refund_amount)}</span></p>
        </div>
      )}

      <div>
        <label htmlFor="manual-refund-reason" className="text-xs font-semibold text-ink-secondary block mb-1.5">Motivo (mín. 10 caracteres)</label>
        <textarea
          id="manual-refund-reason"
          {...register('reason')}
          placeholder="Descreva o motivo do reembolso…"
          className="input-base w-full min-h-[80px] resize-none text-sm"
          maxLength={500}
        />
      </div>

      {createRefund.isError && (
        <ErrorAlert message={createRefund.error instanceof Error ? createRefund.error.message : 'Erro'} />
      )}

      <ActionBar>
        <Button disabled={createRefund.isPending} variant="secondary" onClick={close}>Cancelar</Button>
        <Button
          variant="danger"
          loading={createRefund.isPending}
          disabled={!canSubmit}
          onClick={handleSubmit(onSubmit)}
        >
          Marcar pra reembolsar
        </Button>
      </ActionBar>
    </Modal>
  )
}
