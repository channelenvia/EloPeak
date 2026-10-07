import { useAdminCancelPendingReviewOrder, useAdminSetPendingReviewLock } from '@/api/admin'
import { ActionBar } from '@/components/ui/ActionBar'
import { ASSIGN_BOOSTER_STATUSES, REVIEWABLE_WITH_BOOSTER_STATUSES, STATUS_ACTION_TONE_CLASS, CONFIRM_STATUS_ACTION_COPY } from './adminOrderActions'
import { useAdminFlagOrderUnderReview, useAdminOverrideOrderStatus } from '@/api/orders'
import { Button, ErrorAlert, Modal, Popover } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { Order } from '@/types'
import { ArrowLeftRight, CheckCircle2, ChevronDown, Eye, Undo2, Unlock, UserPlus, XCircle } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AdminReassignModal, ReasonPromptModal, PendingReviewAssignModal } from './AdminOrderModals'

export function AdminStatusActionsMenu({ order }: { order: Order }) {
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [reassignOpen, setReassignOpen] = useState(false)
  const [assignPendingReviewOpen, setAssignPendingReviewOpen] = useState(false)
  const [flagUnderReviewOpen, setFlagUnderReviewOpen] = useState(false)
  const [cancelReviewOpen, setCancelReviewOpen] = useState(false)
  // "Marcar como concluído"/"Cancelar pedido" disparavam admin_override_order_status
  // num único clique, diferente de toda outra ação deste menu (drop,
  // reassign, refund) que exige modal + motivo -- um clique perdido tirava
  // um pedido do fluxo normal sem chance de desfazer.
  const [confirmAction, setConfirmAction] = useState<'completed' | 'canceled' | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const updateStatus = useAdminOverrideOrderStatus(order.id)
  const setPendingReviewLock = useAdminSetPendingReviewLock()
  const cancelReviewOrder = useAdminCancelPendingReviewOrder()
  const flagUnderReview = useAdminFlagOrderUnderReview(order.id)

  const itemClass = 'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-medium transition-colors disabled:opacity-50'
  const isPendingReview = order.status === 'pending_review'
  const isUnderReview = order.status === 'under_review'
  const isActiveWithBooster = REVIEWABLE_WITH_BOOSTER_STATUSES.includes(order.status)
  const reassignVisible = !isPendingReview && !isUnderReview && ASSIGN_BOOSTER_STATUSES.includes(order.status)
  const isNewAssignment = !order.assigned_booster_id

  function goToRefunds() {
    navigate(`/admin/refunds?order_id=${order.id}`)
  }

  function confirmStatus() {
    if (!confirmAction) return
    // Só fecha o menu/modal em caso de sucesso -- fechar incondicionalmente
    // desmontava o Popover (retorna null quando fechado) antes de
    // updateStatus.isError virar true, então uma mudança de status que
    // falhasse nunca mostrava erro nenhum ao admin.
    updateStatus.mutate(
      { orderId: order.id, newStatus: confirmAction, reason: CONFIRM_STATUS_ACTION_COPY[confirmAction].reason },
      {
        onSuccess: () => {
          setMenuOpen(false)
          setConfirmAction(null)
          if (confirmAction === 'canceled') goToRefunds()
        },
      },
    )
  }

  return (
    <>
      <Button
        ref={triggerRef}
        variant="secondary"
        size="sm"
        onClick={() => setMenuOpen((v) => !v)}
        rightIcon={<ChevronDown className={cn('h-3.5 w-3.5 transition-transform', menuOpen && 'rotate-180')} />}
      >
        Ações
      </Button>

      <Popover open={menuOpen} onClose={() => setMenuOpen(false)} anchorRef={triggerRef} className="w-64 p-2 space-y-1">
        {(isPendingReview || isUnderReview) && (
          <button
            type="button"
            disabled={setPendingReviewLock.isPending}
            onClick={() => { setMenuOpen(false); setPendingReviewLock.mutate({ orderId: order.id, locked: false }) }}
            className={cn(itemClass, STATUS_ACTION_TONE_CLASS.success)}
          >
            <Unlock className="h-4 w-4 shrink-0" />
            Disponibilizar
          </button>
        )}
        {isPendingReview && (
          <button
            type="button"
            onClick={() => { setMenuOpen(false); setFlagUnderReviewOpen(true) }}
            className={cn(itemClass, STATUS_ACTION_TONE_CLASS.neutral)}
          >
            <Eye className="h-4 w-4 shrink-0" />
            Analisar
          </button>
        )}
        {isUnderReview && order.status !== 'refunded' && (
          <Link
            to={`/admin/refunds?order_id=${order.id}`}
            onClick={() => setMenuOpen(false)}
            className={cn(itemClass, STATUS_ACTION_TONE_CLASS.neutral)}
          >
            <Undo2 className="h-4 w-4 shrink-0" />
            Marcar pra reembolsar
          </Link>
        )}
        {isActiveWithBooster && (
          <button
            type="button"
            onClick={() => { setMenuOpen(false); setFlagUnderReviewOpen(true) }}
            className={cn(itemClass, STATUS_ACTION_TONE_CLASS.neutral)}
          >
            <Eye className="h-4 w-4 shrink-0" />
            Analisar
          </button>
        )}
        {reassignVisible && (
          <button
            type="button"
            onClick={() => { setMenuOpen(false); setReassignOpen(true) }}
            className={cn(itemClass, STATUS_ACTION_TONE_CLASS.neutral)}
          >
            {isNewAssignment ? <UserPlus className="h-4 w-4 shrink-0" /> : <ArrowLeftRight className="h-4 w-4 shrink-0" />}
            {isNewAssignment ? 'Atribuir booster' : 'Reatribuir booster'}
          </button>
        )}
        {(isPendingReview || (isUnderReview && !order.assigned_booster_id)) && (
          <button
            type="button"
            onClick={() => { setMenuOpen(false); setAssignPendingReviewOpen(true) }}
            className={cn(itemClass, STATUS_ACTION_TONE_CLASS.neutral)}
          >
            <UserPlus className="h-4 w-4 shrink-0" />
            Atribuir booster
          </button>
        )}
        {!isPendingReview && !isUnderReview && order.status !== 'completed' && (
          <button
            type="button"
            disabled={updateStatus.isPending}
            onClick={() => setConfirmAction('completed')}
            className={cn(itemClass, STATUS_ACTION_TONE_CLASS.success)}
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Marcar como concluído
          </button>
        )}
        {!isPendingReview && !isUnderReview && order.status !== 'canceled' && (
          <button
            type="button"
            disabled={updateStatus.isPending}
            onClick={() => setConfirmAction('canceled')}
            className={cn(itemClass, STATUS_ACTION_TONE_CLASS.danger)}
          >
            <XCircle className="h-4 w-4 shrink-0" />
            Cancelar pedido
          </button>
        )}
        {(isPendingReview || isUnderReview) && (
          <button
            type="button"
            onClick={() => { setMenuOpen(false); setCancelReviewOpen(true) }}
            className={cn(itemClass, STATUS_ACTION_TONE_CLASS.danger)}
          >
            <XCircle className="h-4 w-4 shrink-0" />
            Cancelar pedido
          </button>
        )}
      </Popover>

      {reassignVisible && (
        <AdminReassignModal order={order} open={reassignOpen} onClose={() => setReassignOpen(false)} />
      )}

      {(isPendingReview || isUnderReview) && (
        <PendingReviewAssignModal order={order} open={assignPendingReviewOpen} onClose={() => setAssignPendingReviewOpen(false)} />
      )}

      <ReasonPromptModal
        open={flagUnderReviewOpen}
        onClose={() => setFlagUnderReviewOpen(false)}
        title="Colocar pedido em análise"
        description={isPendingReview
          ? 'O pedido fica travado em análise -- ninguém vê nem aceita até você disponibilizar, atribuir ou cancelar.'
          : 'O pedido fica travado com o mesmo booster e cliente vinculados -- sem novas partidas contabilizadas nem acesso à conta liberado -- até você disponibilizar (retoma de onde parou, com o prazo de entrega ajustado pelo tempo parado) ou cancelar.'}
        confirmLabel="Colocar em análise"
        variant="primary"
        isPending={flagUnderReview.isPending}
        error={flagUnderReview.error}
        onConfirm={(reason, done) => flagUnderReview.mutate(reason, { onSuccess: () => { done(); setMenuOpen(false) } })}
      />

      <ReasonPromptModal
        open={cancelReviewOpen}
        onClose={() => setCancelReviewOpen(false)}
        title="Cancelar pedido"
        description="O pedido é cancelado -- o cliente já pagou, o reembolso é tratado a seguir na aba Reembolsos."
        confirmLabel="Cancelar pedido"
        variant="danger"
        isPending={cancelReviewOrder.isPending}
        error={cancelReviewOrder.error}
        onConfirm={(reason, done) => cancelReviewOrder.mutate(
          { orderId: order.id, reason },
          { onSuccess: () => { done(); setMenuOpen(false); goToRefunds() } },
        )}
      />

      {confirmAction && (
        <Modal
          open
          onOpenChange={(next) => { if (!next) setConfirmAction(null) }}
          title={CONFIRM_STATUS_ACTION_COPY[confirmAction].title}
          description={CONFIRM_STATUS_ACTION_COPY[confirmAction].description}
        >
          {updateStatus.isError && (
            <ErrorAlert message={updateStatus.error instanceof Error ? updateStatus.error.message : 'Erro'} className="mb-3" />
          )}
          <ActionBar>
            <Button disabled={updateStatus.isPending} variant="secondary" onClick={() => setConfirmAction(null)}>Cancelar</Button>
            <Button variant={CONFIRM_STATUS_ACTION_COPY[confirmAction].variant} loading={updateStatus.isPending} onClick={confirmStatus}>
              {CONFIRM_STATUS_ACTION_COPY[confirmAction].confirmLabel}
            </Button>
          </ActionBar>
        </Modal>
      )}
    </>
  )
}
