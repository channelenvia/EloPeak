import { CLASH_TIER_BOUNDARY_RANKS } from '../../../shared/clashDomain.ts'
import type { RankTier } from '../../../shared/pricing.ts'
import { fetchRiotAccount } from './riotLookup.ts'
import { runRankAssessment } from './rankAssessment.ts'
import type { NormalizedIntent } from './orderPricing.ts'
// deno-lint-ignore no-explicit-any
type DbClient = any

// Faixa de elo declarada: Clash declara um tier (faixa de elos); os demais, um elo so.
export function declaredRange(n: Pick<NormalizedIntent, 'serviceType' | 'clashTier' | 'currentRank'>): { low: RankTier; high: RankTier } | null {
  if (n.serviceType === 'clash' && n.clashTier) {
    const range = CLASH_TIER_BOUNDARY_RANKS[n.clashTier]
    return { low: range.low, high: range.high }
  }
  return n.currentRank ? { low: n.currentRank.tier, high: n.currentRank.tier } : null
}

async function assessAndStore(client: DbClient, orderId: string, n: NormalizedIntent, riotApiKey: string): Promise<void> {
  const range = declaredRange(n)
  if (!range || !n.riotId) return
  const account = await fetchRiotAccount(n.riotId, riotApiKey, 'americas', { cacheTtlSeconds: 120 })
  if (!account.ok) return
  const splitStart = Number(Deno.env.get('LOL_SPLIT_START_TIMESTAMP') ?? '0')
  const result = await runRankAssessment({
    puuid: account.account.puuid,
    riotApiKey,
    serviceType: n.serviceType,
    queueType: n.queueType,
    declaredLow: range.low,
    declaredHigh: range.high,
    splitStartEpochSeconds: splitStart > 0 ? splitStart : undefined,
  })
  const { error } = await client.from('order_rank_assessments').upsert({ order_id: orderId, status: result.status, summary: result.summary })
  if (error) console.error('rank assessment store failed', error.message)
}

// Roda DEPOIS da resposta ao cliente (nao atrasa o checkout) e so para elo declarado.
export function scheduleRankAssessment(client: DbClient, orderId: string, n: NormalizedIntent, riotApiKey: string): void {
  if (n.rankSource !== 'client_declared' || !riotApiKey) return
  const job = assessAndStore(client, orderId, n, riotApiKey).catch((err) => console.error('rank assessment job failed', err))
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime
  if (runtime?.waitUntil) runtime.waitUntil(job)
}
