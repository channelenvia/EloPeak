import type { BoosterService } from '@/types'

export interface ServiceFormData {
  title: string
  description: string
  tempo: string
  price: string
  lanes: string[]
  specialties: string[]
}

export const EMPTY_SERVICE_FORM: ServiceFormData = {
  title: '', description: '', tempo: '', price: '', lanes: [], specialties: [],
}

export function serviceToForm(s: BoosterService): ServiceFormData {
  return {
    title: s.title,
    description: s.description ?? '',
    tempo: s.tempo ?? '',
    price: String(s.price),
    lanes: s.lanes ?? [],
    specialties: s.specialties ?? [],
  }
}
