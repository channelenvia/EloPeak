import { supabase } from '@/lib/supabase'
import { normalizeApiError } from '@/api/core/errors'
import type { BoosterAdminNote, BoosterProfile } from '@/types'
import type { BoosterAccessState, BoosterPerformanceSegment, ProfessionalProfileData, TopBoosterEntry } from './types'

export interface BoosterAccessResult {
  state: BoosterAccessState
  suspendedUntil: string | null
}

export async function getBoosterAccessState(userId: string): Promise<BoosterAccessResult> {
  const { data, error } = await supabase
    .from('booster_profiles')
    .select('status, display_name, suspended_until')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return { state: 'error', suspendedUntil: null }
  if (!data) return { state: 'no_application', suspendedUntil: null }
  if (data.status === 'approved') return { state: 'approved', suspendedUntil: null }
  if (data.status === 'rejected') return { state: 'rejected', suspendedUntil: null }
  if (data.status === 'suspended') return { state: 'suspended', suspendedUntil: data.suspended_until }
  if (data.status === 'removed') return { state: 'removed', suspendedUntil: null }
  return { state: 'pending', suspendedUntil: null } // pending | under_review tratados como "aguardando" na UI
}

export async function getOwnProfessionalProfile(userId: string): Promise<ProfessionalProfileData | null> {
  const { data, error } = await supabase
    .from('booster_profiles')
    .select('display_name, display_name_changed_at, bio, peak_rank, opgg_link, opgg_link_visible, available_days, hours_per_day_min, hours_per_day_max')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw normalizeApiError(error)
  return data as unknown as ProfessionalProfileData | null
}

export async function getOwnBoosterDisplayName(userId: string): Promise<string | null> {
  const { data, error } = await supabase.from('booster_profiles').select('display_name').eq('user_id', userId).maybeSingle()
  if (error) throw normalizeApiError(error)
  return data?.display_name ?? null
}

// Usado só pra calcular a divisão de ganhos (boosterEarningsShare) na tela de
// job/pedidos do booster -- não precisa do restante do perfil profissional.
export async function getOwnBoosterTop3Status(userId: string): Promise<boolean> {
  const { data, error } = await supabase.from('booster_profiles').select('is_top3').eq('user_id', userId).maybeSingle()
  if (error) throw normalizeApiError(error)
  return data?.is_top3 ?? false
}

export async function listPublicBoosters(): Promise<BoosterProfile[]> {
  const { data, error } = await supabase.from('public_booster_profiles').select('*').limit(100)
  if (error) throw normalizeApiError(error)
  return (data ?? []) as unknown as BoosterProfile[]
}

export async function getPublicBooster(displayName: string): Promise<BoosterProfile | null> {
  const { data, error } = await supabase.from('public_booster_profiles').select('*').eq('display_name', displayName).maybeSingle()
  if (error) throw normalizeApiError(error)
  return data as unknown as BoosterProfile | null
}

// Booster vinculado a um pedido específico (visto pelo cliente) -- versão
// compacta de getPublicBooster, só as colunas usadas em cards/resumo de
// pedido. Antes duplicado como hook local em customer/pages/OrderDetail.tsx.
export type AssignedBoosterProfile = Pick<BoosterProfile, 'id' | 'user_id' | 'display_name' | 'avatar_url' | 'last_active_at' | 'rating' | 'rating_count'>

export async function getAssignedBoosterProfile(boosterUserId: string): Promise<AssignedBoosterProfile | null> {
  const { data, error } = await supabase
    .from('public_booster_profiles')
    .select('id, user_id, display_name, avatar_url, last_active_at, rating, rating_count')
    .eq('user_id', boosterUserId)
    .maybeSingle()
  if (error) throw normalizeApiError(error)
  return data as AssignedBoosterProfile | null
}

export async function listBoostersPerformance(boosterUserIds: string[]): Promise<BoosterPerformanceSegment[]> {
  if (boosterUserIds.length === 0) return []
  const { data, error } = await supabase
    .from('booster_performance_segments')
    .select('booster_id, adjusted_win_rate, wins, total_matches')
    .in('booster_id', boosterUserIds)
    .eq('service_type', '__all__')
    .eq('rank_bucket', '__all__')
    .eq('account_type', '__all__')
  if (error) throw normalizeApiError(error)
  return (data ?? []) as unknown as BoosterPerformanceSegment[]
}

// Inclui a linha rank_bucket='__all__' (agregado do booster em todas as
// faixas) junto com as faixas individuais -- o chamador separa uma da outra
// (rank_bucket === '__all__' vs os buckets reais) pra montar a linha-resumo
// de KDA/winrate/avaliação médios no topo do card de desempenho.
export async function getBoosterPerformanceByRank(boosterUserId: string): Promise<BoosterPerformanceSegment[]> {
  const { data, error } = await supabase
    .from('booster_performance_segments')
    .select('rank_bucket, average_kda, adjusted_win_rate, wins, total_matches, avg_cs_per_min, avg_vision_score, mvp_count, review_count, average_rating')
    .eq('booster_id', boosterUserId)
    .eq('service_type', '__all__')
    .eq('account_type', '__all__')
  if (error) throw normalizeApiError(error)
  return (data ?? []) as unknown as BoosterPerformanceSegment[]
}

export async function getTopBoosters(params: { limit: number; serviceType?: string; rankBucket?: string }): Promise<TopBoosterEntry[]> {
  const { data, error } = await supabase.rpc('get_top_boosters', {
    p_limit: params.limit,
    p_service_type: params.serviceType ?? '__all__',
    p_rank_bucket: params.rankBucket ?? '__all__',
  })
  if (error) throw normalizeApiError(error)
  const result = data as unknown as { success: boolean; boosters?: TopBoosterEntry[] }
  return result.boosters ?? []
}

export async function listAdminBoosters(status?: string): Promise<BoosterProfile[]> {
  let query = supabase.from('booster_profiles').select('*').order('created_at', { ascending: false }).limit(100)
  if (status && status !== 'all') query = query.eq('status', status as never)
  const { data, error } = await query
  if (error) throw normalizeApiError(error)
  return (data ?? []) as unknown as BoosterProfile[]
}

export async function getAdminBoosterDetail(boosterId: string): Promise<BoosterProfile> {
  const { data, error } = await supabase.from('booster_profiles').select('*').eq('id', boosterId).single()
  if (error) throw normalizeApiError(error)
  return data as unknown as BoosterProfile
}

export async function getBoosterBlockedUntil(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('booster_profiles')
    .select('blocked_until')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw normalizeApiError(error)
  return data?.blocked_until ?? null
}

export async function getBoosterActiveDropWarnings(boosterUserId: string): Promise<number> {
  const { count, error } = await supabase
    .from('order_drop_requests')
    .select('id', { count: 'exact', head: true })
    .eq('booster_id', boosterUserId)
    .eq('status', 'approved')
    .eq('warning_issued', true)
    .is('waived_at', null)
    .gt('resolved_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
  if (error) throw normalizeApiError(error)
  return count ?? 0
}

export async function listBoosterAdminNotes(): Promise<Map<string, BoosterAdminNote>> {
  const { data, error } = await supabase.from('booster_admin_notes').select('*')
  if (error) throw normalizeApiError(error)
  return new Map((data ?? []).map((n) => [n.booster_id, n as unknown as BoosterAdminNote]))
}

export async function listBoosterNames(boosterUserIds: string[]): Promise<Map<string, { id: string; user_id: string; display_name: string }>> {
  if (boosterUserIds.length === 0) return new Map()
  const { data, error } = await supabase
    .from('booster_profiles')
    .select('id, user_id, display_name')
    .in('user_id', boosterUserIds)
  if (error) throw normalizeApiError(error)
  return new Map((data ?? []).map((b) => [b.user_id, b]))
}
