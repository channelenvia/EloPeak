import { useState } from 'react'
import { ActionBar } from '@/components/ui/ActionBar'
import { Button, ErrorAlert, Modal } from '@/components/ui'
import { useCurrency } from '@/hooks/useCurrency'
import { useAdminCancelPaidOrder, useOrderSettlementPreview } from '@/api/orders'

const MIN_REASON_LENGTH = 10
const MAX_REASON_LENGTH = 500

// Cancela um pedido em analise sem devolver dinheiro ao cliente. O sistema calcula o que o booster recebe pelo progresso.
export function CancelWithoutRefundModal({ orderId, open, onClose }: { orderId: string; open: boolean; onClose: () => void }) {
  const currency = useCurrency()
  const [reason, setReason] = useState('')
  const cancelOrder = useAdminCancelPaidOrder()
  const { data: preview, isFetching } = useOrderSettlementPreview(open ? orderId : undefined)
  const canSubmit = reason.trim().length >= MIN_REASON_LENGTH && !cancelOrder.isPending

  function close() {
    onClose()
    setReason('')
    cancelOrder.reset()
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) close() }}
      title="Cancelar sem reembolso"
      description="O pedido é cancelado e o cliente NÃO recebe dinheiro de volta. O booster é creditado só pelo progresso entregue."
    >
      {isFetching && <p className="text-xs text-ink-muted">Calculando…</p>}
      {preview && (
        <div className="rounded-lg bg-bg-raised px-3 py-2.5 text-xs space-y-1">
          <p>Valor pago: <span className="font-semibold text-ink">{currency(preview.paid)}</span> · Progresso: <span className="font-semibold text-ink">{preview.progress_pct}%</span></p>
          <p>Booster recebe pelo progresso: <span className="font-semibold text-ink">{currency(preview.booster_credit)}</span></p>
        </div>
      )}
      <div>
        <label htmlFor="cancel-no-refund-reason" className="text-xs font-semibold text-ink-secondary block mb-1.5">Motivo (mín. {MIN_REASON_LENGTH} caracteres)</label>
        <textarea
          id="cancel-no-refund-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Descreva o motivo do cancelamento…"
          className="input-base w-full min-h-[80px] resize-none text-sm"
          maxLength={MAX_REASON_LENGTH}
        />
      </div>
      {cancelOrder.isError && (
        <ErrorAlert message={cancelOrder.error instanceof Error ? cancelOrder.error.message : 'Erro ao cancelar'} />
      )}
      <ActionBar>
        <Button variant="secondary" disabled={cancelOrder.isPending} onClick={close}>Voltar</Button>
        <Button
          variant="danger"
          loading={cancelOrder.isPending}
          disabled={!canSubmit}
          onClick={() => cancelOrder.mutate({ orderId, reason: reason.trim() }, { onSuccess: close })}
        >
          Cancelar sem reembolso
        </Button>
      </ActionBar>
    </Modal>
  )
}
