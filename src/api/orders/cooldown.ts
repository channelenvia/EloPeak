// segundos restantes até `untilEpochMs`, nunca negativo. `nowEpochMs`
// injetado explicitamente pra ser testável sem mockar Date.now().
export function secondsRemaining(untilEpochMs: number | null, nowEpochMs: number): number {
  if (untilEpochMs == null) return 0
  return Math.max(0, Math.ceil((untilEpochMs - nowEpochMs) / 1000))
}
