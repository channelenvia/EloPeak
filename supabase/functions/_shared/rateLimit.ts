import { supabaseAdmin } from './supabaseAdmin.ts'

// IP heurístico pra rate limit de endpoints públicos (sem sessão): prefere
// cf-connecting-ip (setado pela borda Cloudflare, não forjável pelo cliente),
// cai pro último hop de x-forwarded-for, senão 'unknown'. Nenhum header tem
// garantia formal de origem, mas o pior caso de spoof é só bypass de
// throttle num endpoint público read-only — não é vetor de IDOR/autorização.
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
