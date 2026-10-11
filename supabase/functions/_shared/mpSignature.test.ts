// deno test --allow-env supabase/functions/_shared/mpSignature.test.ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { createHmac } from 'node:crypto'
import { verifyMpSignature } from './mpSignature.ts'

const SECRET = 'segredo-de-teste'
const NOW = 1_800_000_000_000

function sign(dataId: string, requestId: string, ts: number, secret = SECRET): string {
  const v1 = createHmac('sha256', secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex')
  return `ts=${ts},v1=${v1}`
}

Deno.test('verifyMpSignature — assinatura valida passa', () => {
  const ts = NOW - 5_000
  assertEquals(verifyMpSignature({ secret: SECRET, xSignature: sign('123', 'req-1', ts), xRequestId: 'req-1', dataId: '123', nowMs: NOW }), true)
})

Deno.test('verifyMpSignature — segredo errado, id adulterado e request-id diferente falham', () => {
  const ts = NOW - 5_000
  const header = sign('123', 'req-1', ts)
  assertEquals(verifyMpSignature({ secret: 'outro', xSignature: header, xRequestId: 'req-1', dataId: '123', nowMs: NOW }), false)
  assertEquals(verifyMpSignature({ secret: SECRET, xSignature: header, xRequestId: 'req-1', dataId: '999', nowMs: NOW }), false)
  assertEquals(verifyMpSignature({ secret: SECRET, xSignature: header, xRequestId: 'req-2', dataId: '123', nowMs: NOW }), false)
})

Deno.test('verifyMpSignature — replay antigo e timestamp no futuro falham', () => {
  const old = NOW - 11 * 60_000
  assertEquals(verifyMpSignature({ secret: SECRET, xSignature: sign('1', 'r', old), xRequestId: 'r', dataId: '1', nowMs: NOW }), false)
  const future = NOW + 2 * 60_000
  assertEquals(verifyMpSignature({ secret: SECRET, xSignature: sign('1', 'r', future), xRequestId: 'r', dataId: '1', nowMs: NOW }), false)
})

Deno.test('verifyMpSignature — cabecalhos ausentes/malformados e segredo vazio falham', () => {
  const ts = NOW - 1_000
  assertEquals(verifyMpSignature({ secret: SECRET, xSignature: null, xRequestId: 'r', dataId: '1', nowMs: NOW }), false)
  assertEquals(verifyMpSignature({ secret: SECRET, xSignature: sign('1', 'r', ts), xRequestId: null, dataId: '1', nowMs: NOW }), false)
  assertEquals(verifyMpSignature({ secret: SECRET, xSignature: 'lixo', xRequestId: 'r', dataId: '1', nowMs: NOW }), false)
  assertEquals(verifyMpSignature({ secret: '', xSignature: sign('1', 'r', ts, ''), xRequestId: 'r', dataId: '1', nowMs: NOW }), false)
})

Deno.test('verifyMpSignature — ts em segundos tambem e aceito', () => {
  const tsSeconds = Math.floor((NOW - 2_000) / 1000)
  assertEquals(verifyMpSignature({ secret: SECRET, xSignature: sign('7', 'r', tsSeconds), xRequestId: 'r', dataId: '7', nowMs: NOW }), true)
})
