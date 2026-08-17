import { supabase } from '@/lib/supabase'
import { normalizeApiError } from '@/api/core/errors'
import type { SaveCoachingPackageParams } from './types'
import type { BoosterService } from '@/types'

export async function createCoachingPackage(params: SaveCoachingPackageParams) {
  const { data, error } = await supabase.from('booster_services').insert({
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
  }).select('*').single()
  if (error) {
    if (error.message.includes('booster_service_limit_reached')) {
      throw new Error('Você já possui o limite de 3 serviços cadastrados.')
    }
    throw normalizeApiError(error, 'Não foi possível criar o pacote de coaching.')
  }
  return data as unknown as BoosterService
}

export async function updateCoachingPackage(params: SaveCoachingPackageParams & { id: string }) {
  const { data, error } = await supabase.from('booster_services').update({
    title: params.title,
    description: params.description,
    tempo: params.tempo,
    price: params.price,
    lanes: params.lanes,
    specialties: params.specialties,
    champions: params.champions,
  })
    .eq('id', params.id)
    .eq('booster_id', params.boosterId)
    .is('deleted_at', null)
    .select('*')
    .maybeSingle()
  if (error) throw normalizeApiError(error, 'Não foi possível atualizar o pacote de coaching.')
  if (!data) throw new Error('Serviço não encontrado ou você não tem permissão para editá-lo.')
  return data as unknown as BoosterService
}

// Arquivamento em vez de DELETE físico: pedidos históricos mantêm a FK para
// o pacote contratado, enquanto ele some imediatamente das listas e vendas.
export async function deleteCoachingPackage(params: { id: string; boosterId: string }) {
  const { data, error } = await supabase.from('booster_services')
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq('id', params.id)
    .eq('booster_id', params.boosterId)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()
  if (error) throw normalizeApiError(error, 'Não foi possível excluir o pacote de coaching.')
  if (!data) throw new Error('Serviço não encontrado ou você não tem permissão para excluí-lo.')
  return data.id
}

export async function toggleCoachingPackageActive(params: { id: string; boosterId: string; isActive: boolean }) {
  const { data, error } = await supabase.from('booster_services')
    .update({ is_active: params.isActive })
    .eq('id', params.id)
    .eq('booster_id', params.boosterId)
    .is('deleted_at', null)
    .select('*')
    .maybeSingle()
  if (error) throw normalizeApiError(error)
  if (!data) throw new Error('Serviço não encontrado ou você não tem permissão para alterá-lo.')
  return data as unknown as BoosterService
}
