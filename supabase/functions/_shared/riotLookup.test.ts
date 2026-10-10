// Roda no runtime Deno (mesmo padrão de orderPricing.test.ts) -- este módulo
// não depende de fetch/Deno.env, só de JSON puro, então não precisa de fakes
// de rede: passamos corpos de resposta match-v5 sintéticos direto pra
// parseMatchDetail.
//   deno test --allow-env supabase/functions/_shared/riotLookup.test.ts
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  fetchMatchIdsSince, isRemakeMatch, causedRemake, parseMatchDetail, rankOrdinal, resolveMatchResult,
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

Deno.test('fetchMatchIdsSince: pagina ate a ultima pagina (130 partidas em 2 requisicoes) e nunca devolve lista parcial em erro', async () => {
  const realFetch = globalThis.fetch
  const urls: string[] = []
  const ids = (from: number, n: number) => Array.from({ length: n }, (_, i) => `BR1_${from + i}`)
  globalThis.fetch = ((input: Request | URL | string) => {
    const url = String(input instanceof Request ? input.url : input)
    urls.push(url)
    const start = Number(new URL(url).searchParams.get('start'))
    return Promise.resolve(new Response(JSON.stringify(start === 0 ? ids(0, 100) : ids(100, 30)), { status: 200 }))
  }) as typeof fetch
  try {
    const result = await fetchMatchIdsSince('puuid-1', 'key', 'americas', 420, 1_700_000_000)
    assert(result.ok)
    assertEquals(result.matchIds.length, 130)
    assertEquals(urls.length, 2)
    assert(urls[1].includes('start=100'))

    // pagina 2 falha -> erro, sem lista parcial
    let call = 0
    globalThis.fetch = (() => Promise.resolve(call++ === 0
      ? new Response(JSON.stringify(ids(0, 100)), { status: 200 })
      : new Response('boom', { status: 500 }))) as typeof fetch
    const partial = await fetchMatchIdsSince('puuid-1', 'key', 'americas', 420, 1_700_000_000)
    assertEquals(partial.ok, false)
  } finally {
    globalThis.fetch = realFetch
  }
})

// ── L-10: falha transitoria da Riot (5xx, timeout, rede) tem 1 retry e nunca vira excecao ──
import { fetchRiotAccount } from './riotLookup.ts'

function withFetch(handler: () => Promise<Response>, fn: () => Promise<void>) {
  const real = globalThis.fetch
  let calls = 0
  globalThis.fetch = (() => { calls++; return handler() }) as typeof fetch
  return fn().finally(() => { globalThis.fetch = real }).then(() => calls)
}

Deno.test('Riot 503 seguido de 200: o retry recupera a consulta', async () => {
  const responses = [new Response('x', { status: 503 }), new Response(JSON.stringify({ puuid: 'p', gameName: 'Fulano', tagLine: 'BR1' }), { status: 200 })]
  const calls = await withFetch(() => Promise.resolve(responses.shift()!), async () => {
    const r = await fetchRiotAccount('Fulano#BR1', 'key', 'americas')
    assertEquals(r.ok, true)
  })
  assertEquals(calls, 2)
})

Deno.test('Riot que derruba a conexao (excecao do fetch) vira upstream_error, nao excecao', async () => {
  await withFetch(() => Promise.reject(new DOMException('aborted', 'AbortError')), async () => {
    const r = await fetchRiotAccount('Fulano#BR1', 'key', 'americas')
    assertEquals(r.ok, false)
    if (!r.ok) assertEquals(r.reason, 'upstream_error')
  })
})

// ── M-27: conta de outro servidor (sem entries E sem summoner no BR) nao passa por "sem rank" ──
import { fetchLeagueEntries } from './riotLookup.ts'

Deno.test('Sem entries e sem summoner no BR: reason wrong_region', async () => {
  const calls: string[] = []
  await withFetch(() => Promise.resolve(new Response('[]', { status: 200 })), async () => {
    const real = globalThis.fetch
    globalThis.fetch = ((input: Request | URL | string) => {
      const url = String(input instanceof Request ? input.url : input)
      calls.push(url)
      if (url.includes('/summoner/v4/summoners/by-puuid/')) return Promise.resolve(new Response('{}', { status: 404 }))
      return Promise.resolve(new Response('[]', { status: 200 }))
    }) as typeof fetch
    try {
      const r = await fetchLeagueEntries('puuid-na', 'key', 'br1')
      assertEquals(r.ok, false)
      if (!r.ok) assertEquals(r.reason, 'wrong_region')
    } finally { globalThis.fetch = real }
  })
})

Deno.test('Sem entries mas com summoner no BR: conta sem rank continua ok', async () => {
  await withFetch(() => Promise.resolve(new Response('[]', { status: 200 })), async () => {
    const real = globalThis.fetch
    globalThis.fetch = ((input: Request | URL | string) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.includes('/summoner/v4/summoners/by-puuid/')) return Promise.resolve(new Response('{"puuid":"p"}', { status: 200 }))
      return Promise.resolve(new Response('[]', { status: 200 }))
    }) as typeof fetch
    try {
      const r = await fetchLeagueEntries('puuid-br', 'key', 'br1')
      assertEquals(r.ok, true)
    } finally { globalThis.fetch = real }
  })
})

// ── H-26(c): a conta duo so conta se estiver no MESMO time do cliente ──
import { onSameTeam } from './riotLookup.ts'

Deno.test('onSameTeam: mesmo teamId conta, time adversario nao, ausente nao', () => {
  const body = bodyWith([
    participant({ puuid: 'cliente', teamId: 100 }),
    participant({ puuid: 'amigo', teamId: 100 }),
    participant({ puuid: 'inimigo', teamId: 200 }),
    participant({ puuid: 'semtime', teamId: undefined }),
  ])
  assertEquals(onSameTeam(body, 'cliente', 'amigo'), true)
  assertEquals(onSameTeam(body, 'cliente', 'inimigo'), false)
  assertEquals(onSameTeam(body, 'cliente', 'semtime'), false)
  assertEquals(onSameTeam(body, 'cliente', 'fora-da-partida'), false)
})

// ── H-27: cache curto por conta nos caminhos de checkout/preview (sync de partidas continua sempre fresco) ──
import { enterRiotContext, setRiotBudgetConsumerForTests, setRiotCacheStoreForTests, withRiotContext } from './riotLookup.ts'

function memoryCache() {
  const map = new Map<string, unknown>()
  return {
    map,
    store: {
      get: (key: string) => Promise.resolve(map.get(key) ?? null),
      set: (key: string, value: unknown) => { map.set(key, value); return Promise.resolve() },
    },
  }
}

Deno.test('fetchRiotAccount com cacheTtl: a segunda consulta nao chama a Riot', async () => {
  const mem = memoryCache()
  setRiotCacheStoreForTests(mem.store)
  try {
    const calls = await withFetch(
      () => Promise.resolve(new Response(JSON.stringify({ puuid: 'p', gameName: 'Fulano', tagLine: 'BR1' }), { status: 200 })),
      async () => {
        const first = await fetchRiotAccount('Fulano#BR1', 'key', 'americas', { cacheTtlSeconds: 60 })
        const second = await fetchRiotAccount('fulano#br1', 'key', 'americas', { cacheTtlSeconds: 60 })
        assertEquals(first.ok && second.ok, true)
      },
    )
    assertEquals(calls, 1)
  } finally { setRiotCacheStoreForTests(null) }
})

Deno.test('fetchRiotAccount sem cacheTtl nunca usa o cache', async () => {
  const mem = memoryCache()
  setRiotCacheStoreForTests(mem.store)
  try {
    const calls = await withFetch(
      () => Promise.resolve(new Response(JSON.stringify({ puuid: 'p', gameName: 'Fulano', tagLine: 'BR1' }), { status: 200 })),
      async () => {
        await fetchRiotAccount('Fulano#BR1', 'key', 'americas')
        await fetchRiotAccount('Fulano#BR1', 'key', 'americas')
      },
    )
    assertEquals(calls, 2)
    assertEquals(mem.map.size, 0)
  } finally { setRiotCacheStoreForTests(null) }
})

Deno.test('Falha da Riot nunca entra no cache', async () => {
  const mem = memoryCache()
  setRiotCacheStoreForTests(mem.store)
  try {
    await withFetch(() => Promise.resolve(new Response('x', { status: 404 })), async () => {
      const r = await fetchRiotAccount('Fulano#BR1', 'key', 'americas', { cacheTtlSeconds: 60 })
      assertEquals(r.ok, false)
    })
    assertEquals(mem.map.size, 0)
  } finally { setRiotCacheStoreForTests(null) }
})

Deno.test('fetchLeagueEntries com cacheTtl reaproveita a resposta', async () => {
  const mem = memoryCache()
  setRiotCacheStoreForTests(mem.store)
  try {
    const entries = [{ queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'IV', leaguePoints: 10 }]
    const calls = await withFetch(() => Promise.resolve(new Response(JSON.stringify(entries), { status: 200 })), async () => {
      await fetchLeagueEntries('puuid-1', 'key', 'br1', { cacheTtlSeconds: 60 })
      const second = await fetchLeagueEntries('puuid-1', 'key', 'br1', { cacheTtlSeconds: 60 })
      assertEquals(second.ok && second.entries.length, 1)
    })
    assertEquals(calls, 1)
  } finally { setRiotCacheStoreForTests(null) }
})


// ── N-2: cota por usuario + prioridade; um usuario nao esgota o orcamento global ──

function fakeBudget() {
  const counts = new Map<string, number>()
  const consumer = (scope: string, subject: string, limit: number) => {
    const k = `${scope}|${subject}`
    const n = (counts.get(k) ?? 0) + 1
    counts.set(k, n)
    return Promise.resolve(n <= limit)
  }
  return { counts, consumer }
}
const okAccount = () => Promise.resolve(new Response(JSON.stringify({ puuid: 'p', gameName: 'Fulano', tagLine: 'BR1' }), { status: 200 }))

Deno.test('N-2: usuario que estoura a propria cota leva rate_limited sem gastar o balde global e sem afetar outro usuario', async () => {
  const b = fakeBudget()
  setRiotBudgetConsumerForTests(b.consumer)
  try {
    await withFetch(okAccount, async () => {
      for (let i = 0; i < 60; i++) await withRiotContext({ userId: 'A', tier: 'interactive' }, () => fetchRiotAccount('Fulano#BR1', 'key', 'americas'))
      const globalAfterA = b.counts.get('riot-global|all') ?? 0
      assertEquals(globalAfterA, 30, 'so as 30 chamadas dentro da cota do usuario chegam ao global')
      const other = await withRiotContext({ userId: 'B', tier: 'interactive' }, () => fetchRiotAccount('Fulano#BR1', 'key', 'americas'))
      assertEquals(other.ok, true)
    })
  } finally { setRiotBudgetConsumerForTests(null) }
})

Deno.test('N-2: chamadas prioritarias (sync/verify) ainda passam quando o teto interativo ja foi atingido', async () => {
  const b = fakeBudget()
  setRiotBudgetConsumerForTests(b.consumer)
  try {
    await withFetch(okAccount, async () => {
      for (let u = 0; u < 4; u++) {
        for (let i = 0; i < 30; i++) await withRiotContext({ userId: `u${u}`, tier: 'interactive' }, () => fetchRiotAccount('Fulano#BR1', 'key', 'americas'))
      }
      const blocked = await withRiotContext({ userId: 'u9', tier: 'interactive' }, () => fetchRiotAccount('Fulano#BR1', 'key', 'americas'))
      assertEquals(blocked.ok, false)
      const prio = await withRiotContext({ tier: 'priority' }, () => fetchRiotAccount('Fulano#BR1', 'key', 'americas'))
      assertEquals(prio.ok, true)
    })
  } finally { setRiotBudgetConsumerForTests(null) }
})

Deno.test('N-2: cache hit nao consome orcamento', async () => {
  const b = fakeBudget()
  const mem = memoryCache()
  setRiotBudgetConsumerForTests(b.consumer)
  setRiotCacheStoreForTests(mem.store)
  try {
    await withFetch(okAccount, async () => {
      await withRiotContext({ userId: 'A', tier: 'interactive' }, () => fetchRiotAccount('Fulano#BR1', 'key', 'americas', { cacheTtlSeconds: 60 }))
      const before = b.counts.get('riot-global|all')
      await withRiotContext({ userId: 'A', tier: 'interactive' }, () => fetchRiotAccount('Fulano#BR1', 'key', 'americas', { cacheTtlSeconds: 60 }))
      assertEquals(b.counts.get('riot-global|all'), before)
    })
  } finally { setRiotBudgetConsumerForTests(null); setRiotCacheStoreForTests(null) }
})

Deno.test('N-2: sem contexto o comportamento e o antigo (so o balde global, prioridade alta)', async () => {
  const b = fakeBudget()
  setRiotBudgetConsumerForTests(b.consumer)
  try {
    await withFetch(okAccount, async () => {
      await fetchRiotAccount('Fulano#BR1', 'key', 'americas')
      assertEquals([...b.counts.keys()], ['riot-global|all'])
    })
  } finally { setRiotBudgetConsumerForTests(null) }
})

Deno.test('N-2: contador que lanca excecao falha aberto (nao derruba a consulta)', async () => {
  setRiotBudgetConsumerForTests(() => Promise.reject(new Error('db down')))
  try {
    await withFetch(okAccount, async () => {
      const r = await withRiotContext({ userId: 'A', tier: 'interactive' }, () => fetchRiotAccount('Fulano#BR1', 'key', 'americas'))
      assertEquals(r.ok, true)
    })
  } finally { setRiotBudgetConsumerForTests(null) }
})

Deno.test('N-2: enterRiotContext propaga a continuacao e tarefas disparadas depois, sem vazar entre requisicoes concorrentes', async () => {
  const seen: string[] = []
  const consumer = (scope: string, subject: string) => { if (scope === 'riot-user') seen.push(subject); return Promise.resolve(true) }
  setRiotBudgetConsumerForTests(consumer)
  const handler = async (user: string) => {
    await new Promise((r) => setTimeout(r, user === 'A' ? 5 : 1)) // simula o await de getAuthUser
    enterRiotContext({ userId: user, tier: 'interactive' })
    await new Promise((r) => setTimeout(r, user === 'A' ? 1 : 5)) // intercala as duas requisicoes
    const background = Promise.resolve().then(() => fetchRiotAccount('Fulano#BR1', 'key', 'americas')) // como o waitUntil da avaliacao
    await fetchRiotAccount('Fulano#BR1', 'key', 'americas')
    await background
  }
  try {
    await withFetch(okAccount, async () => { await Promise.all([handler('A'), handler('B')]) })
    assertEquals(seen.sort(), ['A', 'A', 'B', 'B'])
  } finally { setRiotBudgetConsumerForTests(null) }
})
