import { createHmac } from 'node:crypto'
import { constantTimeEqual } from './crypto.ts'

const MAX_AGE_MS = 10 * 60_000
const MAX_FUTURE_SKEW_MS = 60_000

export interface MpSignatureInput {
  secret: string
  xSignature: string | null
  xRequestId: string | null
  dataId: string
  nowMs?: number
}

// Verifica a assinatura do webhook do Mercado Pago (formato v2): "ts=<timestamp>,v1=<hmac>".
// HMAC-SHA256 do manifest `id:<dataId>;request-id:<xRequestId>;ts:<ts>;` com o segredo do webhook;
// recusa assinatura ausente, malformada, adulterada ou fora da janela de tempo (anti-replay).
// Docs: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
export function verifyMpSignature({ secret, xSignature, xRequestId, dataId, nowMs = Date.now() }: MpSignatureInput): boolean {
  if (!secret) return false
  if (!xSignature || !xRequestId) return false

  const parts = Object.fromEntries(xSignature.split(',').map((part) => {
    const [key, value] = part.split('=', 2)
    return [key?.trim(), value?.trim()]
  }))
  const ts = parts['ts']
  const v1 = parts['v1']
  if (!ts || !v1) return false

  const timestamp = Number(ts)
  if (!Number.isFinite(timestamp)) return false
  const timestampMs = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp
  const ageMs = nowMs - timestampMs
  if (ageMs < -MAX_FUTURE_SKEW_MS || ageMs > MAX_AGE_MS) return false

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`
  const expected = createHmac('sha256', secret).update(manifest).digest('hex')

  return constantTimeEqual(expected, v1)
}
