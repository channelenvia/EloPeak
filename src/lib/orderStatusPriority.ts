import type { Order, OrderStatus } from '@/types'

type ViewerRole = 'customer' | 'booster' | 'admin'

// Ordem em que a aba "Todos" lista os pedidos: o que exige atenção/está
// rodando primeiro, histórico por último. Admin ganha pending_review no topo
// (fila de aprovação); cliente e booster começam por "em andamento".
const BASE_PRIORITY: OrderStatus[] = [
  'in_progress', 'paused', 'assigned', 'awaiting_customer', 'drop_requested',
  'awaiting_assignment', 'pending_review', 'paid', 'awaiting_payment',
  'under_review', 'disputed', 'completed', 'refunded', 'canceled', 'draft',
]

const ADMIN_PRIORITY: OrderStatus[] = ['pending_review', ...BASE_PRIORITY.filter((s) => s !== 'pending_review')]

function priorityOf(status: OrderStatus, role: ViewerRole): number {
  return (role === 'admin' ? ADMIN_PRIORITY : BASE_PRIORITY).indexOf(status)
}

// Mais prioritário primeiro; empate = mais recente primeiro.
export function sortOrdersByStatusPriority<T extends Pick<Order, 'status' | 'created_at'>>(orders: T[], role: ViewerRole): T[] {
  return [...orders].sort((a, b) =>
    priorityOf(a.status, role) - priorityOf(b.status, role)
    || new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )
}
