import { supabase } from '@/lib/supabase'
import { normalizeApiError } from '@/api/core/errors'
import type { SaveCoachingPackageParams } from './types'

export async function createCoachingPackage(params: SaveCoachingPackageParams) {
  const { error } = await supabase.from('booster_services').insert({
    booster_id: params.boosterId,
    title: params.title,
    description: params.description,
    tempo: params.tempo,
    price: params.price,
    service_type: params.serviceType,
    unit: 'fixed',
    lanes: params.lanes,
    specialties: params.specialties,
    champions: params.champions,
  })
  if (error) throw normalizeApiError(error, 'Não foi possível criar o pacote de coaching.')
}

export async function updateCoachingPackage(params: SaveCoachingPackageParams & { id: string }) {
  const { error } = await supabase.from('booster_services').update({
    title: params.title,
    description: params.description,
    tempo: params.tempo,
    price: params.price,
    lanes: params.lanes,
    specialties: params.specialties,
    champions: params.champions,
  }).eq('id', params.id)
  if (error) throw normalizeApiError(error, 'Não foi possível atualizar o pacote de coaching.')
}

export async function deleteCoachingPackage(id: string) {
  const { error } = await supabase.from('booster_services').delete().eq('id', id)
  if (error) throw normalizeApiError(error, 'Não foi possível excluir o pacote de coaching.')
}

export async function toggleCoachingPackageActive(params: { id: string; isActive: boolean }) {
  const { error } = await supabase.from('booster_services').update({ is_active: params.isActive }).eq('id', params.id)
  if (error) throw normalizeApiError(error)
}
