import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Undo2 } from 'lucide-react'
import { ActionBar } from '@/components/ui/ActionBar'
import { Button, Card, ErrorAlert, Modal } from '@/components/ui'
import { formatDateTime } from '@/lib/utils'
import type { Refund } from '@/types'
import { useCurrency } from '@/hooks/useCurrency'
import { useAdminCancelManualRefund, useAdminConfirmManualRefund } from '@/api/orders'
import { refundStatusLabel, refundStatusTone } from './refundUtils'

function ConfirmRefundModal({ refund, open, onClose }: { refund: Refund; open: boolean; onClose: () => void }) {
  const currency = useCurrency()
  const confirm = useAdminConfirmManualRefund()

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) onClose() }}
      title="Confirmar reembolso feito?"
      description={`Confirme só depois de devolver ${currency(refund.amount)} ao cliente (PIX manual ou estorno do cartão no painel do Mercado Pago). O pedido passa para Reembolsado e o cliente é avisado.`}
      maxWidth="sm"
    >
      {confirm.isError && <ErrorAlert message={confirm.error instanceof Error ? confirm.error.message : 'Erro'} />}
      <ActionBar>
        <Button variant="secondary" disabled={confirm.isPending} onClick={onClose}>Voltar</Button>
        <Button
          loading={confirm.isPending}
          leftIcon={<Check className="h-4 w-4" />}
          onClick={() => confirm.mutate(refund.id, { onSuccess: onClose })}
        >
          Confirmar reembolso
        </Button>
      </ActionBar>
    </Modal>
  )
}

export function RefundCard({ refund: r }: { refund: Refund }) {
  const currency = useCurrency()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const undo = useAdminCancelManualRefund()
  const isAwaitingRefund = r.is_manual && r.status === 'pending'
  const statusTone = refundStatusTone(r.status)

  return (
    <Card variant="operational" padding="md" className="h-full flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <Link to={`/admin/orders/${r.order_id}`} className="font-mono text-xs font-bold text-brand hover:underline">
          #{r.order_id.slice(0, 8).toUpperCase()}
        </Link>
        <span className={`badge capitalize ${statusTone}`}>{refundStatusLabel(r)}</span>
      </div>
      <p className="text-lg font-black text-ink" data-tabular>{currency(r.amount)}</p>
      <p className="text-xs text-ink-secondary line-clamp-2">{r.reason}</p>
      <div className="flex items-center justify-between text-xs text-ink-muted mt-auto pt-1">
        {r.is_manual ? (
          <span className="badge text-2xs font-bold bg-bg-raised text-ink-secondary">Manual</span>
        ) : (
          <span className="font-mono">{r.mp_refund_id?.slice(-10) ?? '—'}</span>
        )}
        <span>{formatDateTime(r.created_at)}</span>
      </div>

      {isAwaitingRefund && (
        <div className="flex items-center gap-2 border-t border-border-subtle pt-3">
          <Button size="sm" leftIcon={<Check className="h-3.5 w-3.5" />} onClick={() => setConfirmOpen(true)}>
            Já reembolsei
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={undo.isPending}
            leftIcon={<Undo2 className="h-3.5 w-3.5" />}
            onClick={() => undo.mutate(r.id)}
          >
            Desfazer
          </Button>
        </div>
      )}
      {undo.isError && <ErrorAlert message={undo.error instanceof Error ? undo.error.message : 'Erro'} />}
      {isAwaitingRefund && <ConfirmRefundModal refund={r} open={confirmOpen} onClose={() => setConfirmOpen(false)} />}
    </Card>
  )
}
