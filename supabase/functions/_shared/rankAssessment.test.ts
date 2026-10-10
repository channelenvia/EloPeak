import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { classifyAssessment } from './rankAssessment.ts'

const base = { serviceType: 'win_boost' as const, declaredLow: 'gold' as const, declaredHigh: 'gold' as const, summonerLevel: 150 }

Deno.test('lobbies no mesmo elo declarado: consistente', () => {
  const r = classifyAssessment({ ...base, rankedGamesFound: 12, sampledTiers: ['gold', 'gold', 'silver', 'platinum', 'gold', 'gold'] })
  assertEquals(r.status, 'consistent')
  assertEquals(r.summary.estimated_tier, 'gold')
})

Deno.test('declarou Diamante mas joga contra Prata: suspeito', () => {
  const r = classifyAssessment({ ...base, declaredLow: 'diamond', declaredHigh: 'diamond', rankedGamesFound: 20, sampledTiers: ['silver', 'silver', 'bronze', 'silver', 'gold', 'silver'] })
  assertEquals(r.status, 'suspicious')
})

Deno.test('declarou Ferro mas joga contra Platina: suspeito (preco menor que o real)', () => {
  const r = classifyAssessment({ ...base, declaredLow: 'iron', declaredHigh: 'iron', rankedGamesFound: 20, sampledTiers: ['platinum', 'platinum', 'emerald', 'platinum', 'gold', 'platinum'] })
  assertEquals(r.status, 'suspicious')
})

Deno.test('clash: faixa declarada aceita a estimativa dentro da faixa +-1', () => {
  const r = classifyAssessment({ ...base, declaredLow: 'platinum', declaredHigh: 'emerald', rankedGamesFound: 8, sampledTiers: ['gold', 'gold', 'gold', 'platinum'] })
  assertEquals(r.status, 'consistent')
})

Deno.test('sem partidas ranqueadas: MD5 (elo da temporada passada) e suspeito, os demais inconclusivos', () => {
  assertEquals(classifyAssessment({ ...base, serviceType: 'md5', rankedGamesFound: 0, sampledTiers: [] }).status, 'suspicious')
  assertEquals(classifyAssessment({ ...base, rankedGamesFound: 0, sampledTiers: [] }).status, 'inconclusive')
})

Deno.test('amostra pequena demais: inconclusivo', () => {
  assertEquals(classifyAssessment({ ...base, rankedGamesFound: 5, sampledTiers: ['gold', 'silver'] }).status, 'inconclusive')
})

import { declaredRange, scheduleRankAssessment } from './rankAssessmentJob.ts'

Deno.test('declaredRange: Clash usa a faixa do tier; os demais, o elo declarado', () => {
  assertEquals(declaredRange({ serviceType: 'clash', clashTier: 'tier_2', currentRank: null }), { low: 'platinum', high: 'emerald' })
  assertEquals(declaredRange({ serviceType: 'win_boost', clashTier: null, currentRank: { tier: 'gold', division: 'IV' } }), { low: 'gold', high: 'gold' })
  assertEquals(declaredRange({ serviceType: 'win_boost', clashTier: null, currentRank: null }), null)
})

Deno.test('scheduleRankAssessment so age para elo declarado (origem riot nao dispara nada)', () => {
  let touched = false
  const client = { from: () => { touched = true; return { upsert: () => Promise.resolve({ error: null }) } } }
  // deno-lint-ignore no-explicit-any
  scheduleRankAssessment(client, 'o1', { rankSource: 'riot', serviceType: 'win_boost', clashTier: null, currentRank: { tier: 'gold', division: 'IV' }, riotId: 'A#B', queueType: 'solo_duo' } as any, 'key')
  assertEquals(touched, false)
})

// ── N-3: erro/429 da Riot nunca vira "suspeito" ──
import { runRankAssessment } from './rankAssessment.ts'

Deno.test('Riot indisponivel (429/5xx) na busca de partidas: inconclusivo, nunca suspeito (MD5 incluso)', async () => {
  const real = globalThis.fetch
  globalThis.fetch = (() => Promise.resolve(new Response('x', { status: 429, headers: { 'retry-after': '0' } }))) as typeof fetch
  try {
    for (const serviceType of ['md5', 'win_boost']) {
      const r = await runRankAssessment({
        puuid: 'p', riotApiKey: 'k', serviceType, queueType: 'solo_duo',
        declaredLow: 'iron', declaredHigh: 'iron', splitStartEpochSeconds: 1_700_000_000,
      })
      assertEquals(r.status, 'inconclusive', serviceType)
    }
  } finally { globalThis.fetch = real }
})

Deno.test('classifyAssessment com riotUnavailable: inconclusivo mesmo em MD5', () => {
  const r = classifyAssessment({ serviceType: 'md5', declaredLow: 'iron', declaredHigh: 'iron', rankedGamesFound: 0, sampledTiers: [], summonerLevel: null, riotUnavailable: true })
  assertEquals(r.status, 'inconclusive')
})
