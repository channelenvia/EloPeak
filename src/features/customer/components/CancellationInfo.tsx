import { useCurrency } from '@/hooks/useCurrency'
import { useOrderSettlementPreview } from '@/api/orders'
import { DISCORD_SUPPORT_URL } from '@/lib/discordSupport'
import type { Order } from '@/types'

const PRE_ACCEPT: Order['status'][] = ['pending_review', 'awaiting_assignment']
const IN_PROGRESS: Order['status'][] = ['assigned', 'in_progress', 'paused', 'awaiting_customer']

// RN-03/04/05: depois de pago o cancelamento passa pela equipe (nunca por botao do cliente) e o valor devolvido e
// calculado pelo servidor; aqui o cliente ve a mesma estimativa que o admin.
export function CancellationInfo({ order }: { order: Order }) {
  const currency = useCurrency()
  const inProgress = IN_PROGRESS.includes(order.status) && !!order.assigned_booster_id
  const preAccept = PRE_ACCEPT.includes(order.status)
  const { data: preview } = useOrderSettlementPreview(inProgress || preAccept ? order.id : undefined)

  if (!inProgress && !preAccept) return null

  return (
    <div className="rounded-xl border border-border-subtle px-4 py-3 text-sm text-ink-secondary space-y-1" data-testid="cancellation-info">
      <p className="font-semibold text-ink">Precisa cancelar?</p>
      {preAccept ? (
        <p>
          Antes de um booster aceitar, abra um ticket no Discord e nossa equipe devolve o valor pago.
          {DISCORD_SUPPORT_URL && (
            <> <a href={DISCORD_SUPPORT_URL} target="_blank" rel="noopener noreferrer" className="text-primary underline">Abrir ticket no Discord</a></>
          )}
        </p>
      ) : (
        <p>Com o pedido em andamento, solicite pelo chat do pedido. A equipe analisa e o booster recebe pelo progresso entregue.</p>
      )}
      {preview && (
        <p className="text-xs text-ink-muted">
          Estimativa hoje: progresso {preview.progress_pct}% · reembolso de {currency(preview.refund_amount)} (valor pago: {currency(preview.paid)}).
        </p>
      )}
    </div>
  )
}
