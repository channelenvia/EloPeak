import { Link } from 'react-router-dom'
import { Clock, ArrowRight } from 'lucide-react'
import { Card, OrderStatusBadge, RankBadge } from '@/components/ui'
import { formatRank, formatDate, getServiceLabel, formatEstimatedDelivery, boosterEarningsShare, sortOrderExtras } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import type { Division, Order, RankTier } from '@/types'

interface CompletedOrderCardProps {
  order: Order
  isTop3?: boolean | null
}

// Shared card used by the "Pedidos Concluídos" page and the Earnings
// monthly-services list — one place for the field spec both need:
// tipo de serviço, rank atual → rank objetivo, valor do booster, tempo estimado.
export function CompletedOrderCard({ order, isTop3 }: CompletedOrderCardProps) {
  const currency = useCurrency()
  const currentRank = order.current_rank as { tier: RankTier; division: Division } | null
  const targetRank = order.target_rank as { tier: RankTier; division: Division } | null

  return (
    <Link to={`/booster/jobs/${order.id}`}>
      <Card className="h-full hover:border-brand/20 hover:shadow-card-hover transition-all cursor-pointer">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <p className="text-xs font-mono text-ink-muted">#{order.id.slice(0, 8).toUpperCase()}</p>
            <p className="text-sm font-semibold text-ink truncate">{getServiceLabel(order.service_type)}</p>
          </div>
          <OrderStatusBadge status={order.status} />
        </div>

        {currentRank && targetRank && (
          <div className="flex items-center gap-2 mb-3">
            <RankBadge tier={currentRank.tier} division={currentRank.division} size="xs" showLabel={false} />
            <ArrowRight className="h-3.5 w-3.5 text-ink-muted shrink-0" />
            <RankBadge tier={targetRank.tier} division={targetRank.division} size="xs" showLabel={false} />
            <span className="text-xs text-ink-secondary">
              {formatRank(currentRank.tier, currentRank.division)} → {formatRank(targetRank.tier, targetRank.division)}
            </span>
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

        <div className="flex items-center justify-between pt-3 border-t border-bg-elevated">
          <div>
            <p className="text-sm font-bold text-success">{currency(order.total_price * boosterEarningsShare(isTop3))}</p>
            <p className="text-[10px] text-ink-muted">Seu valor</p>
          </div>
          {order.estimated_hours != null && (
            <div className="flex items-center gap-1.5 text-xs text-ink-muted">
              <Clock className="h-3.5 w-3.5" />
              {formatEstimatedDelivery(order.estimated_hours)} estimadas
            </div>
          )}
        </div>

        {order.completed_at && (
          <p className="text-[10px] text-ink-muted mt-2">Concluído em {formatDate(order.completed_at)}</p>
        )}
      </Card>
    </Link>
  )
}
