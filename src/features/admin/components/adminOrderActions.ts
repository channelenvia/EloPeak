import type { OrderStatus } from '@/types'

// Mesmo conjunto de status aceitos por admin_drop_order (migration 071) —
// 'drop_requested' fica de fora porque já tem sua própria fila em /admin/drops.
export const DROPPABLE_STATUSES: OrderStatus[] = ['assigned', 'in_progress', 'paused', 'awaiting_customer']

// Mesmo conjunto de DROPPABLE_STATUSES + 'awaiting_assignment' -- pedido no
// pool (sem assigned_booster_id) também precisa poder receber um booster
// direto do menu do admin, não só pedidos que já têm um booster ativo pra
// trocar (ver migration 20260902160000_admin_assign_booster_from_awaiting_
// assignment). Ação de drop continua restrita a DROPPABLE_STATUSES -- não
// tem o que "dropar" num pedido que ainda não foi atribuído.
export const ASSIGN_BOOSTER_STATUSES: OrderStatus[] = [...DROPPABLE_STATUSES, 'awaiting_assignment']

// Mesmo allowlist de admin_flag_order_under_review (migration 20260911020000)
// -- inclui 'drop_requested' (drop pendente também pode ser travado em
// análise), diferente de DROPPABLE_STATUSES que o exclui de propósito.
export const REVIEWABLE_WITH_BOOSTER_STATUSES: OrderStatus[] = [...DROPPABLE_STATUSES, 'drop_requested', 'awaiting_assignment']

// Só 3 ações manuais: concluir/cancelar (admin_override_order_status, sem
// efeito colateral) e reembolsar -- que é um link pro formulário de
// reembolso manual (AdminRefundsPage/admin_create_manual_refund), não um
// flip direto pra status='refunded' (isso deixava o pedido "reembolsado"
// sem processar nada no Mercado Pago nem no saldo do booster).
export const STATUS_ACTION_TONE_CLASS: Record<string, string> = {
  success: 'text-success hover:bg-success/10',
  neutral: 'text-ink-secondary hover:bg-bg-raised',
  danger:  'text-danger hover:bg-danger/10',
}

// Mesmo padrão do menu de ações dos boosters (ver BoosterActionsMenu em
// Boosters.tsx): botão "Ações" + Popover ancorado com a lista, em vez de um
// modal central. "Atribuir/Reatribuir booster" aparece em ASSIGN_BOOSTER_
// STATUSES (booster ativo OU 'awaiting_assignment') -- ver comentário de
// AdminReassignModal.
// Concluir/cancelar usam admin_override_order_status (sem efeito colateral);
// reembolsar é um link pro formulário de reembolso manual
// (AdminRefundsPage/admin_create_manual_refund), não um flip direto pra
// status='refunded' (isso deixava o pedido "reembolsado" sem processar nada
// no Mercado Pago nem no saldo do booster).
export const CONFIRM_STATUS_ACTION_COPY: Record<'completed' | 'canceled', { title: string; description: string; reason: string; confirmLabel: string; variant: 'success' | 'danger' }> = {
  completed: {
    title: 'Marcar pedido como concluído',
    description: 'O pedido será marcado como concluído manualmente pelo admin, fora do fluxo normal de verificação.',
    reason: 'Concluído manualmente pelo admin',
    confirmLabel: 'Marcar como concluído',
    variant: 'success',
  },
  canceled: {
    title: 'Cancelar pedido',
    description: 'O pedido será cancelado manualmente pelo admin. Reembolso, se necessário, precisa ser feito à parte.',
    reason: 'Cancelado manualmente pelo admin',
    confirmLabel: 'Cancelar pedido',
    variant: 'danger',
  },
}
