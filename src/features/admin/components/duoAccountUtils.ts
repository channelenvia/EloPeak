import type { AdminDuoAccount } from '@/api/duoAccounts'
import type { Division, RankTier } from '@/types'

export type DuoStatusFilter = 'all' | 'active' | 'inactive' | 'reserved'

export function formatDurationSeconds(seconds: number): string {
  if (seconds < 60) return '<1min'
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d ${hours % 24}h`
  if (hours > 0) return `${hours}h ${minutes % 60}min`
  return `${minutes}min`
}

export function matchesDuoStatus(a: AdminDuoAccount, f: DuoStatusFilter): boolean {
  if (f === 'all') return true
  if (f === 'reserved') return !!a.reserved_by
  return f === 'active' ? a.is_active : !a.is_active
}

export function matchesDuoSearch(a: AdminDuoAccount, search: string): boolean {
  const term = search.trim().toLowerCase()
  return !term || (a.riot_id ?? a.label).toLowerCase().includes(term)
}

export interface AccountForm {
  riot_id: string
  tier: RankTier
  division: Division
  leaguePoints: number | null
  avgGain: number | null
  avgLoss: number | null
  notes: string
  is_active: boolean
  login: string
  password: string
}

export const EMPTY_FORM: AccountForm = {
  riot_id: '', tier: 'gold', division: 'IV', leaguePoints: null, avgGain: null, avgLoss: null,
  notes: '', is_active: true, login: '', password: '',
}

export function accountToForm(a: AdminDuoAccount): AccountForm {
  return {
    riot_id: a.riot_id ?? '',
    tier: a.current_rank?.tier ?? 'gold',
    division: a.current_rank?.division ?? 'IV',
    leaguePoints: null,
    avgGain: null,
    avgLoss: null,
    notes: a.notes ?? '',
    is_active: a.is_active,
    login: '',
    password: '',
  }
}
