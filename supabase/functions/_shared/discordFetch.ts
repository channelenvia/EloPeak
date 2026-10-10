import { fetchWithTimeout } from './http.ts'

// Cap curto e único retry em 429: sem isso, um envio limitado por taxa é
// logado e perdido pra sempre, já que todo chamador de sendChannelMessage/
// sendDirectMessage é um trigger de cron/webhook fire-and-forget sem caminho
// de retry próprio. Discord manda o tempo de espera tanto no header
// Retry-After quanto no corpo JSON (`retry_after`, em segundos, às vezes
// fracionário) -- tenta o header primeiro, cai pro corpo se ausente.
const MAX_DISCORD_RETRY_SECONDS = 5

export async function fetchDiscordWithRetry(input: string, init: RequestInit): Promise<Response> {
  const res = await fetchWithTimeout(input, init)
  if (res.status !== 429) return res

  let retryAfterSeconds = Number(res.headers.get('retry-after'))
  if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) {
    try {
      const body = await res.clone().json() as { retry_after?: number }
      retryAfterSeconds = Number(body.retry_after)
    } catch {
      retryAfterSeconds = 0
    }
  }
  retryAfterSeconds = Math.min(MAX_DISCORD_RETRY_SECONDS, Math.max(1, retryAfterSeconds || 1))
  await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000))
  return fetchWithTimeout(input, init)
}
