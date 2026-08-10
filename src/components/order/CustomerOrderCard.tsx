import { Link } from 'react-router-dom'
import { Card, OrderStatusBadge } from '@/components/ui'
import { formatDate, getOrderServiceName, timeAgo } from '@/lib/utils'
import { OrderCardDetails } from '@/components/order/OrderCardDetails'
import type { Order } from '@/types'

interface CustomerOrderCardProps {
  order: Order
  currency: (amount: number) => string
  /** Prefixo de rota pro link do card -- cliente usa /orders (padrão), admin reaproveita com /admin/orders. */
  basePath?: string
}

// Padrão visual de referência pro card-resumo de pedido, reaproveitado por
// TODOS os papéis (cliente, booster, admin) via OrderCardDetails -- ver
// CompletedOrderCard (booster) e a lista de pedidos do admin (via basePath).
export function CustomerOrderCard({ order, currency, basePath = '/orders' }: CustomerOrderCardProps) {
  return (
    <Link to={`${basePath}/${order.id}`}>
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
            <p className="text-sm font-bold text-ink">{currency(order.total_price)}</p>
            <p className="text-[10px] text-ink-muted">Total pago</p>
          </div>
          <p className="text-xs text-ink-muted">Criado {timeAgo(order.created_at)}</p>
        </div>

        {order.completed_at && (
          <p className="text-[10px] text-ink-muted mt-2">Concluído em {formatDate(order.completed_at)}</p>
        )}
      </Card>
    </Link>
  )
}
