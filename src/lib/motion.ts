const STAGGER_STEP_MS = 40
const STAGGER_MAX_ITEMS = 7

/** Atraso de entrada em escada (animate-rise): 40ms por item, travado em 7 passos (280ms) para listas longas não demorarem. */
export function staggerStyle(index: number): { animationDelay: string } {
  return { animationDelay: `${Math.min(index, STAGGER_MAX_ITEMS) * STAGGER_STEP_MS}ms` }
}
