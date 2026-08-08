import { supabase } from '@/lib/supabase'
import { assertRpcSuccess, normalizeApiError } from '@/api/core/errors'

export async function resolveDropRequest(params: { requestId: string; approve: boolean; adminNote?: string }) {
  const { data, error } = await supabase.rpc('resolve_drop_request', {
    p_request_id: params.requestId, p_approve: params.approve, p_admin_note: params.adminNote,
  })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccess(data as { success: boolean; error?: string }, {
    drop_limit_reached: 'Este pedido já atingiu o limite de 2 drops aprovados.',
  })
}

export async function waiveDropPenalty(params: { requestId: string; adminNote?: string }) {
  const { data, error } = await supabase.rpc('waive_drop_penalty', {
    p_request_id: params.requestId, p_admin_note: params.adminNote,
  })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccess(data as { success: boolean; error?: string })
}

export async function adminResolveOrderSupport(escalationId: string) {
  const { data, error } = await supabase.rpc('admin_resolve_order_support', { p_escalation_id: escalationId })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccess(data as { success: boolean; error?: string })
}
