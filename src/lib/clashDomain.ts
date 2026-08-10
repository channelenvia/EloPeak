// src/lib/clashDomain.ts
// Re-export do domínio do serviço Clash — mantém o alias `@/lib/clashDomain`
// pro frontend, espelhando o padrão de `@/lib/boostDomain` (re-export de
// shared/boostDomain.ts).
export * from '../../shared/clashDomain'

import type { ClashDay } from '@/types'

// Próxima ocorrência do dia da semana escolhido, a partir de uma data de
// referência (created_at do pedido, ou "agora" na revisão pré-pagamento,
// quando o pedido ainda nem existe). UI-only (não faz sentido no backend
// compartilhado) -- usado por ClashDetailsBlock, OrderRow e
// CustomerOrderCard pra não triplicar o cálculo.
export function getClashDateParts(referenceDate: string, clashDay: ClashDay) {
  const date = new Date(referenceDate)
  const targetDay = clashDay === 'saturday' ? 6 : 0
  const currentDay = date.getDay()
  const daysUntil = (targetDay - currentDay + 7) % 7
  date.setDate(date.getDate() + daysUntil)
  return { day: String(date.getDate()).padStart(2, '0'), month: String(date.getMonth() + 1).padStart(2, '0') }
}
