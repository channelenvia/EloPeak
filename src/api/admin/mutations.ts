import { callRpc } from '@/api/core/rpc'

// O limite de 2 drops não bloqueia mais a 3ª aprovação (apply_order_drop) --
// ela é permitida, só que cancela o pedido pra 'under_review' em vez de
// reabrir pro pool. Não há mais um erro drop_limit_reached a tratar aqui.
export async function resolveDropRequest(params: { requestId: string; approve: boolean; adminNote?: string; coachingCompletionPct?: number }) {
  return callRpc('resolve_drop_request', {
    p_request_id: params.requestId, p_approve: params.approve, p_admin_note: params.adminNote,
    p_coaching_completion_pct: params.coachingCompletionPct ?? null,
  }, {
    order_not_found_or_unassigned: 'Não foi possível calcular o valor do drop -- pedido não encontrado ou sem booster atribuído.',
    missing_rank_data: 'Este pedido está sem rank atual/alvo definido -- não é possível calcular o valor do drop.',
    unauthorized: 'Você não tem permissão para essa ação.',
    request_not_found: 'Solicitação de drop não encontrada.',
    already_resolved: 'Esta solicitação já foi resolvida.',
    order_not_found: 'Pedido não encontrado.',
    // Corrida com admin_flag_order_under_review (ver migration
    // 20260911030000) -- o pedido saiu de drop_requested antes deste resolve.
    order_not_drop_requested: 'O status do pedido mudou -- atualize a página e tente novamente.',
  })
}

export async function adminAdjustBoosterBalance(params: { boosterId: string; amount: number; reason: string }) {
  return callRpc('admin_adjust_booster_balance', {
    p_booster_id: params.boosterId, p_amount: params.amount, p_reason: params.reason,
  }, {
    booster_not_found: 'Booster não encontrado.',
    invalid_amount: 'Informe um valor diferente de zero.',
    invalid_reason: 'O motivo precisa ter pelo menos 10 caracteres.',
  }) as Promise<{ success: boolean; error?: string; new_balance?: number }>
}
