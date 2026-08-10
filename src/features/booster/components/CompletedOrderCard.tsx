import { Link } from 'react-router-dom'
import { Clock } from 'lucide-react'
import { Card, OrderStatusBadge } from '@/components/ui'
import { formatDate, getOrderServiceName, formatEstimatedDelivery, boosterEarningsShare } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import { OrderCardDetails } from '@/components/order/OrderCardDetails'
import type { Order } from '@/types'

interface CompletedOrderCardProps {
  order: Order
  isTop3?: boolean | null
}

// Shared card used by the "Pedidos" page and the Dashboard's monthly-services
// list. Mesmo padrão visual do CustomerOrderCard (via OrderCardDetails) --
// só o rodapé difere: valor do booster + prazo estimado no lugar de total
// pago + data de criação.
export function CompletedOrderCard({ order, isTop3 }: CompletedOrderCardProps) {
  const currency = useCurrency()

  return (
    <Link to={`/booster/jobs/${order.id}`}>
      <Card className="h-full hover:border-brand/20 hover:shadow-card-hover transition-all cursor-pointer">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <p className="text-xs font-mono text-ink-muted">#{order.id.slice(0, 8).toUpperCase()}</p>
            <p className="text-sm font-semibold text-ink truncate">{getOrderServiceName(order)}</p>
          </div>
          <OrderStatusBadge status={order.status} />
        </div>

        <OrderCardDetails order={order} />

        <div className="flex items-center justify-between pt-3 border-t border-bg-elevated">
          <div>
            <p className="text-sm font-bold text-success">{currency(order.total_price * boosterEarningsShare(isTop3))}</p>
            <p className="text-[10px] text-ink-muted">Seu valor</p>
          </div>
          {order.estimated_hours != null && (
            <div className="flex items-center gap-1.5 text-xs text-ink-muted">
              <Clock className="h-3.5 w-3.5" />
              {formatEstimatedDelivery(order.estimated_hours)} estimadas
            </div>
          )}
        </div>

        {order.completed_at && (
          <p className="text-[10px] text-ink-muted mt-2">Concluído em {formatDate(order.completed_at)}</p>
        )}
      </Card>
    </Link>
  )
}
