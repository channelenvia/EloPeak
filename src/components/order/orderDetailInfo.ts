import { CLASH_DAY_LABEL, getClashDateParts } from '@/lib/clashDomain'
import { getOrderModeType } from '@/lib/utils'
import type { Order } from '@/types'

export interface OrderDetailInfo {
  isBoostFlow: boolean
  isClash: boolean
  modeLabel: string
  /** "Até 23h de DD/MM (Dia)" quando a Clash tem dia marcado, senão "Não disponível". */
  clashClosingLabel: string
}

// Deriva os campos usados de forma idêntica pelas 3 páginas de detalhe de
// pedido (customer/admin/booster) -- antes cada uma recalculava isso de
// forma independente e byte-a-byte igual.
export function getOrderDetailInfo(order: Order): OrderDetailInfo {
  const isBoostFlow = order.service_type === 'elo_boost' || order.service_type === 'win_boost' || order.service_type === 'md5'
  const isClash = order.service_type === 'clash'
  const modeLabel = getOrderModeType(order)
  const clashClosingLabel = isClash && order.clash_day
    ? (() => {
        const { day, month } = getClashDateParts(order.created_at, order.clash_day!)
        return `Até 23h de ${day}/${month} (${CLASH_DAY_LABEL[order.clash_day!]})`
      })()
    : 'Não disponível'
  return { isBoostFlow, isClash, modeLabel, clashClosingLabel }
}
