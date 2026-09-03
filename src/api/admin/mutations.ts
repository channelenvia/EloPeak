import { supabase } from '@/lib/supabase'
import { assertRpcSuccess, normalizeApiError } from '@/api/core/errors'

// O limite de 2 drops não bloqueia mais a 3ª aprovação (apply_order_drop) --
// ela é permitida, só que cancela o pedido pra 'under_review' em vez de
// reabrir pro pool. Não há mais um erro drop_limit_reached a tratar aqui.
export async function resolveDropRequest(params: { requestId: string; approve: boolean; adminNote?: string }) {
  const { data, error } = await supabase.rpc('resolve_drop_request', {
    p_request_id: params.requestId, p_approve: params.approve, p_admin_note: params.adminNote,
  })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccess(data as { success: boolean; error?: string }, {
    order_not_found_or_unassigned: 'Não foi possível calcular o valor do drop -- pedido não encontrado ou sem booster atribuído.',
    missing_rank_data: 'Este pedido está sem rank atual/alvo definido -- não é possível calcular o valor do drop.',
  })
}

export async function adminAdjustBoosterBalance(params: { boosterId: string; amount: number; reason: string }) {
  const { data, error } = await supabase.rpc('admin_adjust_booster_balance', {
    p_booster_id: params.boosterId, p_amount: params.amount, p_reason: params.reason,
  })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccess(data as { success: boolean; error?: string; new_balance?: number }, {
    booster_not_found: 'Booster não encontrado.',
    invalid_amount: 'Informe um valor diferente de zero.',
    invalid_reason: 'O motivo precisa ter pelo menos 10 caracteres.',
  })
}
