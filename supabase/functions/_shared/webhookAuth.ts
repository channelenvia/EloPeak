import { constantTimeEqual } from './crypto.ts'
import { jsonResponse, rateLimitResponse } from './responses.ts'
import { HttpError, readJsonBody } from './http.ts'
import { consumeUserRateLimit } from './rateLimit.ts'

// Boilerplate comum às edge functions acionadas só por um trigger interno
// (pg_net -> header x-webhook-secret, nunca por um usuário logado):
// confirma método POST, o secret compartilhado, aplica rate limit e lê o
// corpo JSON bruto. `scope` isola o balde de consume_edge_rate_limit por
// function chamadora (ver rateLimit.ts/consume_edge_rate_limit -- a chave é
// o par scope+subject) -- funções diferentes passando o mesmo `subject`
// 'database-webhook' NÃO competem pelo mesmo balde, cada uma com seu limite
// próprio. Cada caller ainda valida o schema específico do seu payload
// depois de chamar isto (o corpo aqui só é lido e parseado como JSON).
export interface WebhookAuthOptions {
  scope: string
  webhookSecret: string
  maxBytes?: number
  limit?: number
  windowSeconds?: number
}

export type WebhookAuthResult =
  | { ok: true; rawBody: unknown }
  | { ok: false; response: Response }

export async function verifyWebhookRequest(req: Request, opts: WebhookAuthOptions): Promise<WebhookAuthResult> {
  if (req.method !== 'POST') {
    return { ok: false, response: new Response('Method Not Allowed', { status: 405 }) }
  }
  if (!opts.webhookSecret) {
    return { ok: false, response: new Response('Server misconfigured', { status: 500 }) }
  }

  const receivedSecret = req.headers.get('x-webhook-secret') ?? ''
  if (!constantTimeEqual(receivedSecret, opts.webhookSecret)) {
    return { ok: false, response: new Response('Unauthorized', { status: 401 }) }
  }

  const rateLimit = await consumeUserRateLimit(opts.scope, 'database-webhook', opts.limit ?? 120, opts.windowSeconds ?? 60)
  if (!rateLimit.allowed) {
    // O trigger que chama isso é fire-and-forget via net.http_post (sem
    // retry) -- sem este log, um 429 aqui derrubava o evento (mensagem de
    // review/chat/pedido no Discord) sem deixar rastro nenhum pra investigar.
    console.error(`webhook rate limited: scope=${opts.scope} retryAfter=${rateLimit.retryAfter}s`)
    return { ok: false, response: rateLimitResponse(req, rateLimit.retryAfter) }
  }

  try {
    const rawBody = await readJsonBody(req, opts.maxBytes ?? 8 * 1024)
    return { ok: true, rawBody }
  } catch (err) {
    if (err instanceof HttpError) return { ok: false, response: jsonResponse(req, { error: err.message }, err.status) }
    return { ok: false, response: jsonResponse(req, { error: 'invalid request' }, 400) }
  }
}
