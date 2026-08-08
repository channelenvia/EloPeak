import { supabaseAdmin } from './supabaseAdmin.ts'

// Extração de IP pra rate limit de endpoints públicos (sem sessão) — a
// única forma de escopar o throttle é por IP, e nenhum dos dois headers
// disponíveis nas Supabase Edge Functions vem com garantia formal de que só
// o proxy confiável consegue setá-los (não há uma lista documentada de
// proxies confiáveis pra validar contra, ao contrário de um app Express
// atrás de um load balancer conhecido). Por isso a ordem de preferência é
// heurística, não uma prova de origem:
//   1. cf-connecting-ip — quando presente, é setado pela borda da Cloudflare
//      e sobrescrito por ela mesma, então não é livremente forjável pelo
//      cliente que faz a chamada.
//   2. Último valor de x-forwarded-for (o hop mais próximo do nosso proxy)
//      — o próprio cliente controla o PRIMEIRO valor dessa lista (pode
//      anexar qualquer coisa), mas não consegue sobrescrever o que o hop
//      final adiciona.
//   3. 'unknown' — colapsa todo tráfego sem IP identificável num único
//      balde de rate limit; aceitável porque essa função só protege
//      endpoints públicos de baixo risco (throttle de custo/invocação, não
//      controle de acesso) contra flood trivial, nunca autorização.
// Pior caso de um spoof bem-sucedido: bypass do throttle num endpoint
// público read-only e cacheado — não é um vetor pra IDOR, vazamento de
// segredo ou escrita não autorizada, então essa heurística é aceitável sem
// validar contra uma lista de proxies confiáveis.
export function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get('x-forwarded-for')?.split(',').map((v) => v.trim()).filter(Boolean) ?? []
  return req.headers.get('cf-connecting-ip')
    || forwardedFor[forwardedFor.length - 1]
    || 'unknown'
}

export async function consumeUserRateLimit(
  scope: string,
  userId: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; retryAfter: number }> {
  const { data, error } = await supabaseAdmin().rpc('consume_edge_rate_limit', {
    p_scope: scope,
    p_subject: userId,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  })
  if (error) throw new Error('Rate limit unavailable')
  const result = data as { allowed?: boolean; retry_after?: number } | null
  return {
    allowed: result?.allowed === true,
    retryAfter: Math.max(1, Number(result?.retry_after ?? windowSeconds)),
  }
}
