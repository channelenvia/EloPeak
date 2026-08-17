// Guarda contra a regressão introduzida pela migration 140: sem o filtro
// account_type, listBoostersPerformance/getBoosterPerformanceByRank
// capturariam as linhas novas por account_type ('solo'/'duo') que também
// têm service_type='__all__' e devolveriam 3x mais linhas do que antes,
// corrompendo a listagem pública de boosters e o perfil público por rank.
// Roda contra o texto da query builder (não contra um Supabase real).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./queries.ts', import.meta.url), 'utf8')

describe('booster_performance_segments consumers filtram account_type', () => {
  it('listBoostersPerformance filtra account_type __all__', () => {
    const start = source.indexOf('export async function listBoostersPerformance')
    const end = source.indexOf('\n}', start)
    expect(source.slice(start, end)).toContain(".eq('account_type', '__all__')")
  })

  it('getBoosterPerformanceByRank filtra account_type __all__', () => {
    const start = source.indexOf('export async function getBoosterPerformanceByRank')
    const end = source.indexOf('\n}', start)
    expect(source.slice(start, end)).toContain(".eq('account_type', '__all__')")
  })
})
