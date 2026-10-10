// Testes de integração da validação/precificação autoritativa do backend
// (validateAndPriceIntent) -- roda no runtime real do edge function (Deno),
// não no Vitest/Node do resto do repo, porque este módulo importa zod via
// especificador remoto (https://esm.sh/...) e usa `Deno.env`. Rodar com:
//   deno test --allow-env supabase/functions/_shared/orderPricing.test.ts
//
// Cobre o fluxo Clash (Solo/Duo) de ponta a ponta -- é o caminho mais barato
// de montar aqui porque não dispara reverificação na API da Riot (só
// elo_boost/win_boost/md5 fazem isso), então o "serviceClient" fake só
// precisa sustentar as tabelas services/games/service_extras.
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { validateAndPriceIntent } from './orderPricing.ts'
import { CLASH_PRICE_CENTS } from '../../../shared/pricing.ts'

const SERVICE_ID = '11111111-1111-1111-1111-111111111111'
const GAME_ID = '22222222-2222-2222-2222-222222222222'
const USER_ID = '33333333-3333-3333-3333-333333333333'

type ExtraRow = { id: string; code: string; name: string; price_modifier: number; price_modifier_pct: number; sort_order: number }

// Fake mínimo do supabaseAdmin client -- só implementa as poucas cadeias que
// o caminho Clash realmente percorre em validateAndPriceIntent (services,
// games, service_extras). Qualquer outra tabela usada por engano por um
// teste futuro estoura logo (`unexpected table`), em vez de silenciosamente
// devolver undefined e mascarar um bug de teste.
function fakeServiceClient(opts: {
  service?: { id: string; game_id: string; type: string; is_active: boolean } | null
  game?: { id: string; is_active: boolean } | null
  extras?: ExtraRow[]
} = {}) {
  // 'service'/'game' in opts (não `??`) -- `??` trata `null` explícito como
  // "não informado" e cairia sempre no default, o que mascararia o próprio
  // caso que o teste de service_id inexistente precisa simular.
  const service = 'service' in opts ? opts.service! : { id: SERVICE_ID, game_id: GAME_ID, type: 'clash', is_active: true }
  const game = 'game' in opts ? opts.game! : { id: GAME_ID, is_active: true }
  const extras = opts.extras ?? []

  return {
    from(table: string) {
      if (table === 'services') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: service, error: null }) }) }) }
      }
      if (table === 'games') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: game, error: null }) }) }) }
      }
      if (table === 'service_extras') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: (_col: string, codes: string[]) =>
                  Promise.resolve({ data: extras.filter((e) => codes.includes(e.code)), error: null }),
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table in test stub: ${table}`)
      // deno-lint-ignore no-unreachable
    },
    // deno-lint-ignore no-explicit-any
  } as any
}

function clashIntent(overrides: Record<string, unknown> = {}) {
  return {
    service_type: 'clash',
    service_id: SERVICE_ID,
    game_id: GAME_ID,
    boost_mode: 'solo',
    server: 'BR1',
    clash_tier: 'tier_4',
    clash_day: 'saturday',
    addon_codes: [],
    customer_notes: null,
    riot_id: 'Fulano#BR1',
    coupon_code: null,
    ...overrides,
  }
}

const req = new Request('http://localhost/test')

type LeagueStub = { queueType: string; tier: string; rank?: string; leaguePoints?: number }
const realFetch = globalThis.fetch

// Responde a Riot: account-v1 (puuid) e league-v4 (entries) ou erro 500.
function stubRiot(entries: LeagueStub[] | 'error') {
  globalThis.fetch = ((input: Request | URL | string) => {
    const url = String(input instanceof Request ? input.url : input)
    if (entries === 'error') return Promise.resolve(new Response('boom', { status: 500 }))
    if (url.includes('/riot/account/v1/accounts/by-riot-id/')) {
      return Promise.resolve(new Response(JSON.stringify({ puuid: 'puuid-1', gameName: 'Fulano', tagLine: 'BR1' }), { status: 200 }))
    }
    if (url.includes('/lol/summoner/v4/summoners/by-puuid/')) {
      return Promise.resolve(new Response(JSON.stringify({ puuid: 'puuid-1' }), { status: 200 }))
    }
    if (url.includes('/lol/league/v4/entries/by-puuid/')) {
      return Promise.resolve(new Response(JSON.stringify(entries), { status: 200 }))
    }
    if (url.includes('/lol/match/v5/matches/by-puuid/')) return Promise.resolve(new Response('[]', { status: 200 }))
    return Promise.resolve(new Response('not found', { status: 404 }))
  }) as typeof fetch
}
function restoreRiot() { globalThis.fetch = realFetch }
// Padrao dos testes antigos: conta Ferro IV (tier_4), igual ao clashIntent().
stubRiot([{ queueType: 'RANKED_SOLO_5x5', tier: 'IRON', rank: 'IV', leaguePoints: 0 }])

Deno.test('Clash Solo tier_4 -- preço final bate com a tabela fixa (R$26,00), sem cupom', async () => {
  const outcome = await validateAndPriceIntent(req, clashIntent(), USER_ID, fakeServiceClient(), 'test-key', null)
  assert(outcome.ok, `esperava sucesso, veio erro: ${!outcome.ok ? await outcome.response.clone().text() : ''}`)
  assertEquals(outcome.priced.totalPrice, 26)
  assertEquals(outcome.priced.couponApplied, false)
  assertEquals(outcome.normalized.clashTier, 'tier_4')
  assertEquals(outcome.normalized.clashDay, 'saturday')
  assertEquals(outcome.normalized.riotId, 'Fulano#BR1')
})

Deno.test('Clash sem riot_id é rejeitado (obrigatório nos dois modos -- Solo referencia o booster, Duo identifica o cliente pro time)', async () => {
  const { riot_id: _riotId, ...withoutRiotId } = clashIntent()
  const outcome = await validateAndPriceIntent(req, withoutRiotId, USER_ID, fakeServiceClient(), 'test-key', null)
  assert(!outcome.ok)
  assertEquals(outcome.response.status, 400)
})

Deno.test('Clash Duo mantém riot_id no normalized igual ao Solo', async () => {
  const outcome = await validateAndPriceIntent(
    req, clashIntent({ boost_mode: 'duo', riot_id: 'Cliente#BR2' }), USER_ID, fakeServiceClient(), 'test-key', null,
  )
  assert(outcome.ok, `esperava sucesso, veio erro: ${!outcome.ok ? await outcome.response.clone().text() : ''}`)
  assertEquals(outcome.normalized.riotId, 'Cliente#BR2')
})

Deno.test('Clash Duo tier_4 -- preço final bate com a tabela fixa (R$77,87)', async () => {
  const outcome = await validateAndPriceIntent(req, clashIntent({ boost_mode: 'duo' }), USER_ID, fakeServiceClient(), 'test-key', null)
  assert(outcome.ok)
  assertEquals(outcome.priced.totalPrice, 77.87)
  assertEquals(outcome.normalized.boostMode, 'duo')
})

Deno.test('Clash sem current_rank/current_lp no intent (cliente antigo) normaliza pra null/0, sem quebrar nem mudar o preço', async () => {
  const outcome = await validateAndPriceIntent(req, clashIntent(), USER_ID, fakeServiceClient(), 'test-key', null)
  assert(outcome.ok)
  // Sem rank enviado pelo cliente, vale o verificado na Riot (stub: Ferro IV, 0 LP).
  assertEquals(outcome.normalized.currentRank, { tier: 'iron', division: 'IV' })
  assertEquals(outcome.normalized.currentLp, 0)
  assertEquals(outcome.priced.totalPrice, 26)
})

Deno.test('Clash: current_rank/current_lp enviados pelo cliente são ignorados -- vale o rank verificado na Riot, sem afetar o preço (que segue vindo só do tier)', async () => {
  const outcome = await validateAndPriceIntent(
    req,
    clashIntent({ current_rank: { tier: 'gold', division: 'II' }, current_lp: 45 }),
    USER_ID, fakeServiceClient(), 'test-key', null,
  )
  assert(outcome.ok, `esperava sucesso, veio erro: ${!outcome.ok ? await outcome.response.clone().text() : ''}`)
  assertEquals(outcome.normalized.currentRank, { tier: 'iron', division: 'IV' })
  assertEquals(outcome.normalized.currentLp, 0)
  assertEquals(outcome.priced.totalPrice, 26)
})

Deno.test('Cupom ELOPEAK30 aplica 30% de desconto no Clash (regressão -- Clash só entrou na whitelist de elegibilidade nesta rodada de auditoria)', async () => {
  const outcome = await validateAndPriceIntent(
    req, clashIntent({ coupon_code: 'ELOPEAK30' }), USER_ID, fakeServiceClient(), 'test-key', null,
  )
  assert(outcome.ok)
  assertEquals(outcome.priced.couponApplied, true)
  assertEquals(outcome.priced.discountPct, 30)
  // 26 * 0.30 = 7.80 de desconto -> total 18.20
  assertEquals(outcome.priced.totalPrice, 18.2)
})

Deno.test('Cupom com código desconhecido não aplica desconto, mas não é erro (segue sem desconto)', async () => {
  const outcome = await validateAndPriceIntent(
    req, clashIntent({ coupon_code: 'NAOEXISTE' }), USER_ID, fakeServiceClient(), 'test-key', null,
  )
  assert(outcome.ok)
  assertEquals(outcome.priced.couponApplied, false)
  assertEquals(outcome.priced.totalPrice, 26)
})

Deno.test('Addon válido do catálogo (solo_standard, reaproveitado pelo Solo Clash) é aceito e soma no preço final', async () => {
  // 'priority' é o código real de PRIORITY_ADDON_CODE (shared/boostDomain.ts)
  // -- Solo Clash valida contra a mesma whitelist 'solo_standard' de
  // Solo Boost/Vitórias/MD5, não tem catálogo próprio.
  const extras: ExtraRow[] = [
    { id: 'extra-1', code: 'priority', name: 'Acesso Prioritário', price_modifier: 5, price_modifier_pct: 0, sort_order: 1 },
  ]
  const outcome = await validateAndPriceIntent(
    req, clashIntent({ addon_codes: ['priority'] }), USER_ID, fakeServiceClient({ extras }), 'test-key', null,
  )
  assert(outcome.ok, `esperava sucesso: ${!outcome.ok ? await outcome.response.clone().text() : ''}`)
  assertEquals(outcome.extras.length, 1)
  assertEquals(outcome.priced.totalPrice, 31) // 26 base + 5 do addon
})

Deno.test('Solo Clash rejeita addon fora do seu subconjunto (mono_champ é do Elo Boost, não do Clash) mesmo existindo em service_extras', async () => {
  const extras: ExtraRow[] = [
    { id: 'extra-2', code: 'mono_champ', name: 'Mono Champion', price_modifier: 0, price_modifier_pct: 10, sort_order: 1 },
  ]
  const outcome = await validateAndPriceIntent(
    req, clashIntent({ addon_codes: ['mono_champ'] }), USER_ID, fakeServiceClient({ extras }), 'test-key', null,
  )
  assert(!outcome.ok)
  assertEquals(outcome.response.status, 400)
})

Deno.test('Duo Clash aceita duo_voice mas rejeita undetectable_duo (fora do subconjunto do Clash)', async () => {
  const extras: ExtraRow[] = [
    { id: 'extra-3', code: 'undetectable_duo', name: 'Duo Indetectável', price_modifier: 0, price_modifier_pct: 15, sort_order: 1 },
  ]
  const outcome = await validateAndPriceIntent(
    req, clashIntent({ boost_mode: 'duo', addon_codes: ['undetectable_duo'] }), USER_ID, fakeServiceClient({ extras }), 'test-key', null,
  )
  assert(!outcome.ok)
  assertEquals(outcome.response.status, 400)
})

Deno.test('Addon inexistente/inativo no catálogo é rejeitado com 400', async () => {
  const outcome = await validateAndPriceIntent(
    req, clashIntent({ addon_codes: ['nao_existe'] }), USER_ID, fakeServiceClient({ extras: [] }), 'test-key', null,
  )
  assert(!outcome.ok)
  assertEquals(outcome.response.status, 400)
})

Deno.test('clash_day fora do enum (schema) é rejeitado antes de qualquer chamada ao banco', async () => {
  const outcome = await validateAndPriceIntent(
    req, clashIntent({ clash_day: 'monday' }), USER_ID, fakeServiceClient(), 'test-key', null,
  )
  assert(!outcome.ok)
  assertEquals(outcome.response.status, 400)
  const body = await outcome.response.clone().json()
  assertEquals(body.error, 'Body inválido')
})

Deno.test('service_id inexistente no catálogo (maybeSingle = null) é rejeitado com 400, sem lançar exceção', async () => {
  const outcome = await validateAndPriceIntent(
    req, clashIntent(), USER_ID, fakeServiceClient({ service: null }), 'test-key', null,
  )
  assert(!outcome.ok)
  assertEquals(outcome.response.status, 400)
})

Deno.test('service_type do catálogo divergente do intent (ex.: services.type != clash) é rejeitado', async () => {
  const outcome = await validateAndPriceIntent(
    req, clashIntent(), USER_ID,
    fakeServiceClient({ service: { id: SERVICE_ID, game_id: GAME_ID, type: 'elo_boost', is_active: true } }),
    'test-key', null,
  )
  assert(!outcome.ok)
  assertEquals(outcome.response.status, 400)
})


// ── C-06: o tier do Clash e derivado do rank VERIFICADO na Riot, nunca do que o cliente envia ──
Deno.test('Clash: conta Diamante com clash_tier tier_4 (mais barato) e rejeitada com 400', async () => {
  stubRiot([{ queueType: 'RANKED_SOLO_5x5', tier: 'DIAMOND', rank: 'II', leaguePoints: 10 }])
  try {
    const outcome = await validateAndPriceIntent(req, clashIntent({ clash_tier: 'tier_4' }), USER_ID, fakeServiceClient(), 'test-key', null)
    assert(!outcome.ok)
    assertEquals(outcome.response.status, 400)
  } finally { stubRiot([{ queueType: 'RANKED_SOLO_5x5', tier: 'IRON', rank: 'IV', leaguePoints: 0 }]) }
})

Deno.test('Clash: conta Diamante com o tier certo (tier_1) cobra o preco da tabela do tier_1', async () => {
  stubRiot([{ queueType: 'RANKED_SOLO_5x5', tier: 'DIAMOND', rank: 'II', leaguePoints: 10 }])
  try {
    const outcome = await validateAndPriceIntent(req, clashIntent({ clash_tier: 'tier_1' }), USER_ID, fakeServiceClient(), 'test-key', null)
    assert(outcome.ok, `esperava sucesso: ${!outcome.ok ? await outcome.response.clone().text() : ''}`)
    assertEquals(outcome.priced.totalPrice, CLASH_PRICE_CENTS.solo.tier_1 / 100)
    assertEquals(outcome.normalized.currentRank, { tier: 'diamond', division: 'II' })
  } finally { stubRiot([{ queueType: 'RANKED_SOLO_5x5', tier: 'IRON', rank: 'IV', leaguePoints: 0 }]) }
})

Deno.test('Clash: vale o MAIOR rank entre solo/duo e flex', async () => {
  stubRiot([
    { queueType: 'RANKED_SOLO_5x5', tier: 'SILVER', rank: 'I', leaguePoints: 0 },
    { queueType: 'RANKED_FLEX_SR', tier: 'PLATINUM', rank: 'IV', leaguePoints: 0 },
  ])
  try {
    const wrong = await validateAndPriceIntent(req, clashIntent({ clash_tier: 'tier_4' }), USER_ID, fakeServiceClient(), 'test-key', null)
    assert(!wrong.ok)
    const right = await validateAndPriceIntent(req, clashIntent({ clash_tier: 'tier_2' }), USER_ID, fakeServiceClient(), 'test-key', null)
    assert(right.ok)
  } finally { stubRiot([{ queueType: 'RANKED_SOLO_5x5', tier: 'IRON', rank: 'IV', leaguePoints: 0 }]) }
})

Deno.test('Clash: conta sem rank so pode escolher o tier mais baixo', async () => {
  stubRiot([])
  try {
    const high = await validateAndPriceIntent(req, clashIntent({ clash_tier: 'tier_1' }), USER_ID, fakeServiceClient(), 'test-key', null)
    assert(!high.ok)
    const low = await validateAndPriceIntent(req, clashIntent({ clash_tier: 'tier_4' }), USER_ID, fakeServiceClient(), 'test-key', null)
    assert(low.ok)
  } finally { stubRiot([{ queueType: 'RANKED_SOLO_5x5', tier: 'IRON', rank: 'IV', leaguePoints: 0 }]) }
})

Deno.test('Clash: falha da Riot nunca libera o preco (502) e chave ausente e erro de servidor', async () => {
  stubRiot('error')
  try {
    const down = await validateAndPriceIntent(req, clashIntent(), USER_ID, fakeServiceClient(), 'test-key', null)
    assert(!down.ok)
    assertEquals(down.response.status, 502)
    const noKey = await validateAndPriceIntent(req, clashIntent(), USER_ID, fakeServiceClient(), '', null)
    assert(!noKey.ok)
    assertEquals(noKey.response.status, 500)
  } finally { stubRiot([{ queueType: 'RANKED_SOLO_5x5', tier: 'IRON', rank: 'IV', leaguePoints: 0 }]) }
})

// ── L-18: booster que também é cliente não contrata o próprio pacote de coaching ──
function coachingClient(packageOwnerId: string) {
  const chain = (data: unknown) => {
    const q: Record<string, unknown> = {}
    q.eq = () => q
    q.is = () => q
    q.maybeSingle = () => Promise.resolve({ data, error: null })
    return { select: () => q }
  }
  return {
    from(table: string) {
      if (table === 'services') return chain({ id: SERVICE_ID, game_id: GAME_ID, type: 'coaching', is_active: true })
      if (table === 'games') return chain({ id: GAME_ID, is_active: true })
      if (table === 'booster_services') return chain({ id: PACKAGE_ID, booster_id: packageOwnerId, price: 100, is_active: true, service_type: 'coaching' })
      if (table === 'booster_profiles') return chain({ user_id: packageOwnerId })
      throw new Error(`unexpected table in test stub: ${table}`)
    },
    // deno-lint-ignore no-explicit-any
  } as any
}
const PACKAGE_ID = '44444444-4444-4444-4444-444444444444'
const coachingIntent = {
  service_type: 'coaching', service_id: SERVICE_ID, game_id: GAME_ID, queue_type: 'solo_duo', boost_mode: 'solo', server: 'BR1',
  current_rank: null, target_rank: null, wins_purchased: null, sessions_purchased: 1, booster_service_id: PACKAGE_ID,
}

Deno.test('Coaching: dono do pacote comprando o próprio pacote é rejeitado com 400', async () => {
  const outcome = await validateAndPriceIntent(req, coachingIntent, USER_ID, coachingClient(USER_ID), 'test-key', null)
  assert(!outcome.ok)
  assertEquals(outcome.response.status, 400)
  const body = await outcome.response.clone().json()
  assertEquals(body.error, 'Você não pode contratar o seu próprio pacote')
})

Deno.test('Coaching: pacote de outro booster segue válido', async () => {
  const outcome = await validateAndPriceIntent(req, coachingIntent, USER_ID, coachingClient('55555555-5555-5555-5555-555555555555'), 'test-key', null)
  assert(outcome.ok, 'cliente comum contrata normalmente')
})

// ── Elo declarado pelo cliente (fallback quando a Riot nao acha rank) ──
Deno.test('Clash: sem rank na Riot e rank_declared, aceita o tier escolhido e marca como declarado', async () => {
  stubRiot([])
  try {
    const declared = await validateAndPriceIntent(req, clashIntent({ clash_tier: 'tier_1', rank_declared: true }), USER_ID, fakeServiceClient(), 'test-key', null)
    assert(declared.ok)
    assertEquals(declared.normalized.rankSource, 'client_declared')
    assertEquals(declared.normalized.clashTier, 'tier_1')
  } finally { stubRiot([{ queueType: 'RANKED_SOLO_5x5', tier: 'IRON', rank: 'IV', leaguePoints: 0 }]) }
})

Deno.test('Clash: com rank na Riot o tier da Riot manda (rank_declared e ignorado) e a origem e riot', async () => {
  const forced = await validateAndPriceIntent(req, clashIntent({ clash_tier: 'tier_1', rank_declared: true }), USER_ID, fakeServiceClient(), 'test-key', null)
  assert(!forced.ok, 'conta Ferro nao pode declarar tier_1')
  const ok = await validateAndPriceIntent(req, clashIntent({ clash_tier: 'tier_4', rank_declared: true }), USER_ID, fakeServiceClient(), 'test-key', null)
  assert(ok.ok)
  assertEquals(ok.normalized.rankSource, 'riot')
})

Deno.test('Clash: sem rank e sem rank_declared continua so tier mais baixo (comportamento anterior)', async () => {
  stubRiot([])
  try {
    const out = await validateAndPriceIntent(req, clashIntent({ clash_tier: 'tier_1' }), USER_ID, fakeServiceClient(), 'test-key', null)
    assert(!out.ok)
  } finally { stubRiot([{ queueType: 'RANKED_SOLO_5x5', tier: 'IRON', rank: 'IV', leaguePoints: 0 }]) }
})

function winBoostIntent(overrides: Record<string, unknown> = {}) {
  return {
    service_type: 'win_boost', service_id: SERVICE_ID, game_id: GAME_ID, queue_type: 'solo_duo', boost_mode: 'solo', server: 'BR1',
    current_rank: { tier: 'gold', division: 'IV' }, target_rank: null, current_lp: 20, wins_purchased: 3, sessions_purchased: null,
    addon_codes: [], win_package: null, customer_notes: null, booster_service_id: null, riot_id: 'Fulano#BR1', coupon_code: null,
    customer_lanes: [], ...overrides,
  }
}
const winService = { id: SERVICE_ID, game_id: GAME_ID, type: 'win_boost', is_active: true }

Deno.test('Vitorias: conta sem rank na Riot + rank_declared aceita o elo informado e marca como declarado', async () => {
  stubRiot([])
  try {
    const out = await validateAndPriceIntent(req, winBoostIntent({ rank_declared: true }), USER_ID, fakeServiceClient({ service: winService }), 'test-key', null)
    assert(out.ok)
    assertEquals(out.normalized.rankSource, 'client_declared')
    assertEquals(out.normalized.currentRank, { tier: 'gold', division: 'IV' })
  } finally { stubRiot([{ queueType: 'RANKED_SOLO_5x5', tier: 'IRON', rank: 'IV', leaguePoints: 0 }]) }
})

Deno.test('Vitorias: sem rank na Riot e sem rank_declared continua recusando', async () => {
  stubRiot([])
  try {
    const out = await validateAndPriceIntent(req, winBoostIntent(), USER_ID, fakeServiceClient({ service: winService }), 'test-key', null)
    assert(!out.ok)
    assertEquals(out.response.status, 400)
  } finally { stubRiot([{ queueType: 'RANKED_SOLO_5x5', tier: 'IRON', rank: 'IV', leaguePoints: 0 }]) }
})

Deno.test('Vitorias: rank da Riot sempre vence o declarado (origem riot e elo da Riot)', async () => {
  stubRiot([{ queueType: 'RANKED_SOLO_5x5', tier: 'SILVER', rank: 'II', leaguePoints: 40 }])
  try {
    const out = await validateAndPriceIntent(req, winBoostIntent({ rank_declared: true, current_rank: { tier: 'diamond', division: 'I' } }), USER_ID, fakeServiceClient({ service: winService }), 'test-key', null)
    assert(out.ok)
    assertEquals(out.normalized.rankSource, 'riot')
    assertEquals(out.normalized.currentRank, { tier: 'silver', division: 'II' })
  } finally { stubRiot([{ queueType: 'RANKED_SOLO_5x5', tier: 'IRON', rank: 'IV', leaguePoints: 0 }]) }
})

Deno.test('Vitorias: elo declarado sem divisao (tier com divisao) e recusado', async () => {
  stubRiot([])
  try {
    const out = await validateAndPriceIntent(req, winBoostIntent({ rank_declared: true, current_rank: { tier: 'gold', division: null } }), USER_ID, fakeServiceClient({ service: winService }), 'test-key', null)
    assert(!out.ok)
  } finally { stubRiot([{ queueType: 'RANKED_SOLO_5x5', tier: 'IRON', rank: 'IV', leaguePoints: 0 }]) }
})
