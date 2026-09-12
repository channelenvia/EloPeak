import { corsHeaders } from './cors.ts'

export function jsonResponse(req: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

// `code` era aceito como 4º argumento em várias chamadas (discord-join-server)
// mas nunca existiu no corpo da resposta — JS descarta argumentos extras
// silenciosamente, então invokeEdgeFunction.extractCode() nunca achava nada e
// as mensagens específicas por código (DISCORD_TOKEN_EXPIRED etc.) nunca
// apareciam pro usuário, sempre caindo no fallback genérico.
export function errorResponse(req: Request, message: string, status = 400, code?: string, details?: Record<string, unknown>): Response {
  return jsonResponse(req, { error: message, ...(code ? { code } : {}), ...details }, status)
}

export function rateLimitResponse(req: Request, retryAfter: number): Response {
  const response = jsonResponse(req, { error: 'Too many requests' }, 429)
  response.headers.set('Retry-After', String(Math.max(1, Math.ceil(retryAfter))))
  return response
}
