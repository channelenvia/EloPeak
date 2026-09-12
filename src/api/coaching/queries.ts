import { supabase } from '@/lib/supabase'
import { normalizeApiError } from '@/api/core/errors'
import type { BoosterService, CoachBoosterInfo } from './types'

export async function listOwnCoachingPackages(boosterId: string): Promise<BoosterService[]> {
  const { data, error } = await supabase
    .from('booster_services')
    .select('*')
    .eq('booster_id', boosterId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  if (error) throw normalizeApiError(error)
  return (data ?? []) as unknown as BoosterService[]
}

export async function listPublicCoachingPackages(boosterUserId: string): Promise<BoosterService[]> {
  const { data, error } = await supabase
    .from('booster_services')
    .select('*')
    .eq('booster_id', boosterUserId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  if (error) throw normalizeApiError(error)
  return (data ?? []) as unknown as BoosterService[]
}

export async function listAllActiveCoachingPackages(limit = 100): Promise<BoosterService[]> {
  const { data, error } = await supabase
    .from('booster_services')
    .select('*')
    .eq('service_type', 'coaching')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw normalizeApiError(error)
  return (data ?? []) as unknown as BoosterService[]
}

// Usado ao resolver ?coachPackage= da URL (Order Builder) -- só retorna o
// pacote se ele ainda estiver ativo e for mesmo de coaching, mesma trava que
// listPublicCoachingPackages/listAllActiveCoachingPackages já aplicam pra
// exibição pública (evita ativar um link antigo pra pacote pausado/removido).
export async function getActiveCoachingPackage(id: string): Promise<BoosterService | null> {
  const { data, error } = await supabase
    .from('booster_services')
    .select('*')
    .eq('id', id)
    .eq('service_type', 'coaching')
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw normalizeApiError(error)
  return data as unknown as BoosterService | null
}

export async function getBoosterServiceById(id: string): Promise<BoosterService | null> {
  const { data, error } = await supabase
    .from('booster_services')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw normalizeApiError(error)
  return data as unknown as BoosterService | null
}

// Busca em lote pra cards de lista (ex.: Jobs do booster) -- evita 1 query por
// card quando há vários pedidos de coaching na mesma página.
export async function listBoosterServicesByIds(ids: string[]): Promise<BoosterService[]> {
  if (ids.length === 0) return []
  const { data, error } = await supabase
    .from('booster_services')
    .select('*')
    .in('id', ids)
  if (error) throw normalizeApiError(error)
  return (data ?? []) as unknown as BoosterService[]
}

export async function listCoachBoosterInfo(boosterIds: string[]): Promise<CoachBoosterInfo[]> {
  if (boosterIds.length === 0) return []
  const { data, error } = await supabase
    .from('public_booster_profiles')
    .select('user_id, display_name, rating, is_top3')
    .in('user_id', boosterIds)
  if (error) throw normalizeApiError(error)
  return (data ?? []) as unknown as CoachBoosterInfo[]
}
