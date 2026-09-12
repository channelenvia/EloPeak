// Roda no runtime Deno (mesmo padrão de orderPricing.test.ts) -- este módulo
// não depende de fetch/Deno.env, só de JSON puro, então não precisa de fakes
// de rede: passamos corpos de resposta match-v5 sintéticos direto pra
// parseMatchDetail.
//   deno test --allow-env supabase/functions/_shared/riotLookup.test.ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  isRemakeMatch, causedRemake, parseMatchDetail, rankOrdinal, resolveMatchResult,
  type RankOrdinal, type RankOrdinalResult,
} from './riotLookup.ts'

const PUUID = 'booster-puuid'

function participant(overrides: Record<string, unknown> = {}) {
  return {
    puuid: 'other',
    win: true,
    championName: 'Ahri',
    kills: 0,
    deaths: 0,
    assists: 0,
    teamId: 100,
    totalMinionsKilled: 0,
    neutralMinionsKilled: 0,
    ...overrides,
  }
}

function bodyWith(participants: ReturnType<typeof participant>[]) {
  return { info: { queueId: 420, gameDuration: 1800, gameEndTimestamp: 1_700_000_000_000, participants } }
}

Deno.test('parseMatchDetail — participante não encontrado', () => {
  const result = parseMatchDetail(bodyWith([participant({ puuid: 'someone-else' })]), PUUID, 'MATCH_1')
  assertEquals(result.ok, false)
  if (!result.ok) assertEquals(result.reason, 'participant_not_found')
})

Deno.test('parseMatchDetail — soma CS de minions + neutral do próprio participante', () => {
  const body = bodyWith([
    participant({ puuid: PUUID, totalMinionsKilled: 150, neutralMinionsKilled: 20, teamId: 100 }),
  ])
  const result = parseMatchDetail(body, PUUID, 'MATCH_1')
  if (!result.ok) throw new Error('expected ok')
  assertEquals(result.detail.minionsKilled, 150)
  assertEquals(result.detail.neutralMinionsKilled, 20)
})

Deno.test('parseMatchDetail — extrai visionScore do próprio participante', () => {
  const body = bodyWith([
    participant({ puuid: PUUID, visionScore: 42, teamId: 100 }),
  ])
  const result = parseMatchDetail(body, PUUID, 'MATCH_1')
  if (!result.ok) throw new Error('expected ok')
  assertEquals(result.detail.visionScore, 42)
})

Deno.test('parseMatchDetail — visionScore ausente vira null (partidas antigas, sem backfill)', () => {
  const body = bodyWith([
    participant({ puuid: PUUID, teamId: 100 }),
  ])
  const result = parseMatchDetail(body, PUUID, 'MATCH_1')
  if (!result.ok) throw new Error('expected ok')
  assertEquals(result.detail.visionScore, null)
})

Deno.test('parseMatchDetail — is_mvp true quando o KDA do booster é o maior do próprio time', () => {
  const body = bodyWith([
    participant({ puuid: PUUID, teamId: 100, kills: 10, deaths: 2, assists: 5 }), // KDA 7.5
    participant({ puuid: 'ally-2', teamId: 100, kills: 2, deaths: 4, assists: 3 }), // KDA 1.25
    participant({ puuid: 'ally-3', teamId: 100, kills: 1, deaths: 5, assists: 2 }),
    participant({ puuid: 'ally-4', teamId: 100, kills: 0, deaths: 3, assists: 1 }),
    participant({ puuid: 'ally-5', teamId: 100, kills: 3, deaths: 2, assists: 4 }),
    participant({ puuid: 'enemy-1', teamId: 200, kills: 20, deaths: 0, assists: 0 }), // maior KDA da partida, mas time diferente
  ])
  const result = parseMatchDetail(body, PUUID, 'MATCH_1')
  if (!result.ok) throw new Error('expected ok')
  assertEquals(result.detail.isMvp, true)
})

Deno.test('parseMatchDetail — is_mvp false quando um aliado tem KDA maior', () => {
  const body = bodyWith([
    participant({ puuid: PUUID, teamId: 100, kills: 2, deaths: 4, assists: 1 }), // KDA 0.75
    participant({ puuid: 'ally-2', teamId: 100, kills: 10, deaths: 1, assists: 5 }), // KDA 15
    participant({ puuid: 'ally-3', teamId: 100 }),
    participant({ puuid: 'ally-4', teamId: 100 }),
    participant({ puuid: 'ally-5', teamId: 100 }),
  ])
  const result = parseMatchDetail(body, PUUID, 'MATCH_1')
  if (!result.ok) throw new Error('expected ok')
  assertEquals(result.detail.isMvp, false)
})

Deno.test('isRemakeMatch — true quando gameDuration abaixo do corte', () => {
  assertEquals(isRemakeMatch({ info: { gameDuration: 150 } }), true)
})

Deno.test('isRemakeMatch — false pra partida normal', () => {
  assertEquals(isRemakeMatch({ info: { gameDuration: 1800 } }), false)
})

Deno.test('isRemakeMatch — false exatamente no corte (300s não é remake)', () => {
  assertEquals(isRemakeMatch({ info: { gameDuration: 300 } }), false)
})

Deno.test('isRemakeMatch — false quando gameDuration ausente', () => {
  assertEquals(isRemakeMatch({ info: {} }), false)
})

Deno.test('causedRemake — true quando o timePlayed do participante é bem menor que gameDuration', () => {
  const body = {
    info: {
      gameDuration: 170,
      participants: [
        participant({ puuid: PUUID, timePlayed: 12 }),
        participant({ puuid: 'ally-2', timePlayed: 168 }),
      ],
    },
  }
  assertEquals(causedRemake(body, PUUID), true)
})

Deno.test('causedRemake — false quando o participante ficou até o fim (timePlayed ≈ gameDuration)', () => {
  const body = {
    info: {
      gameDuration: 170,
      participants: [
        participant({ puuid: PUUID, timePlayed: 165 }),
        participant({ puuid: 'ally-2', timePlayed: 12 }),
      ],
    },
  }
  assertEquals(causedRemake(body, PUUID), false)
})

Deno.test('causedRemake — false quando a partida nem é remake (gameDuration normal)', () => {
  const body = {
    info: {
      gameDuration: 1800,
      participants: [participant({ puuid: PUUID, timePlayed: 30 })],
    },
  }
  assertEquals(causedRemake(body, PUUID), false)
})

Deno.test('causedRemake — false quando timePlayed não vem na resposta (partidas antigas)', () => {
  const body = { info: { gameDuration: 170, participants: [participant({ puuid: PUUID })] } }
  assertEquals(causedRemake(body, PUUID), false)
})

Deno.test('causedRemake — false quando o puuid não está entre os participantes', () => {
  const body = {
    info: { gameDuration: 170, participants: [participant({ puuid: 'other', timePlayed: 10 })] },
  }
  assertEquals(causedRemake(body, PUUID), false)
})

Deno.test('parseMatchDetail — empate no topo conta como MVP (>=, não > estrito)', () => {
  const body = bodyWith([
    participant({ puuid: PUUID, teamId: 100, kills: 5, deaths: 1, assists: 0 }), // KDA 5
    participant({ puuid: 'ally-2', teamId: 100, kills: 5, deaths: 1, assists: 0 }), // KDA 5, empatado
    participant({ puuid: 'ally-3', teamId: 100 }),
    participant({ puuid: 'ally-4', teamId: 100 }),
    participant({ puuid: 'ally-5', teamId: 100 }),
  ])
  const result = parseMatchDetail(body, PUUID, 'MATCH_1')
  if (!result.ok) throw new Error('expected ok')
  assertEquals(result.detail.isMvp, true)
})

Deno.test('rankOrdinal — promoção de divisão pesa mais que LP dentro da mesma divisão', () => {
  // Gold IV 90 LP -> Gold III 0 LP é uma PROMOÇÃO (subiu), mesmo o LP cru
  // caindo de 90 pra 0 -- é exatamente o caso que rankOrdinal precisa
  // acertar (ver resolveMatchResult, que decide win/loss comparando isso).
  const beforePromotion = rankOrdinal('gold', 'IV', 90)
  const afterPromotion = rankOrdinal('gold', 'III', 0)
  assertEquals(afterPromotion > beforePromotion, true)
})

Deno.test('rankOrdinal — LP crescente dentro da mesma divisão sempre aumenta o ordinal', () => {
  assertEquals(rankOrdinal('platinum', 'II', 40) > rankOrdinal('platinum', 'II', 10), true)
})

function ordinalResult(value: number): RankOrdinalResult {
  return { ok: true, ordinal: { ordinal: value, tier: 'gold', division: 'III', lp: value } }
}

function makeTracker(initial: number | null) {
  return { value: initial }
}

Deno.test('resolveMatchResult — fora de RANK_TRACKED usa a heurística antiga sem chamar a Riot', async () => {
  let fetchCalls = 0
  const body = { info: { gameDuration: 100, participants: [{ puuid: PUUID, timePlayed: 95 }] } }
  const result = await resolveMatchResult({
    isRankTracked: false,
    isRemake: true,
    rawResult: 'win',
    body,
    puuid: PUUID,
    tracker: makeTracker(null),
    fetchOrdinal: async () => { fetchCalls++; return ordinalResult(100) },
    persist: async () => {},
  })
  assertEquals(fetchCalls, 0)
  // timePlayed (95) >= 50% de gameDuration (100) -> não causou o remake.
  assertEquals(result, 'remake')
})

Deno.test('resolveMatchResult — remake com PDL maior depois vira win pro lado rastreado', async () => {
  const tracker = makeTracker(1000)
  const result = await resolveMatchResult({
    isRankTracked: true,
    isRemake: true,
    rawResult: 'win',
    body: { info: {} },
    puuid: PUUID,
    tracker,
    fetchOrdinal: async () => ordinalResult(1010),
    persist: async () => {},
  })
  assertEquals(result, 'win')
  assertEquals(tracker.value, 1010)
})

Deno.test('resolveMatchResult — remake com PDL menor depois vira loss pro lado que kitou', async () => {
  const tracker = makeTracker(1000)
  const result = await resolveMatchResult({
    isRankTracked: true,
    isRemake: true,
    rawResult: 'loss',
    body: { info: {} },
    puuid: PUUID,
    tracker,
    fetchOrdinal: async () => ordinalResult(980),
    persist: async () => {},
  })
  assertEquals(result, 'loss')
})

Deno.test('resolveMatchResult — remake com PDL inalterado continua remake', async () => {
  const tracker = makeTracker(1000)
  const result = await resolveMatchResult({
    isRankTracked: true,
    isRemake: true,
    rawResult: 'loss',
    body: { info: {} },
    puuid: PUUID,
    tracker,
    fetchOrdinal: async () => ordinalResult(1000),
    persist: async () => {},
  })
  assertEquals(result, 'remake')
})

Deno.test('resolveMatchResult — partida normal usa participant.win mesmo com RANK_TRACKED (não a comparação de PDL)', async () => {
  const tracker = makeTracker(1000)
  const persisted: { value: RankOrdinal | null } = { value: null }
  const result = await resolveMatchResult({
    isRankTracked: true,
    isRemake: false,
    rawResult: 'win',
    body: { info: {} },
    puuid: PUUID,
    tracker,
    fetchOrdinal: async () => ordinalResult(970), // caiu, mas não é remake -- resultado real manda
    persist: async (ordinal) => { persisted.value = ordinal },
  })
  assertEquals(result, 'win')
  assertEquals(tracker.value, 970)
  assertEquals(persisted.value?.ordinal, 970)
})

Deno.test('resolveMatchResult — Riot indisponível degrada pra heurística antiga sem tocar no checkpoint', async () => {
  const tracker = makeTracker(1000)
  const body = { info: { gameDuration: 100, participants: [{ puuid: PUUID, timePlayed: 10 }] } }
  const result = await resolveMatchResult({
    isRankTracked: true,
    isRemake: true,
    rawResult: 'loss',
    body,
    puuid: PUUID,
    tracker,
    fetchOrdinal: async () => ({ ok: false, reason: 'rate_limited', status: 429 }),
    persist: async () => { throw new Error('não deveria persistir sem ordinal fresco') },
  })
  // timePlayed (10) bem abaixo de 50% de gameDuration (100) -> causou o remake.
  assertEquals(result, 'loss')
  assertEquals(tracker.value, 1000)
})

Deno.test('resolveMatchResult — sem checkpoint prévio (primeira partida do lote) cai pra heurística antiga só pra ESSE remake', async () => {
  const tracker = makeTracker(null)
  const body = { info: { gameDuration: 100, participants: [{ puuid: PUUID, timePlayed: 95 }] } }
  const result = await resolveMatchResult({
    isRankTracked: true,
    isRemake: true,
    rawResult: 'loss',
    body,
    puuid: PUUID,
    tracker,
    fetchOrdinal: async () => ordinalResult(500),
    persist: async () => {},
  })
  assertEquals(result, 'remake')
  // O checkpoint avança mesmo sem "antes" pra comparar -- fica pronto pro
  // próximo remake do mesmo lote.
  assertEquals(tracker.value, 500)
})
