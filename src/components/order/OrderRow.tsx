import { Link } from 'react-router-dom'
import { Zap, ArrowRight, Hash } from 'lucide-react'
import { Card, OrderStatusBadge, RankBadge } from '@/components/ui'
import { timeAgo } from '@/lib/utils'
import { CLASH_DAY_LABEL, CLASH_TIER_BOUNDARY_RANKS, getClashDateParts } from '@/lib/clashDomain'
import type { Order, RankTier, Division } from '@/types'

interface OrderRowProps {
  order: Order
  currency: (amount: number) => string
  subtitle?: string
  showIcon?: boolean
}

export function OrderRow({ order, currency, subtitle, showIcon = true }: OrderRowProps) {
  const currentRank = order.current_rank as { tier: RankTier; division: Division | null } | null
  const targetRank = order.target_rank as { tier: RankTier; division: Division | null } | null
  const hasWinProgress = order.wins_purchased != null

  return (
    <Link to={`/orders/${order.id}`}>
      <Card className="flex items-center justify-between gap-4 hover:border-brand/20 hover:shadow-card-hover transition-all duration-150 cursor-pointer">
        <div className="flex items-center gap-4 min-w-0">
          {showIcon && (
            <div className="h-10 w-10 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
              <Zap className="h-5 w-5 text-brand" />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <p className="text-sm font-semibold text-ink truncate">
                #{order.id.slice(0, 8).toUpperCase()}
              </p>
              {subtitle && <span className="hidden sm:block text-xs text-ink-muted">{subtitle}</span>}
            </div>
            <div className="flex items-center gap-2">
              <p className="text-xs text-ink-muted">{timeAgo(order.created_at)}</p>
              {currentRank && targetRank && (
                <div className="hidden md:flex items-center gap-1">
                  <RankBadge tier={currentRank.tier} division={currentRank.division} size="xs" showLabel={false} />
                  <ArrowRight className="h-3 w-3 text-ink-muted" />
                  <RankBadge tier={targetRank.tier} division={targetRank.division} size="xs" showLabel={false} />
                </div>
              )}
              {hasWinProgress && (
                <div className="hidden md:flex items-center gap-1">
                  {currentRank && <RankBadge tier={currentRank.tier} division={currentRank.division} size="xs" showLabel={false} />}
                  <ArrowRight className="h-3 w-3 text-ink-muted" />
                  <span className="text-xs font-bold text-ink" data-tabular>
                    {Math.max(0, (order.wins_purchased ?? 0) - order.wins_played)}
                  </span>
                  <span className="text-xs text-ink-muted">restantes</span>
                </div>
              )}
              {order.service_type === 'clash' && order.clash_tier && (
                <div className="hidden md:flex items-center gap-1">
                  <RankBadge tier={CLASH_TIER_BOUNDARY_RANKS[order.clash_tier].high} division={null} size="xs" showLabel={false} />
                  <ArrowRight className="h-3 w-3 text-ink-muted" />
                  {order.clash_day && (() => {
                    const { day, month } = getClashDateParts(order.created_at, order.clash_day)
                    return (
                      <span className="text-xs font-medium text-ink" data-tabular>
                        {day}/{month} · {CLASH_DAY_LABEL[order.clash_day]}
                      </span>
                    )
                  })()}
                </div>
              )}
              {order.riot_id && (
                <span className="hidden md:inline-flex items-center gap-1 text-xs text-ink-muted">
                  <Hash className="h-3 w-3" />
                  {order.riot_id}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <span className="hidden sm:block text-sm font-semibold text-ink">
            {currency(order.total_price)}
          </span>
          <OrderStatusBadge status={order.status} />
        </div>
      </Card>
    </Link>
  )
}
