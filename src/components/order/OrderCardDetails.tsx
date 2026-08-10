import { ArrowRight, Hash } from 'lucide-react'
import { RankBadge } from '@/components/ui'
import { formatRank, sortOrderExtras } from '@/lib/utils'
import { CLASH_DAY_LABEL, CLASH_TIER_BOUNDARY_RANKS, getClashDateParts } from '@/lib/clashDomain'
import type { Division, Order, RankTier } from '@/types'

interface OrderCardDetailsProps {
  order: Order
}

// Bloco de detalhes reaproveitado por todo card-resumo de pedido (cliente,
// booster, jobs disponíveis): rank atual → objetivo (com histórico de drop se
// houver), vitórias restantes, dia/tier do Clash, Riot ID e extras. Fonte
// única pra esses campos ficarem sempre em sincronia visual entre os papéis.
export function OrderCardDetails({ order }: OrderCardDetailsProps) {
  const currentRank = order.current_rank as { tier: RankTier; division: Division | null } | null
  const targetRank = order.target_rank as { tier: RankTier; division: Division | null } | null
  const hasWinProgress = order.wins_purchased != null
  const dropRank = order.drop_count > 0 ? (order.rank_before_last_drop as { tier: RankTier; division: Division } | null) : null

  return (
    <>
      {currentRank && targetRank && (
        <div className="flex items-center gap-2 mb-3">
          {dropRank && (
            <>
              <RankBadge tier={dropRank.tier} division={dropRank.division} size="xs" showLabel={false} />
              <span className="text-xs font-medium text-ink-muted line-through">
                {formatRank(dropRank.tier, dropRank.division)}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-ink-muted shrink-0" />
            </>
          )}
          <RankBadge tier={currentRank.tier} division={currentRank.division} size="xs" showLabel={false} />
          <ArrowRight className="h-3.5 w-3.5 text-ink-muted shrink-0" />
          <RankBadge tier={targetRank.tier} division={targetRank.division} size="xs" showLabel={false} />
          <span className="text-xs text-ink-secondary">
            {formatRank(currentRank.tier, currentRank.division)} → {formatRank(targetRank.tier, targetRank.division)}
          </span>
        </div>
      )}

      {hasWinProgress && (
        <div className="flex items-center gap-2 mb-3">
          {currentRank && <RankBadge tier={currentRank.tier} division={currentRank.division} size="xs" showLabel={false} />}
          <ArrowRight className="h-3.5 w-3.5 text-ink-muted shrink-0" />
          <span className="text-xs text-ink-secondary">
            <span className="font-bold text-ink" data-tabular>{Math.max(0, (order.wins_purchased ?? 0) - order.wins_played)}</span> vitórias restantes
          </span>
        </div>
      )}

      {order.service_type === 'clash' && order.clash_tier && (
        <div className="flex items-center gap-2 mb-3 text-xs text-ink-secondary">
          <RankBadge tier={CLASH_TIER_BOUNDARY_RANKS[order.clash_tier].high} division={null} size="xs" showLabel={false} />
          <ArrowRight className="h-3.5 w-3.5 text-ink-muted shrink-0" />
          {order.clash_day && (() => {
            const { day, month } = getClashDateParts(order.created_at, order.clash_day)
            return (
              <span className="font-medium text-ink" data-tabular>
                {day}/{month} · {CLASH_DAY_LABEL[order.clash_day]}
              </span>
            )
          })()}
        </div>
      )}

      {order.riot_id && (
        <div className="flex items-center gap-1.5 mb-3 text-xs text-ink-secondary">
          <Hash className="h-3 w-3 shrink-0 text-ink-muted" />
          <span>Riot ID: <span className="font-medium text-ink">{order.riot_id}</span></span>
        </div>
      )}

      {order.extras?.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {sortOrderExtras(order.extras).map((extra) => (
            <span key={extra.extra_id} className="text-[9px] font-medium bg-bg-elevated text-ink-secondary px-1.5 py-0.5 rounded-md">
              {extra.name}
            </span>
          ))}
        </div>
      )}
    </>
  )
}
