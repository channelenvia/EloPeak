import { supabase } from '@/lib/supabase'
import { assertRpcSuccess, normalizeApiError } from '@/api/core/errors'
import type { SaveDuoAccountParams } from './types'

const RESERVE_MESSAGES: Record<string, string> = {
  account_unavailable: 'Esta conta acabou de ser reservada por outro booster.',
  cannot_switch_after_matches_played: 'Não é possível trocar de conta após partidas contabilizadas.',
}

export async function reserveDuoAccount(params: { orderId: string; accountId: string }) {
  const { data, error } = await supabase.rpc('reserve_duo_account', {
    p_order_id: params.orderId, p_account_id: params.accountId,
  })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccess(data as { success: boolean; error?: string }, RESERVE_MESSAGES)
}

export async function releaseDuoAccountReservation(orderId: string) {
  const { data, error } = await supabase.rpc('release_duo_account_reservation', { p_order_id: orderId })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccess(data as { success: boolean; error?: string })
}

export async function getDuoAccountAccessToken(accountId: string) {
  const { data, error } = await supabase.rpc('get_duo_account_access_token', { p_account_id: accountId })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccess(data as { success: boolean; error?: string; access_token?: string })
}

const OWN_ACCOUNT_MESSAGES: Record<string, string> = {
  forbidden: 'Você não é o booster deste pedido.',
  not_duo_order: 'Este pedido não é Duo Boost.',
  invalid_status: 'Pedido não está em um status que aceite troca de conta.',
  invalid_riot_id: 'Riot ID inválido — use o formato Nome#TAG.',
  order_not_found: 'Pedido não encontrado.',
}

export async function setDuoOwnRiotId(params: { orderId: string; riotId: string }) {
  const { data, error } = await supabase.rpc('set_duo_own_riot_id', {
    p_order_id: params.orderId, p_riot_id: params.riotId,
  })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccess(data as { success: boolean; error?: string }, OWN_ACCOUNT_MESSAGES)
}

export async function clearDuoOwnRiotId(orderId: string) {
  const { data, error } = await supabase.rpc('clear_duo_own_riot_id', { p_order_id: orderId })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccess(data as { success: boolean; error?: string }, OWN_ACCOUNT_MESSAGES)
}

export async function updateDuoAccountRank(params: { accountId: string; tier: string; division: string | null }) {
  const { data, error } = await supabase.rpc('update_duo_account_rank', {
    p_account_id: params.accountId, p_tier: params.tier, p_division: (params.division ?? '') as never,
  })
  if (error) throw normalizeApiError(error)
  return data as { success?: boolean; error?: string }
}

const DUO_ACCOUNT_MESSAGES: Record<string, string> = {
  unauthorized: 'Somente administradores podem gerenciar contas Duo.',
  invalid_label: 'Riot ID inválido para identificar a conta.',
  invalid_riot_id: 'Riot ID muito longo.',
  rank_out_of_supported_range: 'Contas Duo devem estar entre Ferro IV e Diamante I.',
  login_and_password_required_together: 'Preencha login e senha juntos.',
  credentials_required: 'Uma conta ativa precisa ter login e senha cadastrados.',
  invalid_credentials: 'Login ou senha inválidos.',
  account_not_found: 'Conta Duo não encontrada.',
  account_reserved: 'Libere a reserva desta conta antes de excluí-la.',
  server_key_not_configured: 'A chave de criptografia do servidor não está configurada.',
}

export async function adminSaveDuoAccount(params: SaveDuoAccountParams) {
  const { data, error } = await supabase.rpc('save_duo_account', {
    p_account_id: params.accountId as never,
    p_riot_id: params.riotId as never,
    p_label: params.label,
    p_tier: params.tier,
    p_division: params.division as never,
    p_notes: params.notes as never,
    p_is_active: params.isActive,
    p_login: params.login as never,
    p_password: params.password as never,
  })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccess(data as { success?: boolean; error?: string }, DUO_ACCOUNT_MESSAGES)
}

export async function adminSetDuoAccountActive(params: { accountId: string; isActive: boolean }) {
  const { data, error } = await supabase.rpc('set_duo_account_active', {
    p_account_id: params.accountId, p_is_active: params.isActive,
  })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccess(data as { success?: boolean; error?: string }, DUO_ACCOUNT_MESSAGES)
}

export async function adminReleaseDuoAccount(accountId: string) {
  const { data, error } = await supabase.rpc('admin_release_duo_account', { p_account_id: accountId })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccess(data as { success?: boolean; error?: string }, DUO_ACCOUNT_MESSAGES)
}

export async function adminDeleteDuoAccount(accountId: string) {
  const { data, error } = await supabase.rpc('delete_duo_account', { p_account_id: accountId })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccess(data as { success?: boolean; error?: string }, DUO_ACCOUNT_MESSAGES)
}

export async function adminGetDuoAccountCredentials(accountId: string) {
  const { data, error } = await supabase.rpc('get_duo_account_credentials', { p_account_id: accountId })
  if (error) throw normalizeApiError(error)
  return data as { success: boolean; login?: string; password?: string }
}
