import { useEffect, useState } from 'react'
import { Lock, LockOpen, Search, UserPlus, X } from 'lucide-react'
import { Button, Card, ErrorAlert, Modal } from '@/components/ui'
import { cn } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import { usePendingReviewOrders, useAdminAssignPendingReviewOrder, useAdminCancelPendingReviewOrder, useAdminSetPendingReviewLock } from '@/api/admin'
import { useBoostersWithSlots } from '@/api/boosters'
import type { BoosterWithSlots } from '@/api/boosters'
import type { Order } from '@/types'

// Contagem regressiva local, sem round-trip -- review_release_at já vem do
// servidor, só formata o quanto falta em texto. Reusa o mesmo segundo
// pra todos os cards do painel (um único setInterval).
function useNowTick() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

function timeLeftLabel(releaseAt: string | null, now: number): string {
  if (!releaseAt) return '--'
  const diffMs = new Date(releaseAt).getTime() - now
  if (diffMs <= 0) return 'liberando...'
  return `${Math.ceil(diffMs / 1000)}s`
}

function CancelModal({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const cancelOrder = useAdminCancelPendingReviewOrder()

  function close() { onClose(); setReason('') }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) close() }}
      title="Cancelar pedido"
      description="O pedido é cancelado antes de ir pro pool -- o cliente já pagou, o reembolso é tratado manualmente pela equipe."
    >
      <div>
        <label className="text-xs font-semibold text-ink-secondary block mb-1.5">Motivo (mín. 10 caracteres)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Justificativa para o cancelamento..."
          className="input-base w-full min-h-[80px] resize-none text-sm"
          maxLength={500}
        />
      </div>
      {cancelOrder.isError && (
        <ErrorAlert message={cancelOrder.error instanceof Error ? cancelOrder.error.message : 'Erro'} className="mt-2" />
      )}
      <div className="flex gap-3 justify-end pt-2">
        <Button variant="ghost" onClick={close}>Voltar</Button>
        <Button
          variant="danger"
          loading={cancelOrder.isPending}
          disabled={reason.trim().length < 10}
          onClick={() => cancelOrder.mutate({ orderId: order.id, reason: reason.trim() }, { onSuccess: close })}
        >
          Cancelar pedido
        </Button>
      </div>
    </Modal>
  )
}

function AssignModal({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
  const [search, setSearch] = useState('')
  const [selectedBoosterId, setSelectedBoosterId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const { data: boosters, isLoading: loadingBoosters } = useBoostersWithSlots(open)
  const assignOrder = useAdminAssignPendingReviewOrder()

  const filtered = (boosters ?? [])
    .filter((b: BoosterWithSlots) => b.status === 'approved')
    .filter((b: BoosterWithSlots) => b.display_name.toLowerCase().includes(search.trim().toLowerCase()))

  function close() { onClose(); setSearch(''); setSelectedBoosterId(null); setReason('') }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) close() }}
      title="Atribuir a um booster"
      maxWidth="lg"
      description="Atribui o pedido diretamente ao booster escolhido, sem passar pelo pool público."
    >
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-tertiary" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar booster..."
          className="input-base w-full pl-9 text-sm"
        />
      </div>

      <div className="max-h-64 overflow-y-auto space-y-1 -mx-1 px-1">
        {loadingBoosters && <p className="text-sm text-ink-secondary py-4 text-center">Carregando boosters...</p>}
        {!loadingBoosters && filtered.length === 0 && (
          <p className="text-sm text-ink-secondary py-4 text-center">Nenhum booster encontrado.</p>
        )}
        {filtered.map((b: BoosterWithSlots) => (
          <button
            key={b.user_id}
            type="button"
            onClick={() => setSelectedBoosterId(b.user_id)}
            className={cn(
              'w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors border',
              selectedBoosterId === b.user_id ? 'border-brand bg-brand/5' : 'border-transparent hover:bg-bg-elevated',
            )}
          >
            <span className="font-medium truncate">{b.display_name}</span>
            <span className="shrink-0 text-xs text-ink-secondary">
              {b.total_count} ativo{b.total_count === 1 ? '' : 's'}
            </span>
          </button>
        ))}
      </div>

      <div>
        <label className="text-xs font-semibold text-ink-secondary block mb-1.5">Motivo (mín. 10 caracteres)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Justificativa para a atribuição..."
          className="input-base w-full min-h-[80px] resize-none text-sm"
          maxLength={500}
        />
      </div>
      {assignOrder.isError && (
        <ErrorAlert message={assignOrder.error instanceof Error ? assignOrder.error.message : 'Erro'} className="mt-2" />
      )}
      <div className="flex gap-3 justify-end pt-2">
        <Button variant="ghost" onClick={close}>Cancelar</Button>
        <Button
          variant="primary"
          loading={assignOrder.isPending}
          disabled={!selectedBoosterId || reason.trim().length < 10}
          onClick={() => {
            if (!selectedBoosterId) return
            assignOrder.mutate({ orderId: order.id, targetBoosterId: selectedBoosterId, reason: reason.trim() }, { onSuccess: close })
          }}
        >
          Atribuir
        </Button>
      </div>
    </Modal>
  )
}

// Painel só aparece quando há pedido em pending_review -- não ocupa espaço
// à toa no dashboard. Janela é de 1 minuto, então a lista é live (realtime +
// refetch de 10s) e a contagem regressiva atualiza a cada segundo local.
export function PendingReviewPanel() {
  const { data: orders } = usePendingReviewOrders()
  const now = useNowTick()
  const currency = useCurrency()
  const toggleLock = useAdminSetPendingReviewLock()
  const [cancelOrder, setCancelOrder] = useState<Order | null>(null)
  const [assignOrder, setAssignOrder] = useState<Order | null>(null)

  if (!orders || orders.length === 0) return null

  return (
    <>
      <Card variant="operational" padding="md" className="border-warning/30 bg-warning/[0.03]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-ink">Pedidos em revisão ({orders.length})</h3>
          <span className="text-[10px] text-ink-muted">Janela de 1 minuto antes de ir pro pool</span>
        </div>
        <div className="space-y-2">
          {orders.map((order) => (
            <div key={order.id} className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-bg-surface px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-xs font-mono text-ink">#{order.id.slice(0, 8).toUpperCase()}</p>
                <p className="text-[10px] text-ink-muted truncate">
                  {order.service_type} · {order.boost_mode} · {currency(order.total_price)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={cn(
                  'text-[10px] font-semibold px-2 py-1 rounded-full',
                  order.admin_review_locked ? 'bg-ink-muted/10 text-ink-secondary' : 'bg-warning/10 text-warning',
                )}>
                  {order.admin_review_locked ? 'Travado' : timeLeftLabel(order.review_release_at, now)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={toggleLock.isPending}
                  onClick={() => toggleLock.mutate({ orderId: order.id, locked: !order.admin_review_locked })}
                  title={order.admin_review_locked ? 'Destravar (libera agora)' : 'Travar'}
                >
                  {order.admin_review_locked ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => setAssignOrder(order)} title="Atribuir a um booster">
                  <UserPlus className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => setCancelOrder(order)} title="Cancelar pedido">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {cancelOrder && (
        <CancelModal order={cancelOrder} open={!!cancelOrder} onClose={() => setCancelOrder(null)} />
      )}
      {assignOrder && (
        <AssignModal order={assignOrder} open={!!assignOrder} onClose={() => setAssignOrder(null)} />
      )}
    </>
  )
}
