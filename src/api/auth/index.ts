import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ApiError, normalizeApiError, assertRpcSuccess } from '@/api/core/errors'

export interface BoosterPanelFields {
  display_name: string | null
  display_name_changed_at: string | null
  full_name: string | null
  cpf: string | null
}

export async function getBoosterPanelFields(userId: string): Promise<BoosterPanelFields | null> {
  const { data, error } = await supabase
    .from('booster_profiles')
    .select('display_name, display_name_changed_at, full_name, cpf')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw normalizeApiError(error)
  return data
}

export async function updateMyAvatar(params: { userId: string; avatarUrl: string }) {
  const { error } = await supabase.from('profiles').update({ avatar_url: params.avatarUrl }).eq('id', params.userId)
  if (error) throw normalizeApiError(error, 'Não foi possível atualizar o avatar.')
}

// Espelha o mesmo padrão de update_booster_professional_profile (migration
// 151/159) -- passa pelo RPC em vez de um UPDATE direto pra sempre devolver
// {success:false, error:'display_name_cooldown', days_remaining:N} em vez de
// deixar a troca bater direto no trigger trg_fn_enforce_booster_display_name_cooldown
// (que levanta uma exceção Postgres crua, sem days_remaining estruturado).
export async function updateBoosterDisplayName(params: { userId: string; displayName: string }) {
  const { data, error } = await supabase.rpc('update_my_display_name', { p_display_name: params.displayName })
  if (error) throw normalizeApiError(error, 'Não foi possível atualizar o nome de exibição.')
  const result = data as { success: boolean; error?: string; days_remaining?: number }
  if (result.success === false && result.error === 'display_name_cooldown') {
    const days = result.days_remaining ?? 30
    throw new ApiError(`Você só pode trocar em ${days} dia${days === 1 ? '' : 's'}.`, { code: result.error })
  }
  assertRpcSuccess(result, {
    not_a_booster: 'Não foi possível identificar sua conta de booster.',
    display_name_required: 'Nome de exibição é obrigatório.',
    display_name_taken: 'Este nome de exibição já está em uso por outro booster.',
  })
}

export async function updateBoosterFullName(params: { userId: string; fullName: string | null }) {
  const { error } = await supabase.from('booster_profiles').update({ full_name: params.fullName }).eq('user_id', params.userId)
  if (error) throw normalizeApiError(error, 'Não foi possível atualizar o nome completo.')
}

export async function updateBoosterCpf(params: { userId: string; cpf: string }) {
  const { error } = await supabase.from('booster_profiles').update({ cpf: params.cpf }).eq('user_id', params.userId)
  if (error) throw normalizeApiError(error, 'Não foi possível atualizar o CPF.')
}

export function useBoosterPanelFields(userId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['auth', 'booster-panel-fields', userId ?? ''],
    queryFn: () => getBoosterPanelFields(userId!),
    enabled: !!userId && enabled,
  })
}

export function useUpdateMyAvatar() {
  return useMutation({ mutationFn: updateMyAvatar })
}

export function useBoosterPanelMutations(userId: string | undefined) {
  const queryClient = useQueryClient()
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['auth', 'booster-panel-fields', userId ?? ''] })
  return {
    updateDisplayName: useMutation({ mutationFn: updateBoosterDisplayName, onSuccess: invalidate }),
    updateFullName: useMutation({ mutationFn: updateBoosterFullName, onSuccess: invalidate }),
    updateCpf: useMutation({ mutationFn: updateBoosterCpf, onSuccess: invalidate }),
  }
}
