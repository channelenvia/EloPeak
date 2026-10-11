import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { boosterEarningsShare } from '../src/lib/utils'

// A14-04: a comissao existe em TS (boosterEarningsShare) e em SQL (_booster_share_pct); a ultima migration que
// define a funcao SQL tem de bater com a regra TS (coaching 70%, top 3 60%, demais 55%).
const dir = join(__dirname, '..', 'supabase', 'migrations')
const latest = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().reverse()
  .map((f) => readFileSync(join(dir, f), 'utf8'))
  .find((sql) => /function public\._booster_share_pct/i.test(sql))

describe('_booster_share_pct (SQL) x boosterEarningsShare (TS)', () => {
  it('a definicao SQL mais recente existe', () => {
    expect(latest).toBeDefined()
  })

  it('os tres percentuais batem', () => {
    const body = latest!.slice(latest!.search(/function public\._booster_share_pct/i))
    const shares = [...body.matchAll(/then\s+(0\.\d+)|else\s+(0\.\d+)/g)].map((m) => Number(m[1] ?? m[2]))
    expect(shares.slice(0, 3)).toEqual([
      boosterEarningsShare(false, 'coaching'),
      boosterEarningsShare(true, 'elo_boost'),
      boosterEarningsShare(false, 'elo_boost'),
    ])
  })
})
