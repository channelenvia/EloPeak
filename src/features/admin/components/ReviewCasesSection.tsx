import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, MessageCircle, RefreshCw, Wallet, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button, Card, Skeleton } from '@/components/ui'
import { useCurrency } from '@/hooks/useCurrency'
import { useAdminReviewCases, useProfileUsernames } from '@/api/admin'
import type { AdminReviewCase } from '@/api/admin'
import { CancelWithoutRefundModal } from './CancelWithoutRefundModal'
import { AdjustBoosterBalanceModal } from './AdjustBoosterBalanceModal'

// Casos que atingiram o limite de 2 drops (apply_order_drop cancela em vez
// de reabrir) -- nada é automático aqui, o admin negocia com cliente e
// booster pelo chat do próprio pedido (já embutido em OrderDetail) e resolve
// os dois lados: reembolso do cliente (reusa o modal de reembolso manual
// abaixo) e/ou ajuste do saldo do booster.
function ReviewCaseCard({ item, boosterName, onOpenRefund }: { item: AdminReviewCase; boosterName?: string | null; onOpenRefund: (orderId: string) => void }) {
  const currency = useCurrency()
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)

  return (
    <Card variant="operational" padding="md" className="border-danger/30 bg-danger/[0.03]">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-danger" />
            <Link to={`/admin/orders/${item.order_id}`} className="font-mono text-sm text-brand hover:underline">
              #{item.order_id.slice(0, 8).toUpperCase()}
            </Link>
            <Badge variant="danger" size="tag">
              {item.drop_count} drops
            </Badge>
          </div>
          <p className="text-xs text-ink-secondary mt-1">
            Total do pedido: <span className="font-semibold text-ink">{currency(item.total_price)}</span>
            {item.refunded_amount > 0 && <> · Já reembolsado: <span className="font-semibold text-ink">{currency(item.refunded_amount)}</span></>}
            {boosterName && <> · Último booster: <span className="font-semibold text-ink">{boosterName}</span></>}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link to={`/admin/orders/${item.order_id}`}>
            <Button variant="secondary" size="sm" leftIcon={<MessageCircle className="h-3.5 w-3.5" />}>Chat do pedido</Button>
          </Link>
          <Button variant="secondary" size="sm" leftIcon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => onOpenRefund(item.order_id)}>
            Marcar pra reembolsar
          </Button>
          <Button variant="secondary" size="sm" leftIcon={<XCircle className="h-3.5 w-3.5" />} onClick={() => setCancelOpen(true)}>
            Cancelar sem reembolso
          </Button>
          {item.last_assigned_booster_id && (
            <Button variant="secondary" size="sm" leftIcon={<Wallet className="h-3.5 w-3.5" />} onClick={() => setAdjustOpen(true)}>
              Ajustar saldo do booster
            </Button>
          )}
        </div>
      </div>

      <CancelWithoutRefundModal orderId={item.order_id} open={cancelOpen} onClose={() => setCancelOpen(false)} />
      {item.last_assigned_booster_id && (
        <AdjustBoosterBalanceModal boosterId={item.last_assigned_booster_id} open={adjustOpen} onClose={() => setAdjustOpen(false)} />
      )}
    </Card>
  )
}

// Batch de todos os last_assigned_booster_id de uma vez em vez de uma query
// por card (N+1) -- mesmo padrão do useBoosterNames usado em Drops.tsx, só
// que contra profiles.username em vez de booster_profiles.display_name (é o
// campo que este card já mostrava).
export function ReviewCasesSection({ onOpenRefund }: { onOpenRefund: (orderId: string) => void }) {
  const { data: cases, isLoading } = useAdminReviewCases()
  const boosterIds = useMemo(
    () => Array.from(new Set((cases ?? []).map((c) => c.last_assigned_booster_id).filter((id): id is string => !!id))),
    [cases],
  )
  const { data: boosterNames } = useProfileUsernames(boosterIds)

  if (isLoading) return <Skeleton className="h-24 rounded-2xl" />
  if (!cases || cases.length === 0) return null

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-ink">Casos em análise ({cases.length})</h2>
      {cases.map((item) => (
        <ReviewCaseCard
          key={item.order_id}
          item={item}
          boosterName={item.last_assigned_booster_id ? boosterNames?.get(item.last_assigned_booster_id) : undefined}
          onOpenRefund={onOpenRefund}
        />
      ))}
    </div>
  )
}
