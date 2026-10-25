import { CalendarDays, Clock, Gamepad2, Hash, Route, Shuffle, UserCheck, Users, Wallet } from 'lucide-react'
import type { OrderInfoGridItem } from '@/components/order/OrderInfoGrid'
import { getOrderDetailInfo } from '@/components/order/orderDetailInfo'
import { ServiceTagPills } from '@/components/service/ServiceTagPills'
import { CLASH_DAY_LABEL, getClashDateParts } from '@/lib/clashDomain'
import { getLaneDisplayItems } from '@/lib/lolTaxonomy'
import { formatEstimatedDelivery, getOrderServiceName } from '@/lib/utils'
import type { Order } from '@/types'
import { AssignedBoosterValue } from './AssignedBoosterValue'

type DetailInfo = ReturnType<typeof getOrderDetailInfo>

function getModeAndQueueItems(order: Order, info: DetailInfo): OrderInfoGridItem[] {
  const { isBoostFlow, isClash, modeLabel } = info
  const modeItem: OrderInfoGridItem[] = isBoostFlow || isClash ? [{ icon: Shuffle, label: 'Modo do pedido', value: modeLabel }] : []
  if (isBoostFlow) {
    return [...modeItem, { icon: Users, label: 'Fila', value: order.queue_type === 'solo_duo' ? 'Solo/Duo' : 'Flex' }]
  }
  if (isClash && order.clash_day) {
    const { day, month } = getClashDateParts(order.created_at, order.clash_day)
    return [...modeItem, { icon: Users, label: 'Dia', value: `${day}/${month} · ${CLASH_DAY_LABEL[order.clash_day]}` }]
  }
  return modeItem
}

export function buildCustomerInfoItems(
  order: Order,
  info: DetailInfo,
  currency: (value: number) => string,
): OrderInfoGridItem[] {
  const { isBoostFlow, isClash, clashClosingLabel } = info
  return [
    { icon: Gamepad2, label: 'Serviço', value: getOrderServiceName(order) },
    ...getModeAndQueueItems(order, info),
    ...(order.service_type === 'coaching' && order.sessions_purchased != null
      ? [{ icon: CalendarDays, label: 'Sessões', value: `${order.sessions_purchased}` }]
      : []),
    ...((isBoostFlow || isClash) ? [{ icon: Hash, label: 'Riot ID', value: order.riot_id ?? 'Não informado' }] : []),
    ...getLaneDisplayItems(order, 'customer').map((item) => ({ icon: Route, label: item.label, value: <ServiceTagPills lanes={item.lanes} allLabel={item.allLabel} compact emptyFallback="---" /> })),
    { icon: UserCheck, label: 'Booster associado', value: <AssignedBoosterValue order={order} /> },
    { icon: Clock, label: 'Entrega estimada', value: isClash ? clashClosingLabel : (order.estimated_hours ? formatEstimatedDelivery(order.estimated_hours) : 'Não disponível') },
    { icon: Wallet, label: 'Total Pago', value: currency(order.total_price) },
  ]
}
