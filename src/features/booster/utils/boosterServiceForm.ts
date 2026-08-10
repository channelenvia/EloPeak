import type { BoosterService } from '@/types'

export interface ServiceFormData {
  title: string
  description: string
  tempo: string
  price: string
  lanes: string[]
  specialties: string[]
  champions: string[]
}

export const EMPTY_SERVICE_FORM: ServiceFormData = {
  title: '', description: '', tempo: '', price: '', lanes: [], specialties: [], champions: [],
}

export function serviceToForm(s: BoosterService): ServiceFormData {
  return {
    title: s.title,
    description: s.description ?? '',
    tempo: s.tempo ?? '',
    price: String(s.price),
    lanes: s.lanes ?? [],
    specialties: s.specialties ?? [],
    champions: s.champions ?? [],
  }
}
