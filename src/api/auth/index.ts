import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ApiError, normalizeApiError, assertRpcSuccess } from '@/api/core/errors'
import type { Profile } from '@/types'

// Releitura do proprio perfil (ex.: role mudou no banco depois da aprovacao do booster).
export async function getOwnProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
  if (error) throw normalizeApiError(error)
  return data
}

export interface BoosterPanelFields {
  display_name: string | null
  display_name_changed_at: string | null
  full_name: string | null
  cpf: string | null
}

export async function getBoosterPanelFields(userId: string): Promise<BoosterPanelFields | null> {
  const { data, error } = await supabase
    .from('booster_profiles')
    .select('display_name, display_name_changed_at, full_name')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw normalizeApiError(error)
  if (!data) return null
  // CPF fica cifrado no banco; só o dono lê (get_my_cpf).
  const { data: cpf, error: cpfError } = await supabase.rpc('get_my_cpf')
  if (cpfError) throw normalizeApiError(cpfError)
  return { ...data, cpf: cpf ?? null }
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
    display_name_invalid: 'Use até 32 caracteres: letras, números, espaço, ponto, hífen ou sublinhado.',
  })
}

export async function updateBoosterFullName(params: { fullName: string | null }) {
  const { data, error } = await supabase.rpc('update_my_full_name', { p_full_name: params.fullName ?? '' })
  if (error) throw normalizeApiError(error, 'Não foi possível atualizar o nome completo.')
  assertRpcSuccess(data as { success: boolean; error?: string }, {
    full_name_required: 'Informe o nome completo.',
    not_a_booster: 'Não foi possível identificar sua conta de booster.',
    rate_limited: 'Muitas tentativas. Aguarde um minuto.',
  })
}

export async function updateBoosterCpf(params: { cpf: string }) {
  const { data, error } = await supabase.rpc('update_my_cpf', { p_cpf: params.cpf })
  // Indice unico de CPF: a violacao vem como 23505 (M-27), nao como {success:false}.
  if (error?.code === '23505') {
    throw new ApiError('Este CPF já está cadastrado em outra conta.', { code: 'cpf_taken', cause: error })
  }
  if (error) throw normalizeApiError(error, 'Não foi possível atualizar o CPF.')
  assertRpcSuccess(data as { success: boolean; error?: string }, {
    invalid_cpf: 'CPF inválido.',
    not_a_booster: 'Não foi possível identificar sua conta de booster.',
    rate_limited: 'Muitas tentativas. Aguarde um minuto.',
  })
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
