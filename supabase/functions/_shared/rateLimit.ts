import { supabaseAdmin } from './supabaseAdmin.ts'

// IP heurístico pra rate limit de endpoints públicos (sem sessão): usa o
// último hop de x-forwarded-for, que é o único IP dessa cadeia setado pelo
// próprio gateway de edge functions do Supabase (não pelo cliente) — o
// cliente controla os hops anteriores da lista, mas não consegue sobrescrever
// o último. Não usamos cf-connecting-ip: não há Cloudflare configurado em
// nenhum lugar deste repo pra garantir que esse header vem de uma borda CF
// de verdade, então um cliente pode simplesmente enviá-lo forjado e pular
// o rate limit por IP inteiro. Nenhum header tem garantia formal de origem
// além do último hop de XFF, mas o pior caso de spoof é só bypass de
// throttle num endpoint público read-only — não é vetor de IDOR/autorização.
export function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get('x-forwarded-for')?.split(',').map((v) => v.trim()).filter(Boolean) ?? []
  return forwardedFor[forwardedFor.length - 1] || 'unknown'
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
