import { useEffect, useState } from 'react'
import { AlertTriangle, Clock } from 'lucide-react'
import { ActionBar } from '@/components/ui/ActionBar'
import { Button, ErrorAlert, Modal } from '@/components/ui'
import { useDisputeOrderCompletion } from '@/api/orders'
import type { OrderStatusHistory } from '@/types'
import { autoCompleteAt, awaitingCustomerSince, formatTimeLeft } from './completionDeadline'

const MIN_REASON = 10
const MAX_REASON = 500
const TICK_MS = 30_000

// RN-02: avisa que o pedido conclui sozinho em ate 12 h e oferece a contestacao (que suspende a conclusao automatica).
export function OrderCompletionNotice({ orderId, history, isCoaching = false }: { orderId: string; history: OrderStatusHistory[] | undefined; isCoaching?: boolean }) {
  const [now, setNow] = useState(() => new Date())
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const dispute = useDisputeOrderCompletion(orderId)

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_MS)
    return () => clearInterval(id)
  }, [])

  const since = awaitingCustomerSince(history)
  const timeLeft = since ? formatTimeLeft(autoCompleteAt(since), now) : null
  const trimmed = reason.trim()

  return (
    <div className="rounded-xl border border-border-subtle bg-bg-raised px-4 py-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-start gap-2 text-sm text-ink-secondary">
        <Clock className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          {isCoaching
            ? 'Confirme a conclusão quando as sessões de coaching terminarem. O coaching não é concluído automaticamente.'
            : timeLeft
            ? `Se você não responder, o pedido é concluído automaticamente em ${timeLeft}.`
            : 'Se você não responder, o pedido é concluído automaticamente em instantes.'}
          {' '}Algo não saiu como combinado? Conteste a entrega.
        </span>
      </div>
      <Button variant="secondary" size="sm" leftIcon={<AlertTriangle className="h-4 w-4" />} onClick={() => setOpen(true)}>
        Contestar entrega
      </Button>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Contestar entrega"
        description="A conclusão automática é suspensa e nossa equipe analisa o pedido. Conte o que aconteceu."
      >
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Descreva o problema…"
          className="input-base w-full min-h-[100px] resize-none text-sm"
          maxLength={MAX_REASON}
          aria-label="Motivo da contestação"
        />
        {dispute.isError && <ErrorAlert message={dispute.error instanceof Error ? dispute.error.message : 'Erro ao contestar'} />}
        <ActionBar>
          <Button variant="secondary" disabled={dispute.isPending} onClick={() => setOpen(false)}>Voltar</Button>
          <Button
            variant="danger"
            loading={dispute.isPending}
            disabled={trimmed.length < MIN_REASON}
            onClick={() => dispute.mutate(trimmed, { onSuccess: () => { setOpen(false); setReason('') } })}
          >
            Contestar
          </Button>
        </ActionBar>
      </Modal>
    </div>
  )
}
