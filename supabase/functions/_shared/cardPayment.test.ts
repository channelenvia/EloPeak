//   deno test --allow-env supabase/functions/_shared/cardPayment.test.ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { classifyCardPayment, extractThreeDsInfo } from './cardPayment.ts'

Deno.test('approved é aprovado', () => {
  assertEquals(classifyCardPayment('approved'), 'approved')
})

Deno.test('pending/in_process/authorized aguardam o provedor', () => {
  for (const status of ['pending', 'in_process', 'authorized']) {
    assertEquals(classifyCardPayment(status), 'pending')
  }
})

Deno.test('rejected, cancelled e status desconhecido são recusados', () => {
  for (const status of ['rejected', 'cancelled', 'refunded', 'charged_back', 'algo_novo', undefined, null]) {
    assertEquals(classifyCardPayment(status), 'rejected')
  }
})

Deno.test('extractThreeDsInfo devolve o desafio só quando é pending_challenge com https', () => {
  const info = { external_resource_url: 'https://acs.example.com/challenge', creq: 'abc' }
  assertEquals(extractThreeDsInfo({ status_detail: 'pending_challenge', three_ds_info: info }), info)
  assertEquals(extractThreeDsInfo({ status_detail: 'accredited', three_ds_info: info }), null)
  assertEquals(extractThreeDsInfo({ status_detail: 'pending_challenge', three_ds_info: { ...info, external_resource_url: 'http://x.test' } }), null)
  assertEquals(extractThreeDsInfo({ status_detail: 'pending_challenge', three_ds_info: { external_resource_url: 'https://a.test' } }), null)
  assertEquals(extractThreeDsInfo({ status_detail: 'pending_challenge' }), null)
})
