import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Card, OrderStatusBadge, RankBadge } from '@/components/ui'
import { formatRank, getServiceLabel, sortOrderExtras, timeAgo } from '@/lib/utils'
import type { Division, Order, RankTier } from '@/types'

interface CustomerOrderCardProps {
  order: Order
  currency: (amount: number) => string
  /** Prefixo de rota pro link do card -- cliente usa /orders (padrão), admin reaproveita com /admin/orders. */
  basePath?: string
}

// Mesmo padrão visual do CompletedOrderCard (booster) -- grid de cards com
// mais respiro/detalhe em vez da lista compacta (OrderRow) que ficava tudo
// muito junto em "Meus Pedidos". Reaproveitado também pela lista de pedidos
// do admin (via basePath) pra manter os 3 papéis com o mesmo padrão visual.
export function CustomerOrderCard({ order, currency, basePath = '/orders' }: CustomerOrderCardProps) {
  const currentRank = order.current_rank as { tier: RankTier; division: Division | null } | null
  const targetRank = order.target_rank as { tier: RankTier; division: Division | null } | null
  const hasWinProgress = order.wins_purchased != null

  return (
    <Link to={`${basePath}/${order.id}`}>
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

        {hasWinProgress && (
          <p className="text-xs text-ink-secondary mb-3">
            {order.wins_played}/{order.wins_purchased} vitórias
          </p>
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
            <p className="text-sm font-bold text-ink">{currency(order.total_price)}</p>
            <p className="text-[10px] text-ink-muted">Total pago</p>
          </div>
          <p className="text-xs text-ink-muted">Criado {timeAgo(order.created_at)}</p>
        </div>
      </Card>
    </Link>
  )
}
