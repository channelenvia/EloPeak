import type { Division, RankTier } from '@/types'
import { RANK_TIER_ORDER } from '@/lib/utils'

const DIVISIONS_ORDER: Division[] = ['IV', 'III', 'II', 'I']

// Sequential step index: Iron IV = 0 … Diamond I = 27, Master = 28, GM = 29, Chall = 30
export function rankStep(tier: RankTier, div: Division | null): number {
  if (tier === 'master') return 28
  if (tier === 'grandmaster') return 29
  if (tier === 'challenger') return 30
  const ti = RANK_TIER_ORDER.indexOf(tier)
  const di = div ? DIVISIONS_ORDER.indexOf(div) : 0
  return ti * 4 + di
}

// ── Elo Boost ────────────────────────────────────────────────────────────────
// Preço por divisão ao ENTRAR em cada tier (BRL)
const ELO_DIV_PRICE: Record<string, number> = {
  iron: 8.50, bronze: 10, silver: 13.50, gold: 17,
  platinum: 24, emerald: 47, diamond: 75,
}

const TIER_NAMES = ['iron','bronze','silver','gold','platinum','emerald','diamond']

function divPriceForStep(step: number): number {
  const ti = Math.min(Math.floor(step / 4), 6)
  return ELO_DIV_PRICE[TIER_NAMES[ti]] ?? 75
}

export function calcEloPrice(
  fTier: RankTier, fDiv: Division | null,
  tTier: RankTier, tDiv: Division | null,
): { price: number; hours: number } {
  const from = rankStep(fTier, fDiv)
  const to   = rankStep(tTier, tDiv)
  if (to <= from) return { price: 0, hours: 0 }

  let price = 0
  for (let s = from + 1; s <= to; s++) price += divPriceForStep(s)

  const hours = Math.max(1, Math.round((to - from) * 1.5))
  return { price: Math.round(price * 100) / 100, hours }
}

// ── Vitória Avulsa (Win Boost) ────────────────────────────────────────────────
// Diamante: varia por divisão (IV=12, III=13, II=15, I=17)
const WIN_PRICE_PER_TIER: Record<string, number | Record<Division, number>> = {
  iron: 3, bronze: 3, silver: 4, gold: 4,
  platinum: 7, emerald: 10,
  diamond: { IV: 12, III: 13, II: 15, I: 17 },
  master: 45, grandmaster: 60, challenger: 100,
}

export function getWinBoostPrice(tier: RankTier, div: Division | null): number {
  const entry = WIN_PRICE_PER_TIER[tier]
  if (typeof entry === 'number') return entry
  if (entry && div && div in entry) return (entry as Record<Division, number>)[div]
  return 12
}

// ── MD5 — 5 Placement Matches ─────────────────────────────────────────────────
export const PLACEMENT_PRICE: Record<string, number> = {
  iron: 15, bronze: 17, silver: 19, gold: 22,
  platinum: 31, emerald: 38, diamond: 42,
  master: 60, grandmaster: 60, challenger: 60,
}

// ── Coaching (mantido igual) ──────────────────────────────────────────────────
export const COACHING_PRICE: Record<number, number> = { 1: 19.99, 2: 34.99 }

// ── Duo Boost — percentual sobre o elo boost ──────────────────────────────────
// Ferro–Esmeralda e Diamante IV>III: +52%
// D III>II: +54% | D II>I: +60%  (implementado como extra fixo +52% na UI)
export const DUO_BOOST_PCT = 52
