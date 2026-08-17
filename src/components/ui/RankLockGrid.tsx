import { cn, RANK_TIER_LABEL } from '@/lib/utils'
import { isRankLocked, tierHasDivisions } from '@/lib/boostDomain'
import type { Division, RankTier } from '@/types'
import { SelectableTile } from './SelectableTile'
import { RankIcon } from './RankBadge'

const DIVISIONS: Division[] = ['IV', 'III', 'II', 'I']

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

// Fallback de imagem (live -> local -> ícone) agora vem do RankIcon
// compartilhado (RankBadge.tsx) — antes reimplementado aqui em paralelo.
function TierButton({ tier, isSelected, isLocked, onClick }: {
  tier: RankTier; isSelected: boolean; isLocked: boolean; onClick: () => void
}) {
  return (
    <SelectableTile
      size="tile"
      selected={isSelected}
      tinted
      locked={isLocked}
      onClick={onClick}
      title={isLocked ? 'Rank já alcançado ou abaixo do atual' : undefined}
    >
      <RankIcon tier={tier} imgClass="w-8 h-8" iconClass="w-7 h-7" />
      <span className={cn('text-[8px] font-semibold text-center leading-none', isSelected ? 'text-brand' : 'text-ink-secondary')}>
        {RANK_TIER_LABEL[tier]}
      </span>
    </SelectableTile>
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
              <SelectableTile
                key={div}
                size="sm"
                className="flex-1 rounded-lg"
                selected={selectedDivision === div}
                locked={locked}
                onClick={() => !disabled && onChange(selectedTier, div)}
              >
                {div}
              </SelectableTile>
            )
          })}
        </div>
      )}
    </div>
  )
}
