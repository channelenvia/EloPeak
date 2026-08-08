// Simple in-memory rate limiter for client-side abuse prevention.
// Does NOT replace server-side rate limiting (Supabase / edge middleware).

const attempts = new Map<string, number[]>()

interface Options {
  windowMs: number  // rolling window in ms
  max: number       // max calls within the window
}

export function checkRateLimit(key: string, opts: Options): boolean {
  const now = Date.now()
  const windowStart = now - opts.windowMs
  const calls = (attempts.get(key) ?? []).filter(t => t > windowStart)
  if (calls.length >= opts.max) return false
  calls.push(now)
  attempts.set(key, calls)
  return true
}

// Convenience presets
export const limits = {
  auth:        { windowMs: 60_000, max: 10 },  // 10 auth attempts / min
  formSubmit:  { windowMs: 30_000, max: 8  },  // 8 form submits / 30s
  rpcMutation: { windowMs: 10_000, max: 20 },  // 20 RPC calls / 10s
}
