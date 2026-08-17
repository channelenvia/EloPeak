import { Link } from 'react-router-dom'
import { Card, OrderStatusBadge } from '@/components/ui'
import { getOrderServiceName } from '@/lib/utils'
import { OrderCardDetails } from '@/components/order/OrderCardDetails'
import { OrderCardFooter } from '@/components/order/OrderCardFooter'
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
// min-h fixo: mantém a altura igual entre cards com e sem addons/extras, em
// vez de cada linha do grid ficar com altura diferente conforme o conteúdo.
export function CustomerOrderCard({ order, currency, basePath = '/orders' }: CustomerOrderCardProps) {
  return (
    <Link to={`${basePath}/${order.id}`}>
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

        <OrderCardFooter order={order} value={order.total_price} valueLabel="Total pago" currency={currency} />
      </Card>
    </Link>
  )
}
