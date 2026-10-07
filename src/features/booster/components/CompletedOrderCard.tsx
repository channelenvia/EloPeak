import { OrderCardHeader } from '@/components/order/OrderCardHeader'
import { Link } from 'react-router-dom'
import { Card, OrderStatusBadge } from '@/components/ui'
import { getOrderServiceName, boosterEarningsShare } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import { useBoosterServiceDetails } from '@/api/coaching'
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
  // Mesmo título do pacote mostrado na aba "Pegar" -- pra um pedido de
  // coaching não virar só "Coaching" genérico na lista.
  const { data: coachPackage } = useBoosterServiceDetails(
    order.service_type === 'coaching' ? (order.booster_service_id ?? undefined) : undefined,
  )

  return (
    <Link to={`/booster/orders/${order.id}`}>
      <Card variant="interactive" className="flex h-full min-h-[300px] flex-col gap-4">
        <OrderCardHeader order={order} title={coachPackage?.title ?? getOrderServiceName(order)} trailing={<OrderStatusBadge order={order} viewerRole="booster" align="right" />} />

        <div className="flex-1">
          <OrderCardDetails order={order} viewerRole="booster" />
        </div>

        <OrderCardFooter
          order={order}
          value={order.total_price * boosterEarningsShare(isTop3, order.service_type)}
          valueLabel="Seu valor"
          currency={currency}
          valueTone="success"
        />
      </Card>
    </Link>
  )
}
