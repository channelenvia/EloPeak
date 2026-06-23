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
  iron: 8.50, bronze: 9.90, silver: 13.50, gold: 16.90,
  platinum: 23.90, emerald: 46.90, diamond: 74.90,
}

export const ELO_TIERS: { tier: RankTier; perDiv: number }[] = [
  { tier: 'iron',     perDiv: 8.50  },
  { tier: 'bronze',   perDiv: 9.90  },
  { tier: 'silver',   perDiv: 13.50 },
  { tier: 'gold',     perDiv: 16.90 },
  { tier: 'platinum', perDiv: 23.90 },
  { tier: 'emerald',  perDiv: 46.90 },
  { tier: 'diamond',  perDiv: 74.90 },
]

const TIER_NAMES = ['iron','bronze','silver','gold','platinum','emerald','diamond']

function divPriceForStep(step: number): number {
  const ti = Math.min(Math.floor(step / 4), 6)
  return ELO_DIV_PRICE[TIER_NAMES[ti]] ?? 74.90
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
// Diamante: varia por divisão
const WIN_PRICE_PER_TIER: Record<string, number | Record<Division, number>> = {
  iron: 2.90, bronze: 2.90, silver: 3.90, gold: 3.90,
  platinum: 6.90, emerald: 9.90,
  diamond: 15.90,
  master: 44.90, grandmaster: 59.90, challenger: 99.90,
}

export function getWinBoostPrice(tier: RankTier, _div: Division | null): number {
  const entry = WIN_PRICE_PER_TIER[tier]
  if (typeof entry === 'number') return entry
  return 15.90
}

// ── MD5 — 5 Placement Matches ─────────────────────────────────────────────────
export const PLACEMENT_PRICE: Record<string, number> = {
  iron: 14.90, bronze: 16.90, silver: 18.90, gold: 21.90,
  platinum: 30.90, emerald: 37.90, diamond: 41.90,
  master: 59.90, grandmaster: 59.90, challenger: 59.90,
}

// ── Coaching — valor a combinar por sessão ────────────────────────────────────
// Não tem preço fixo: o booster define o valor com o cliente.
export const COACHING_PRICE_NEGOTIABLE = true

// ── Duo Boost — percentual sobre o elo boost ──────────────────────────────────
// Ferro–Esmeralda e Diamante IV>III: +52%
// D III>II: +54% | D II>I: +60%  (implementado como extra fixo +52% na UI)
export const DUO_BOOST_PCT = 50

// ── Master+ LP-based pricing ──────────────────────────────────────────────────
// Mestre, Grão-Mestre e Desafiante são medidos em LP (sem divisões)
const MASTER_LP_RATE: Record<string, number> = {
  master: 0.45,
  grandmaster: 0.75,
  challenger: 1.20,
}

export function calcMasterPlusPrice(tier: RankTier, currentLp: number, targetLp: number): number {
  const rate = MASTER_LP_RATE[tier] ?? 0.45
  return Math.max(0, Math.round((targetLp - currentLp) * rate * 100) / 100)
}

// ── LP Modifier for Iron–Diamond ──────────────────────────────────────────────
// LP progress in current division → reduces first-div cost
// Win-rate estimate (avgGain / total) → efficiency multiplier (±10%)
export function applyLpModifier(
  basePrice: number,
  fTier: RankTier,
  currentLp: number,
  avgLpGain: number,
  avgLpLoss: number,
): number {
  if (basePrice <= 0) return 0
  const divPrice = ELO_DIV_PRICE[fTier] ?? 0
  const lpDiscount = (currentLp / 100) * divPrice
  const total = avgLpGain + avgLpLoss
  const winRate = total > 0 ? avgLpGain / total : 0.5
  const efficiencyMod = 1 + (0.5 - winRate) * 0.15
  return Math.max(0, Math.round((basePrice - lpDiscount) * efficiencyMod * 100) / 100)
}
