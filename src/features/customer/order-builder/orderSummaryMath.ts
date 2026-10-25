import { applyCoupon, getWinBoostPrice } from '@/lib/pricing'
import { getBoostFlow, isWinPackageAvailable } from '@/lib/boostDomain'
import type { ServiceType, Rank, QueueType, BoostMode } from '@/types'

export const WIN_PACKAGE_DISCOUNTS: Record<number, number> = { 1: 10, 3: 20, 5: 30 }

// Mesma regra de StepExtras.tsx/StepPayment.tsx — Clash reaproveita
// solo_standard/duo_standard pela modalidade, sem currentRank envolvido.
export function resolveBuilderFlow(
  serviceType: ServiceType | null,
  currentRank: Rank | null,
  boostMode: BoostMode,
  queueType: QueueType,
): ReturnType<typeof getBoostFlow> | 'solo_standard' | 'duo_standard' | null {
  if (serviceType === 'elo_boost' && currentRank) return getBoostFlow(currentRank.tier, boostMode, queueType)
  if (serviceType === 'win_boost' || serviceType === 'md5' || serviceType === 'clash') {
    return boostMode === 'duo' ? 'duo_standard' : 'solo_standard'
  }
  return null
}

export interface WinPackageInput {
  winPackage: number | null
  flow: Parameters<typeof isWinPackageAvailable>[0]
  currentRank: Rank | null
  queueType: QueueType
  boostMode: BoostMode
}

// Rascunho antigo pode trazer winPackage no fluxo Master+, onde o servidor o ignora (H-7).
export function getVisibleWinPackage(winPackage: number | null, flow: WinPackageInput['flow']): number | null {
  return winPackage && isWinPackageAvailable(flow) ? winPackage : null
}

export function getWinPackagePrice(visibleWinPackage: number | null, input: WinPackageInput): number {
  if (!visibleWinPackage || !input.currentRank) return 0
  const { currentRank, queueType, boostMode } = input
  return Math.round(
    getWinBoostPrice(queueType, currentRank.tier, boostMode, currentRank.division ?? null)
    * visibleWinPackage
    * (1 - (WIN_PACKAGE_DISCOUNTS[visibleWinPackage] ?? 0) / 100)
    * 100,
  ) / 100
}

// Estimativa de exibição -- o valor cobrado de fato é recomputado no servidor.
export function getSummaryTotals(basePrice: number, extrasPrice: number, couponCode: string | null, serviceType: ServiceType | null) {
  const subtotal = basePrice + extrasPrice
  const coupon = couponCode && serviceType ? applyCoupon(subtotal, couponCode, serviceType) : null
  const discountPrice = coupon?.couponApplied ? coupon.discountPrice : 0
  return { subtotal, coupon, discountPrice, totalPrice: subtotal - discountPrice }
}
