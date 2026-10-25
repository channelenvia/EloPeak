export const clamp = (v: number, min = 0, max = 1): number => Math.min(max, Math.max(min, v))

/** Interpolação por trechos: mapRange(p, [0, .4, 1], [0, 100, 50]) sobe a 100 até .4 e volta a 50. */
export function mapRange(p: number, ins: readonly number[], outs: readonly number[]): number {
  if (p <= ins[0]) return outs[0]
  for (let i = 1; i < ins.length; i++) {
    if (p <= ins[i]) return outs[i - 1] + ((outs[i] - outs[i - 1]) * (p - ins[i - 1])) / (ins[i] - ins[i - 1])
  }
  return outs[outs.length - 1]
}

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
