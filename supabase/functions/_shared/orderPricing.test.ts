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

Deno.test('Clash Solo tier_4 -- preço final bate com a tabela fixa (R$26,00), sem cupom', async () => {
  const outcome = await validateAndPriceIntent(req, clashIntent(), USER_ID, fakeServiceClient(), '', null)
  assert(outcome.ok, `esperava sucesso, veio erro: ${!outcome.ok ? await outcome.response.clone().text() : ''}`)
  assertEquals(outcome.priced.totalPrice, 26)
  assertEquals(outcome.priced.couponApplied, false)
  assertEquals(outcome.normalized.clashTier, 'tier_4')
  assertEquals(outcome.normalized.clashDay, 'saturday')
  assertEquals(outcome.normalized.riotId, 'Fulano#BR1')
})

Deno.test('Clash sem riot_id é rejeitado (obrigatório nos dois modos -- Solo referencia o booster, Duo identifica o cliente pro time)', async () => {
  const { riot_id: _riotId, ...withoutRiotId } = clashIntent()
  const outcome = await validateAndPriceIntent(req, withoutRiotId, USER_ID, fakeServiceClient(), '', null)
  assert(!outcome.ok)
  assertEquals(outcome.response.status, 400)
})

Deno.test('Clash Duo mantém riot_id no normalized igual ao Solo', async () => {
  const outcome = await validateAndPriceIntent(
    req, clashIntent({ boost_mode: 'duo', riot_id: 'Cliente#BR2' }), USER_ID, fakeServiceClient(), '', null,
  )
  assert(outcome.ok, `esperava sucesso, veio erro: ${!outcome.ok ? await outcome.response.clone().text() : ''}`)
  assertEquals(outcome.normalized.riotId, 'Cliente#BR2')
})

Deno.test('Clash Duo tier_4 -- preço final bate com a tabela fixa (R$77,87)', async () => {
  const outcome = await validateAndPriceIntent(req, clashIntent({ boost_mode: 'duo' }), USER_ID, fakeServiceClient(), '', null)
  assert(outcome.ok)
  assertEquals(outcome.priced.totalPrice, 77.87)
  assertEquals(outcome.normalized.boostMode, 'duo')
})

Deno.test('Clash sem current_rank/current_lp no intent (cliente antigo) normaliza pra null/0, sem quebrar nem mudar o preço', async () => {
  const outcome = await validateAndPriceIntent(req, clashIntent(), USER_ID, fakeServiceClient(), '', null)
  assert(outcome.ok)
  assertEquals(outcome.normalized.currentRank, null)
  assertEquals(outcome.normalized.currentLp, 0)
  assertEquals(outcome.priced.totalPrice, 26)
})

Deno.test('Clash com current_rank/current_lp reais (rank capturado na consulta à Riot) é persistido no normalized, sem afetar o preço (que segue vindo só do tier)', async () => {
  const outcome = await validateAndPriceIntent(
    req,
    clashIntent({ current_rank: { tier: 'gold', division: 'II' }, current_lp: 45 }),
    USER_ID, fakeServiceClient(), '', null,
  )
  assert(outcome.ok, `esperava sucesso, veio erro: ${!outcome.ok ? await outcome.response.clone().text() : ''}`)
  assertEquals(outcome.normalized.currentRank, { tier: 'gold', division: 'II' })
  assertEquals(outcome.normalized.currentLp, 45)
  assertEquals(outcome.priced.totalPrice, 26)
})

Deno.test('Cupom ELOPEAK30 aplica 30% de desconto no Clash (regressão -- Clash só entrou na whitelist de elegibilidade nesta rodada de auditoria)', async () => {
  const outcome = await validateAndPriceIntent(
    req, clashIntent({ coupon_code: 'ELOPEAK30' }), USER_ID, fakeServiceClient(), '', null,
  )
  assert(outcome.ok)
  assertEquals(outcome.priced.couponApplied, true)
  assertEquals(outcome.priced.discountPct, 30)
  // 26 * 0.30 = 7.80 de desconto -> total 18.20
  assertEquals(outcome.priced.totalPrice, 18.2)
})

Deno.test('Cupom com código desconhecido não aplica desconto, mas não é erro (segue sem desconto)', async () => {
  const outcome = await validateAndPriceIntent(
    req, clashIntent({ coupon_code: 'NAOEXISTE' }), USER_ID, fakeServiceClient(), '', null,
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
    req, clashIntent({ addon_codes: ['priority'] }), USER_ID, fakeServiceClient({ extras }), '', null,
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
    req, clashIntent({ addon_codes: ['mono_champ'] }), USER_ID, fakeServiceClient({ extras }), '', null,
  )
  assert(!outcome.ok)
  assertEquals(outcome.response.status, 400)
})

Deno.test('Duo Clash aceita duo_voice mas rejeita undetectable_duo (fora do subconjunto do Clash)', async () => {
  const extras: ExtraRow[] = [
    { id: 'extra-3', code: 'undetectable_duo', name: 'Duo Indetectável', price_modifier: 0, price_modifier_pct: 15, sort_order: 1 },
  ]
  const outcome = await validateAndPriceIntent(
    req, clashIntent({ boost_mode: 'duo', addon_codes: ['undetectable_duo'] }), USER_ID, fakeServiceClient({ extras }), '', null,
  )
  assert(!outcome.ok)
  assertEquals(outcome.response.status, 400)
})

Deno.test('Addon inexistente/inativo no catálogo é rejeitado com 400', async () => {
  const outcome = await validateAndPriceIntent(
    req, clashIntent({ addon_codes: ['nao_existe'] }), USER_ID, fakeServiceClient({ extras: [] }), '', null,
  )
  assert(!outcome.ok)
  assertEquals(outcome.response.status, 400)
})

Deno.test('clash_day fora do enum (schema) é rejeitado antes de qualquer chamada ao banco', async () => {
  const outcome = await validateAndPriceIntent(
    req, clashIntent({ clash_day: 'monday' }), USER_ID, fakeServiceClient(), '', null,
  )
  assert(!outcome.ok)
  assertEquals(outcome.response.status, 400)
  const body = await outcome.response.clone().json()
  assertEquals(body.error, 'Body inválido')
})

Deno.test('service_id inexistente no catálogo (maybeSingle = null) é rejeitado com 400, sem lançar exceção', async () => {
  const outcome = await validateAndPriceIntent(
    req, clashIntent(), USER_ID, fakeServiceClient({ service: null }), '', null,
  )
  assert(!outcome.ok)
  assertEquals(outcome.response.status, 400)
})

Deno.test('service_type do catálogo divergente do intent (ex.: services.type != clash) é rejeitado', async () => {
  const outcome = await validateAndPriceIntent(
    req, clashIntent(), USER_ID,
    fakeServiceClient({ service: { id: SERVICE_ID, game_id: GAME_ID, type: 'elo_boost', is_active: true } }),
    '', null,
  )
  assert(!outcome.ok)
  assertEquals(outcome.response.status, 400)
})
