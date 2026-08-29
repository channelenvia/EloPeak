// Roda no runtime Deno (mesmo padrão de orderPricing.test.ts) -- este módulo
// não depende de fetch/Deno.env, só de JSON puro, então não precisa de fakes
// de rede: passamos corpos de resposta match-v5 sintéticos direto pra
// parseMatchDetail.
//   deno test --allow-env supabase/functions/_shared/riotLookup.test.ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { isRemakeMatch, parseMatchDetail } from './riotLookup.ts'

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
