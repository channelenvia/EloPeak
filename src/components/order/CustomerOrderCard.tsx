import { Link } from 'react-router-dom'
import { Clock, Lock, LockOpen, UserCheck, UserPlus, X } from 'lucide-react'
import { Button, Card, OrderStatusBadge } from '@/components/ui'
import { cn, getOrderServiceName } from '@/lib/utils'
import { useBoosterServiceDetails } from '@/api/coaching'
import { useAdminSetPendingReviewLock } from '@/api/admin'
import { pendingReviewTimeLeft } from '@/features/admin/components/pendingReviewTime'
import { OrderCardDetails } from '@/components/order/OrderCardDetails'
import { OrderCardFooter } from '@/components/order/OrderCardFooter'
import type { Order } from '@/types'

interface CustomerOrderCardProps {
  order: Order
  currency: (amount: number) => string
  /** Prefixo de rota pro link do card -- cliente usa /orders (padrão), admin reaproveita com /admin/orders. */
  basePath?: string
  /** Admin reaproveita este card pra sua própria lista (ver features/admin/pages/Orders.tsx) -- muda só o enquadramento de rotas exibido (OrderCardDetails), o resto do card é idêntico. */
  viewerRole?: 'customer' | 'admin'
  onAssign?: (order: Order) => void
  onCancel?: (order: Order) => void
  nowTick?: number
}

function PendingReviewCardActions({
  order,
  onAssign,
  onCancel,
}: {
  order: Order
  onAssign?: (order: Order) => void
  onCancel?: (order: Order) => void
}) {
  const toggleLock = useAdminSetPendingReviewLock()

  return (
    <div className="mt-3 pt-2.5 border-t border-border-subtle/80 flex items-center justify-between gap-2">
      <span className="text-[11px] font-semibold text-ink-secondary">Revisão Admin:</span>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            'h-7 px-2.5 text-xs font-medium flex items-center gap-1.5 transition-colors',
            order.admin_review_locked
              ? 'bg-danger/10 text-danger hover:bg-danger/20'
              : 'bg-success/10 text-success hover:bg-success/20'
          )}
          loading={toggleLock.isPending && toggleLock.variables?.orderId === order.id}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            toggleLock.mutate({ orderId: order.id, locked: !order.admin_review_locked })
          }}
          aria-pressed={order.admin_review_locked}
          title={order.admin_review_locked ? 'Travado -- clique para destravar (libera agora)' : 'Liberado -- clique para travar'}
        >
          {order.admin_review_locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
          <span>{order.admin_review_locked ? 'Destravar' : 'Travar'}</span>
        </Button>

        {onAssign && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2.5 text-xs font-medium flex items-center gap-1.5 bg-brand/10 text-brand hover:bg-brand/20 transition-colors"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onAssign(order)
            }}
            title={order.preferred_booster_id ? 'Reatribuir a outro booster' : 'Atribuir a um booster'}
          >
            {order.preferred_booster_id ? <UserCheck className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
            <span>{order.preferred_booster_id ? 'Reatribuir' : 'Atribuir'}</span>
          </Button>
        )}

        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-7 w-7 text-ink-muted hover:text-danger hover:bg-danger/10 transition-colors"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onCancel(order)
            }}
            title="Cancelar pedido"
            aria-label="Cancelar pedido"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}

// Padrão visual de referência pro card-resumo de pedido, reaproveitado por
// TODOS os papéis (cliente, booster, admin) via OrderCardDetails -- ver
// CompletedOrderCard (booster) e a lista de pedidos do admin (via basePath).
// min-h fixo: mantém a altura igual entre cards com e sem addons/extras, em
// vez de cada linha do grid ficar com altura diferente conforme o conteúdo.
export function CustomerOrderCard({
  order,
  currency,
  basePath = '/orders',
  viewerRole = 'customer',
  onAssign,
  onCancel,
  nowTick,
}: CustomerOrderCardProps) {
  // Mesmo título do pacote mostrado na aba "Pegar" do booster -- pra um
  // pedido de coaching não virar só "Coaching" genérico na lista.
  const { data: coachPackage } = useBoosterServiceDetails(
    order.service_type === 'coaching' ? (order.booster_service_id ?? undefined) : undefined,
  )

  const isReviewAdmin = viewerRole === 'admin' && order.status === 'pending_review'
  const currentTick = nowTick ?? Date.now()

  return (
    <Card
      variant="interactive"
      className={cn(
        'h-full min-h-[300px] flex flex-col',
        isReviewAdmin && 'border-warning/40 bg-warning/[0.02]'
      )}
    >
      <Link
        to={`${basePath}/${order.id}`}
        className="flex flex-1 flex-col rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-mono text-ink-muted">#{order.id.slice(0, 8).toUpperCase()}</p>
              {order.drop_count > 0 && (
                <span className="text-[9px] font-bold uppercase tracking-wide text-warning bg-warning/10 px-1.5 py-0.5 rounded">Dropado</span>
              )}
            </div>
            <p className="text-sm font-semibold text-ink truncate">{coachPackage?.title ?? getOrderServiceName(order)}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isReviewAdmin && (
              <span className={cn(
                'text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1',
                order.admin_review_locked ? 'bg-ink-muted/10 text-ink-secondary' : 'bg-warning/10 text-warning'
              )}>
                {order.admin_review_locked ? (
                  <>
                    <Lock className="h-3 w-3" />
                    Travado
                  </>
                ) : (
                  <>
                    <Clock className="h-3 w-3" />
                    {pendingReviewTimeLeft(order.review_release_at, currentTick)}
                  </>
                )}
              </span>
            )}
            <OrderStatusBadge order={order} />
          </div>
        </div>

        <div className="flex-1">
          <OrderCardDetails order={order} viewerRole={viewerRole} />
        </div>

        <OrderCardFooter order={order} value={order.total_price} valueLabel="Total pago" currency={currency} />

      </Link>

      {isReviewAdmin && (
        <PendingReviewCardActions order={order} onAssign={onAssign} onCancel={onCancel} />
      )}
    </Card>
  )
}
