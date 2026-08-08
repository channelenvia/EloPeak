import { useState } from 'react'
import { cn, RANK_TIER_LABEL, RANK_TIER_COLOR } from '@/lib/utils'
import { isRankLocked, tierHasDivisions } from '@/lib/boostDomain'
import { riotRankEmblemUrl } from '@/lib/riotAssets'
import type { Division, RankTier } from '@/types'
import { Shield, Star, Gem, Diamond, Crown, Flame } from 'lucide-react'

const DIVISIONS: Division[] = ['IV', 'III', 'II', 'I']

const TIER_IMAGE: Record<RankTier, string> = {
  iron: '/ranks/1_iron.webp', bronze: '/ranks/2_bronze.webp', silver: '/ranks/3_silver.webp',
  gold: '/ranks/4_gold.webp', platinum: '/ranks/5_platinum.webp', emerald: '/ranks/6_emerald.webp',
  diamond: '/ranks/7_diamond.webp', master: '/ranks/8_master.webp',
  grandmaster: '/ranks/9_grandmaster.webp', challenger: '/ranks/10_challenger.webp',
}
const TIER_FALLBACK: Record<RankTier, React.ElementType> = {
  iron: Shield, bronze: Shield, silver: Star, gold: Star, platinum: Gem,
  emerald: Gem, diamond: Diamond, master: Crown, grandmaster: Flame, challenger: Flame,
}

interface RankLockGridProps {
  current: { tier: RankTier; division: Division | null } | null
  selectedTier: RankTier | null
  selectedDivision: Division | null
  onChange: (tier: RankTier, division: Division | null) => void
  /** All 10 tiers, always — callers must never pre-filter this. */
  tiers: readonly RankTier[]
  /** When true, every tier/division button is disabled regardless of lock
   * state — used to lock the grid after a successful Riot auto-fill. */
  disabled?: boolean
}

// live (Community Dragon) -> local (public/ranks/*.webp) -> ícone lucide —
// mesmo padrão de fallback do RankBadge.
type ImageStage = 'live' | 'local' | 'icon'

function TierButton({ tier, isSelected, isLocked, onClick }: {
  tier: RankTier; isSelected: boolean; isLocked: boolean; onClick: () => void
}) {
  const [stage, setStage] = useState<ImageStage>('live')
  const FallbackIcon = TIER_FALLBACK[tier]
  return (
    <button
      type="button"
      disabled={isLocked}
      onClick={onClick}
      title={isLocked ? 'Rank já alcançado ou abaixo do atual' : undefined}
      className={cn(
        'flex flex-col items-center justify-center gap-1 py-2.5 px-1 rounded-xl border-2 transition-all focus:outline-none',
        isSelected ? 'border-brand bg-brand/10'
          : isLocked ? 'border-transparent bg-transparent opacity-30 cursor-not-allowed'
            : 'border-bg-elevated bg-bg-card hover:border-brand/30 hover:bg-bg-elevated/40',
      )}
    >
      {stage !== 'icon' ? (
        <img
          src={stage === 'live' ? riotRankEmblemUrl(tier) : TIER_IMAGE[tier]}
          alt={RANK_TIER_LABEL[tier]}
          onError={() => setStage((s) => s === 'live' ? 'local' : 'icon')}
          className="w-8 h-8 object-contain" draggable={false}
        />
      ) : (
        <FallbackIcon className={cn('w-7 h-7', RANK_TIER_COLOR[tier])} />
      )}
      <span className={cn('text-[8px] font-semibold text-center leading-none', isSelected ? 'text-brand' : 'text-ink-secondary')}>
        {RANK_TIER_LABEL[tier]}
      </span>
    </button>
  )
}

export function RankLockGrid({ current, selectedTier, selectedDivision, onChange, tiers, disabled }: RankLockGridProps) {
  function handleTier(tier: RankTier) {
    if (disabled) return
    if (tierHasDivisions(tier)) {
      // Pick the first unlocked division for this tier, defaulting to IV.
      const firstOpen = DIVISIONS.find((d) => !isRankLocked({ tier, division: d }, current)) ?? 'IV'
      onChange(tier, firstOpen)
      return
    }
    if (isRankLocked({ tier, division: null }, current)) return
    onChange(tier, null)
  }

  const validDivisions = selectedTier && tierHasDivisions(selectedTier) ? DIVISIONS : []

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-5 gap-1">
        {tiers.map((tier) => (
          <TierButton
            key={tier}
            tier={tier}
            isSelected={selectedTier === tier}
            // rankStep is monotonic within a tier (I is always the highest
            // division) — a tier is fully locked exactly when its highest
            // division is locked, no need to also check the lowest.
            isLocked={disabled || isRankLocked(
              { tier, division: tierHasDivisions(tier) ? 'I' : null },
              current,
            )}
            onClick={() => handleTier(tier)}
          />
        ))}
      </div>
      {selectedTier && validDivisions.length > 0 && (
        <div className="flex gap-1.5">
          {validDivisions.map((div) => {
            const locked = disabled || isRankLocked({ tier: selectedTier, division: div }, current)
            return (
              <button
                key={div}
                type="button"
                disabled={locked}
                onClick={() => !disabled && onChange(selectedTier, div)}
                className={cn(
                  'flex-1 py-1.5 rounded-lg text-xs font-bold border-2 transition-all',
                  selectedDivision === div ? 'border-brand bg-brand text-white'
                    : locked ? 'border-transparent opacity-30 cursor-not-allowed'
                      : 'border-bg-elevated bg-bg-card text-ink-secondary hover:border-brand/30',
                )}
              >
                {div}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
