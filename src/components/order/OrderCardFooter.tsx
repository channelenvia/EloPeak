import { Clock } from 'lucide-react'
import { CountdownTimer } from './CountdownTimer'
import { cn, formatDate, formatEstimatedDelivery, timeAgo } from '@/lib/utils'
import type { Order, OrderStatus } from '@/types'

// Mesmo conjunto de status usado pro CountdownTimer no cabeçalho de detalhe
// do pedido (OrderPageHeader) -- fora daí, mostrar contagem regressiva não
// faz sentido (pedido já terminou ou nem começou).
const ACTIVE_STATUSES: OrderStatus[] = ['in_progress', 'paused', 'awaiting_customer']

interface OrderCardFooterProps {
  order: Order
  value: number
  valueLabel: string
  currency: (amount: number) => string
  valueTone?: 'ink' | 'success'
}

// Rodapé compartilhado pelos cards de pedido de todos os papéis
// (CustomerOrderCard, CompletedOrderCard) -- fonte única pra manter fonte,
// tamanho, cor e posição idênticos entre cliente/booster/admin. Só o valor e
// o rótulo mudam por papel (total pago vs. valor do booster); prazo e data
// seguem exatamente a mesma regra em qualquer card.
export function OrderCardFooter({ order, value, valueLabel, currency, valueTone = 'ink' }: OrderCardFooterProps) {
  return (
    <div className="pt-3 border-t border-border-subtle">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className={cn('text-sm font-bold tabular-figures', valueTone === 'success' ? 'text-success' : 'text-ink')} data-tabular>
            {currency(value)}
          </p>
          <p className="text-[10px] text-ink-muted mt-0.5">{valueLabel}</p>
        </div>

        {/* Prazo estimado -- estático até o booster marcar como iniciado
            (match_sync_started_at), depois vira contagem regressiva real
            (mesmo CountdownTimer do cabeçalho de detalhe do pedido). Só
            enquanto o pedido está de fato em andamento -- concluído/
            cancelado/reembolsado não mostra "prazo excedido, abra um
            ticket" pra algo que já terminou (mesma regra já usada no
            cabeçalho de detalhe do pedido). */}
        {ACTIVE_STATUSES.includes(order.status) && order.match_sync_started_at ? (
          <CountdownTimer startedAt={order.match_sync_started_at} estimatedHours={order.estimated_hours} />
        ) : !order.completed_at && order.estimated_hours != null ? (
          <div className="flex items-center gap-1.5 text-xs text-ink-muted shrink-0">
            <Clock className="h-3.5 w-3.5" />
            {formatEstimatedDelivery(order.estimated_hours)} estimadas
          </div>
        ) : null}
      </div>

      {/* Data dinâmica: concluído mostra quando terminou, o resto mostra
          quando foi pedido. */}
      <p className="text-xs text-ink-muted mt-2">
        {order.completed_at
          ? `Concluído em ${formatDate(order.completed_at)}`
          : `Criado ${timeAgo(order.created_at)}`}
      </p>
    </div>
  )
}
