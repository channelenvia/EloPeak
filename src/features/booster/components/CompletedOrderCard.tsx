import { Link } from 'react-router-dom'
import { Card, OrderStatusBadge } from '@/components/ui'
import { getOrderServiceName, boosterEarningsShare } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import { OrderCardDetails } from '@/components/order/OrderCardDetails'
import { OrderCardFooter } from '@/components/order/OrderCardFooter'
import type { Order } from '@/types'

interface CompletedOrderCardProps {
  order: Order
  isTop3?: boolean | null
}

// Shared card used by the "Pedidos" page e a fila do Dashboard do booster.
// Mesmo padrão visual do CustomerOrderCard (via OrderCardDetails +
// OrderCardFooter) -- só o valor exibido difere (ganho do booster em vez de
// total pago pelo cliente).
export function CompletedOrderCard({ order, isTop3 }: CompletedOrderCardProps) {
  const currency = useCurrency()

  return (
    <Link to={`/booster/orders/${order.id}`}>
      <Card variant="interactive" className="h-full min-h-[300px] flex flex-col">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-mono text-ink-muted">#{order.id.slice(0, 8).toUpperCase()}</p>
              {order.drop_count > 0 && (
                <span className="text-[9px] font-bold uppercase tracking-wide text-warning bg-warning/10 px-1.5 py-0.5 rounded">Dropado</span>
              )}
            </div>
            <p className="text-sm font-semibold text-ink truncate">{getOrderServiceName(order)}</p>
          </div>
          <OrderStatusBadge order={order} />
        </div>

        <div className="flex-1">
          <OrderCardDetails order={order} />
        </div>

        <OrderCardFooter
          order={order}
          value={order.total_price * boosterEarningsShare(isTop3)}
          valueLabel="Seu valor"
          currency={currency}
          valueTone="success"
        />
      </Card>
    </Link>
  )
}
