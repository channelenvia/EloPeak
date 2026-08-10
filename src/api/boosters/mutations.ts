import { supabase } from '@/lib/supabase'
import { ApiError, assertRpcSuccess, normalizeApiError } from '@/api/core/errors'
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction'
import type { OnboardBoosterParams, UpdateProfessionalProfileParams } from './types'

// Compartilhado entre onboard_booster e update_booster_professional_profile
// -- as duas funções validam essencialmente o mesmo formulário profissional.
const PROFESSIONAL_PROFILE_MESSAGES: Record<string, string> = {
  not_a_booster: 'Não foi possível identificar sua candidatura de booster.',
  display_name_required: 'Nome de exibição é obrigatório.',
  display_name_taken: 'Este nome de exibição já está em uso por outro booster.',
  bio_required: 'Conte um pouco sobre você.',
  invalid_peak_rank: 'Selecione seu rank de pico (Grão-mestre ou Desafiante).',
  invalid_opgg_link: 'Link do OP.GG inválido.',
  invalid_hours: 'Informe uma faixa de horas válida (1 a 24, com o mínimo menor ou igual ao máximo).',
  full_name_required: 'Nome completo é obrigatório.',
  invalid_cpf: 'CPF inválido.',
  available_days_required: 'Selecione ao menos um dia disponível.',
}

export async function boosterHeartbeat(): Promise<void> {
  // Fire-and-forget por design -- uma falha ocasional de heartbeat não deve
  // incomodar o booster com um toast de erro.
  await supabase.rpc('booster_heartbeat')
}

export async function requestBoosterRole() {
  const { data, error } = await supabase.rpc('request_booster_role')
  if (error) throw normalizeApiError(error)
  return data as { success?: boolean } | null
}

export async function onboardBooster(params: OnboardBoosterParams) {
  const args = {
    p_display_name: params.displayName,
    p_bio: params.bio,
    p_peak_rank: params.peakRank,
    p_opgg_link: params.opggLink,
    p_hours_per_day_min: params.hoursPerDayMin,
    p_hours_per_day_max: params.hoursPerDayMax,
    p_full_name: params.fullName,
    p_cpf: params.cpf,
    p_available_days: params.availableDays,
  }
  const { data, error } = await supabase.rpc('onboard_booster', args as never)
  if (error) throw normalizeApiError(error)
  return assertRpcSuccess(data as { success: boolean; error?: string }, PROFESSIONAL_PROFILE_MESSAGES)
}

export async function updateProfessionalProfile(params: UpdateProfessionalProfileParams) {
  const { data, error } = await supabase.rpc('update_booster_professional_profile', {
    p_display_name: params.displayName,
    p_bio: params.bio,
    p_peak_tier: params.peakTier,
    p_opgg_link: params.opggLink,
    p_available_days: params.availableDays,
    p_hours_per_day_min: params.hoursPerDayMin,
    p_hours_per_day_max: params.hoursPerDayMax,
  })
  if (error) throw normalizeApiError(error)
  const result = data as { success: boolean; error?: string; days_remaining?: number }
  if (result.success === false && result.error === 'display_name_cooldown') {
    const days = result.days_remaining ?? 30
    throw new ApiError(`Troca de nome disponível somente em ${days} dia${days === 1 ? '' : 's'}.`, { code: result.error })
  }
  return assertRpcSuccess(result, PROFESSIONAL_PROFILE_MESSAGES)
}

export async function adminApproveBooster(params: { boosterId: string; newStatus: 'approved' | 'rejected' | 'suspended' }) {
  const { data, error } = await supabase.rpc('approve_booster', { p_booster_id: params.boosterId, p_new_status: params.newStatus })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccess(data as { success: boolean; error?: string })
}

export async function expelBooster(params: { boosterId: string; reason: string }) {
  return invokeEdgeFunction<{ success: true }>('expel-booster', {
    body: { booster_id: params.boosterId, reason: params.reason },
    requireAuth: true,
  })
}

export async function setBoosterAdminNote(params: { boosterId: string; note: string }) {
  const { data, error } = await supabase.rpc('set_booster_admin_note', { p_booster_id: params.boosterId, p_note: params.note })
  if (error) throw normalizeApiError(error)
  return assertRpcSuccess(data as { success: boolean; error?: string })
}
