import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { hasAcceptedCurrentLegal } from './legalGate.ts'

function fakeClient(profile: Record<string, unknown> | null, version: string | null, failProfile = false) {
  return {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: profile, error: failProfile ? { message: 'x' } : null }) }) }) }),
    rpc: () => Promise.resolve({ data: version, error: null }),
  }
}
const ok = { terms_accepted_at: '2026-01-01', privacy_accepted_at: '2026-01-01', legal_version: 'v2' }

Deno.test('aceite vigente passa', async () => assertEquals(await hasAcceptedCurrentLegal(fakeClient(ok, 'v2'), 'u'), true))
Deno.test('versao antiga barra', async () => assertEquals(await hasAcceptedCurrentLegal(fakeClient({ ...ok, legal_version: 'v1' }, 'v2'), 'u'), false))
Deno.test('sem aceite barra', async () => assertEquals(await hasAcceptedCurrentLegal(fakeClient({ ...ok, terms_accepted_at: null }, 'v2'), 'u'), false))
Deno.test('perfil ausente ou erro de leitura barra (falha fechado)', async () => {
  assertEquals(await hasAcceptedCurrentLegal(fakeClient(null, 'v2'), 'u'), false)
  assertEquals(await hasAcceptedCurrentLegal(fakeClient(ok, 'v2', true), 'u'), false)
})
