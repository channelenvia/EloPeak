// Roda no runtime Deno com fetch e cliente Supabase falsos:
//   deno test --allow-env --allow-net supabase/functions/_shared/orderMatchSync.test.ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

Deno.env.set('RIOT_API_KEY', 'test-key')
const { syncOrderMatches } = await import('./orderMatchSync.ts')

const ORDER = {
  id: 'order-1', status: 'in_progress', riot_id: 'Foo#BR1', boost_mode: 'solo', queue_type: 'solo_duo',
  match_sync_started_at: '2026-01-01T00:00:00Z', wins_purchased: 5, duo_own_riot_id: null,
  service_type: 'win_boost', current_rank: null, duo_current_rank: null,
}

function fakeClient(rpcCalls: string[]) {
  const builder: Record<string, unknown> = {}
  builder.select = () => builder
  builder.eq = () => builder
  builder.maybeSingle = () => Promise.resolve({ data: null, error: null })
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null })
  return {
    from: () => builder,
    rpc: (name: string) => {
      rpcCalls.push(name)
      return Promise.resolve({ data: { success: true }, error: null })
    },
    // deno-lint-ignore no-explicit-any
  } as any
}

async function withRiot(matchIds: string[], matchBodyStatus: number, run: () => Promise<void>) {
  const original = globalThis.fetch
  globalThis.fetch = (input: string | URL | Request) => {
    const url = String(input)
    const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
    if (url.includes('/accounts/by-riot-id/')) return json({ puuid: 'puuid-1' })
    if (url.includes('/matches/by-puuid/')) return json(matchIds)
    if (url.includes('/lol/match/v5/matches/')) return json({}, matchBodyStatus)
    return json([], 404)
  }
  try { await run() } finally { globalThis.fetch = original }
}

Deno.test('syncOrderMatches — sync completo marca last_match_synced_at', async () => {
  const calls: string[] = []
  await withRiot([], 200, async () => {
    const outcome = await syncOrderMatches(ORDER, fakeClient(calls))
    assertEquals(outcome.body.synced, true)
    assertEquals(calls.includes('mark_order_match_sync'), true)
  })
})

Deno.test('syncOrderMatches — corte por 429 nao marca sync nem diz synced:true (M-4)', async () => {
  const calls: string[] = []
  await withRiot(['BR1_1'], 429, async () => {
    const outcome = await syncOrderMatches(ORDER, fakeClient(calls))
    assertEquals(outcome.status, 200)
    assertEquals(outcome.body.synced, false)
    assertEquals(calls.includes('mark_order_match_sync'), false)
  })
})
