import type { BoosterService } from '@/types'

const normalize = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ')

// Descrição que só repete o título não agrega nada ao card de contratação.
export function showDescription(p: Pick<BoosterService, 'title' | 'description'>): boolean {
  if (!p.description?.trim()) return false
  const description = normalize(p.description)
  return description !== normalize(p.title) && !normalize(p.title).includes(description)
}