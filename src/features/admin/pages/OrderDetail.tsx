import { useBoosterServiceDetails } from '@/api/coaching'
import { useBoostersWithSlots } from '@/api/boosters'
import type { BoosterWithSlots } from '@/api/boosters'
import { useAdminAssignPendingReviewOrder, useAdminCancelPendingReviewOrder, useAdminSetPendingReviewLock } from '@/api/admin'
import { useAdminDropOrder, useAdminFlagOrderUnderReview, useAdminOverrideOrderStatus, useAdminReassignBooster, useOrder, useOrderPaidAmount, useOrderStatusHistory, useSyncOrderMatches } from '@/api/orders'
import { AccessTokenSection } from '@/components/order/AccessTokenSection'
import { CountdownTimer } from '@/components/order/CountdownTimer'
import { DuoAccountHistoryList } from '@/components/order/DuoAccountHistoryList'
import { DuoPartnerRiotId } from '@/components/order/DuoPartnerRiotId'
import { OrderDetailShell } from '@/components/order/OrderDetailShell'
import { getOrderDetailInfo } from '@/components/order/orderDetailInfo'
import type { OrderInfoGridItem } from '@/components/order/OrderInfoGrid'
import { OrderPageHeader } from '@/components/order/OrderPageHeader'
import { ServiceTagPills } from '@/components/service/ServiceTagPills'
import { BoosterStatusBadge, Button, ErrorAlert, Modal, OrderStatusBadge, PageLoader, Popover } from '@/components/ui'
import { useCurrency } from '@/hooks/useCurrency'
import { CLASH_DAY_LABEL, getClashDateParts } from '@/lib/clashDomain'
import { getLaneDisplayItems } from '@/lib/lolTaxonomy'
import { supabase } from '@/lib/supabase'
import { cn, formatDateTime, formatEstimatedDelivery, getOrderServiceName, orderRequiresAccountAccess, timeAgo } from '@/lib/utils'
import type { Order, OrderStatus } from '@/types'
import { useQuery } from '@tanstack/react-query'
import {
    ArrowLeftRight,
    CalendarDays,
    Check, CheckCircle2, ChevronDown, Clock,
    Copy,
    Eye,
    Gamepad2,
    Hash,
    History, Lock,
    Search,
    Undo2,
    Route,
    Shuffle,
    Unlock,
    User,
    UserPlus,
    Users,
    Wallet,
    XCircle,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

type BoosterRef = { id: string; user_id: string; display_name: string } | undefined

function BoosterLink({ userId, booster }: { userId: string; booster: BoosterRef }) {
  if (!booster) return <span className="font-mono text-xs">{userId.slice(0, 8)}…</span>
  return (
    <Link to={`/admin/boosters/${booster.id}`} className="text-brand hover:underline">
      {booster.display_name}
    </Link>
  )
}

// Mesmo conjunto de status aceitos por admin_drop_order (migration 071) —
// 'drop_requested' fica de fora porque já tem sua própria fila em /admin/drops.
const DROPPABLE_STATUSES: OrderStatus[] = ['assigned', 'in_progress', 'paused', 'awaiting_customer']

// Mesmo conjunto de DROPPABLE_STATUSES + 'awaiting_assignment' -- pedido no
// pool (sem assigned_booster_id) também precisa poder receber um booster
// direto do menu do admin, não só pedidos que já têm um booster ativo pra
// trocar (ver migration 20260902160000_admin_assign_booster_from_awaiting_
// assignment). Ação de drop continua restrita a DROPPABLE_STATUSES -- não
// tem o que "dropar" num pedido que ainda não foi atribuído.
const ASSIGN_BOOSTER_STATUSES: OrderStatus[] = [...DROPPABLE_STATUSES, 'awaiting_assignment']

// Só 3 ações manuais: concluir/cancelar (admin_override_order_status, sem
// efeito colateral) e reembolsar -- que é um link pro formulário de
// reembolso manual (AdminRefundsPage/admin_create_manual_refund), não um
// flip direto pra status='refunded' (isso deixava o pedido "reembolsado"
// sem processar nada no Mercado Pago nem no saldo do booster).
const STATUS_ACTION_TONE_CLASS: Record<string, string> = {
  success: 'text-success hover:bg-success/10',
  neutral: 'text-ink-secondary hover:bg-bg-raised',
  danger:  'text-danger hover:bg-danger/10',
}

function AdminDropModal({ orderId, dropCount, open, onClose }: { orderId: string; dropCount: number; open: boolean; onClose: () => void }) {
  const [dropReason, setDropReason] = useState('')
  const dropOrder = useAdminDropOrder(orderId)
  const willCancel = dropCount >= 2

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) { onClose(); setDropReason('') } }}
      title="Dropar Pedido"
      description={willCancel
        ? 'Este pedido já foi dropado 2 vezes -- o limite pra voltar pro painel automaticamente foi atingido. Confirmar aqui CANCELA o pedido; o pagamento do booster e o cliente precisam ser tratados manualmente depois.'
        : 'O booster é retirado e o pedido volta pro painel. Pagamento proporcional ao progresso já concluído.'}
    >
      <div>
        <label htmlFor="admin-drop-reason" className="text-xs font-semibold text-ink-secondary block mb-1.5">Motivo (mín. 10 caracteres)</label>
        <textarea id="admin-drop-reason" value={dropReason} onChange={(e) => setDropReason(e.target.value)} placeholder="Justificativa para o drop..." className="input-base w-full min-h-[80px] resize-none text-sm" maxLength={500} />
      </div>
      {dropOrder.isError && (
        <ErrorAlert message={dropOrder.error instanceof Error ? dropOrder.error.message : 'Erro'} className="mt-2" />
      )}
      <div className="flex gap-3 justify-end pt-2">
        <Button variant="ghost" onClick={() => { onClose(); setDropReason('') }}>Cancelar</Button>
        <Button
          variant="danger"
          loading={dropOrder.isPending}
          disabled={dropReason.trim().length < 10}
          onClick={() => dropOrder.mutate(dropReason.trim(), { onSuccess: () => { onClose(); setDropReason('') } })}
        >
          {willCancel ? 'Cancelar Pedido' : 'Confirmar Drop'}
        </Button>
      </div>
    </Modal>
  )
}

// Atribuir/reatribuir booster: ação exclusiva do admin (não existe pro
// booster/cliente) -- lista todos os boosters da aplicação via
// admin_list_boosters_with_slots e ignora o limite de slots de propósito
// (can_booster_accept_order continua valendo pro fluxo normal de
// accept_boost_order; isso aqui é só a exceção administrativa pra casos bem
// específicos). Aparece pra pedidos com booster ativo (ASSIGN_BOOSTER_
// STATUSES) e também pra pedidos 'awaiting_assignment' ainda sem booster --
// nesse caso isNewAssignment ajusta o texto pra "Atribuir" em vez de
// "Reatribuir".
function AdminReassignModal({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
  const [search, setSearch] = useState('')
  const [selectedBoosterId, setSelectedBoosterId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const { data: boosters, isLoading: loadingBoosters } = useBoostersWithSlots(open)
  const reassign = useAdminReassignBooster(order.id)
  const isNewAssignment = !order.assigned_booster_id

  const filtered = (boosters ?? [])
    .filter((b: BoosterWithSlots) => b.user_id !== order.assigned_booster_id)
    .filter((b: BoosterWithSlots) => b.status === 'approved')
    .filter((b: BoosterWithSlots) => b.display_name.toLowerCase().includes(search.trim().toLowerCase()))

  function close() {
    onClose()
    setSearch('')
    setSelectedBoosterId(null)
    setReason('')
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) close() }}
      title={isNewAssignment ? 'Atribuir booster' : 'Reatribuir booster'}
      maxWidth="lg"
      description={isNewAssignment
        ? 'Reserva o pedido pro booster escolhido -- ele some da aba Jobs dos outros e aparece só pra ele, marcado como "Reatribuído" (roxo). Ele recebe uma notificação e DM no Discord, e tem 12h pra aceitar antes de voltar pro pool geral.'
        : 'Reserva o pedido pro booster escolhido, ignorando o limite de slots -- ação exclusiva do admin, use só em casos bem específicos. Ele recebe uma notificação e DM no Discord, e tem 12h pra aceitar antes de voltar pro pool geral.'}
    >
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-tertiary" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar booster..."
          aria-label="Buscar booster"
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
              selectedBoosterId === b.user_id ? 'border-brand bg-brand/5' : 'border-transparent hover:bg-bg-raised',
            )}
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className="font-medium truncate">{b.display_name}</span>
              <BoosterStatusBadge status={b.status} />
            </span>
            <span className="shrink-0 text-xs text-ink-secondary">
              {b.total_count} ativo{b.total_count === 1 ? '' : 's'} ({b.solo_count} solo / {b.duo_count} duo)
            </span>
          </button>
        ))}
      </div>

      <div>
        <label htmlFor="admin-reassign-reason" className="text-xs font-semibold text-ink-secondary block mb-1.5">Motivo (mín. 10 caracteres)</label>
        <textarea
          id="admin-reassign-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={isNewAssignment ? 'Justificativa para a atribuição...' : 'Justificativa para a reatribuição...'}
          className="input-base w-full min-h-[80px] resize-none text-sm"
          maxLength={500}
        />
      </div>

      {reassign.isError && (
        <ErrorAlert message={reassign.error instanceof Error ? reassign.error.message : 'Erro'} className="mt-2" />
      )}

      <div className="flex gap-3 justify-end pt-2">
        <Button variant="ghost" onClick={close}>Cancelar</Button>
        <Button
          variant="primary"
          loading={reassign.isPending}
          disabled={!selectedBoosterId || reason.trim().length < 10}
          onClick={() => {
            if (!selectedBoosterId) return
            reassign.mutate({ targetBoosterId: selectedBoosterId, reason: reason.trim() }, { onSuccess: close })
          }}
        >
          {isNewAssignment ? 'Atribuir' : 'Reatribuir'}
        </Button>
      </div>
    </Modal>
  )
}

// Mesmo padrão do menu de ações dos boosters (ver BoosterActionsMenu em
// Boosters.tsx): botão "Ações" + Popover ancorado com a lista, em vez de um
// modal central. "Atribuir/Reatribuir booster" aparece em ASSIGN_BOOSTER_
// STATUSES (booster ativo OU 'awaiting_assignment') -- ver comentário de
// AdminReassignModal.
// Concluir/cancelar usam admin_override_order_status (sem efeito colateral);
// reembolsar é um link pro formulário de reembolso manual
// (AdminRefundsPage/admin_create_manual_refund), não um flip direto pra
// status='refunded' (isso deixava o pedido "reembolsado" sem processar nada
// no Mercado Pago nem no saldo do booster).
const CONFIRM_STATUS_ACTION_COPY: Record<'completed' | 'canceled', { title: string; description: string; reason: string; confirmLabel: string; variant: 'success' | 'danger' }> = {
  completed: {
    title: 'Marcar pedido como concluído',
    description: 'O pedido será marcado como concluído manualmente pelo admin, fora do fluxo normal de verificação.',
    reason: 'Concluído manualmente pelo admin',
    confirmLabel: 'Marcar como concluído',
    variant: 'success',
  },
  canceled: {
    title: 'Cancelar pedido',
    description: 'O pedido será cancelado manualmente pelo admin. Reembolso, se necessário, precisa ser feito à parte.',
    reason: 'Cancelado manualmente pelo admin',
    confirmLabel: 'Cancelar pedido',
    variant: 'danger',
  },
}

// Modal genérico de "ação + motivo (mín. 10 caracteres)" -- usado pelas 3
// ações que só precisam disso (Analisar, e o Cancelar dos dois estágios de
// revisão). Drop e Reatribuir continuam com seus próprios modais (campos
// extras: booster, aviso de cancelamento por limite etc.).
function ReasonPromptModal({
  open, onClose, title, description, confirmLabel, variant, isPending, error, onConfirm,
}: {
  open: boolean
  onClose: () => void
  title: string
  description: string
  confirmLabel: string
  variant: 'primary' | 'danger'
  isPending: boolean
  error: unknown
  onConfirm: (reason: string, done: () => void) => void
}) {
  const [reason, setReason] = useState('')
  function close() { onClose(); setReason('') }

  return (
    <Modal open={open} onOpenChange={(next) => { if (!next) close() }} title={title} description={description}>
      <div>
        <label htmlFor="reason-prompt-input" className="text-xs font-semibold text-ink-secondary block mb-1.5">Motivo (mín. 10 caracteres)</label>
        <textarea
          id="reason-prompt-input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Justificativa..."
          className="input-base w-full min-h-[80px] resize-none text-sm"
          maxLength={500}
        />
      </div>
      {!!error && (
        <ErrorAlert message={error instanceof Error ? error.message : 'Erro'} className="mt-2" />
      )}
      <div className="flex gap-3 justify-end pt-2">
        <Button variant="ghost" onClick={close}>Voltar</Button>
        <Button
          variant={variant}
          loading={isPending}
          disabled={reason.trim().length < 10}
          onClick={() => onConfirm(reason.trim(), close)}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}

// Atribuir durante pending_review/under_review: reserva exclusiva (12h),
// mesmo formato de busca do AdminReassignModal acima, só que chamando
// admin_assign_pending_review_order em vez de admin_reassign_booster (RPC
// distinta -- ver migration 20260906190000).
function PendingReviewAssignModal({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
  const [search, setSearch] = useState('')
  const [selectedBoosterId, setSelectedBoosterId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const { data: boosters, isLoading: loadingBoosters } = useBoostersWithSlots(open)
  const assignOrder = useAdminAssignPendingReviewOrder()

  const filtered = (boosters ?? [])
    .filter((b: BoosterWithSlots) => b.status === 'approved')
    .filter((b: BoosterWithSlots) => b.display_name.toLowerCase().includes(search.trim().toLowerCase()))

  function close() {
    onClose()
    setSearch('')
    setSelectedBoosterId(null)
    setReason('')
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) close() }}
      title="Atribuir a um booster"
      maxWidth="lg"
      description="Reserva o pedido só pra esse booster -- ele tem 12h pra aceitar, sem passar pelo pool público."
    >
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-tertiary" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar booster..."
          aria-label="Buscar booster"
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
              selectedBoosterId === b.user_id ? 'border-brand bg-brand/5' : 'border-transparent hover:bg-bg-raised',
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
        <label htmlFor="pending-review-order-detail-assign-reason" className="text-xs font-semibold text-ink-secondary block mb-1.5">Motivo (mín. 10 caracteres)</label>
        <textarea
          id="pending-review-order-detail-assign-reason"
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

function AdminStatusActionsMenu({ order }: { order: Order }) {
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

  const itemClass = 'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-sm font-medium transition-colors disabled:opacity-50'
  const isPendingReview = order.status === 'pending_review'
  const isUnderReview = order.status === 'under_review'
  const isActiveWithBooster = DROPPABLE_STATUSES.includes(order.status)
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
            Reembolsar
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
        {(isPendingReview || isUnderReview) && (
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
        {!isPendingReview && !isUnderReview && order.status !== 'refunded' && (
          <Link
            to={`/admin/refunds?order_id=${order.id}`}
            onClick={() => setMenuOpen(false)}
            className={cn(itemClass, STATUS_ACTION_TONE_CLASS.neutral)}
          >
            <Undo2 className="h-4 w-4 shrink-0" />
            Marcar pra reembolsar
          </Link>
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
          : 'O booster é removido e pago proporcionalmente pelo progresso entregue (mesma fórmula de um drop) -- o pedido fica travado em análise até você disponibilizar, atribuir ou cancelar.'}
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
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={() => setConfirmAction(null)}>Cancelar</Button>
            <Button variant={CONFIRM_STATUS_ACTION_COPY[confirmAction].variant} loading={updateStatus.isPending} onClick={confirmStatus}>
              {CONFIRM_STATUS_ACTION_COPY[confirmAction].confirmLabel}
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}

export function AdminOrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const currency = useCurrency()
  const [nickCopied, setNickCopied] = useState(false)
  const [dropModalOpen, setDropModalOpen] = useState(false)

  const { data: order, isLoading: loadingOrder, isError: orderError, refetch: refetchOrder } = useOrder(id)
  const { data: paidAmount } = useOrderPaidAmount(id)
  const { data: history } = useOrderStatusHistory(id)
  const { data: coachPackage } = useBoosterServiceDetails(order?.booster_service_id ?? undefined)

  const { data: parties } = useQuery({
    queryKey: ['admin', 'order-parties', order?.customer_id, order?.assigned_booster_id, order?.preferred_booster_id],
    queryFn: async () => {
      const boosterUserIds = [order!.assigned_booster_id, order!.preferred_booster_id].filter((v): v is string => !!v)
      const [{ data: customer }, { data: boosters }] = await Promise.all([
        supabase.from('profiles').select('username').eq('id', order!.customer_id).maybeSingle(),
        boosterUserIds.length
          ? supabase.from('booster_profiles').select('id, user_id, display_name').in('user_id', boosterUserIds)
          : Promise.resolve({ data: [] as { id: string; user_id: string; display_name: string }[] }),
      ])
      return {
        customerUsername: customer?.username ?? null,
        boosterByUserId: new Map((boosters ?? []).map((b) => [b.user_id, b])),
      }
    },
    enabled: !!order,
  })

  const syncMatches = useSyncOrderMatches(id ?? '')

  if (loadingOrder) return <PageLoader />

  if (orderError) {
    return (
      <div className="space-y-4">
        <ErrorAlert message="Não foi possível carregar o pedido. Tente novamente." />
        <Button onClick={() => refetchOrder()}>Tentar novamente</Button>
      </div>
    )
  }

  if (!order) return null

  const { isBoostFlow, isClash, modeLabel, clashClosingLabel } = getOrderDetailInfo(order)

  async function copyNickname() {
    if (!order?.riot_id) return
    await navigator.clipboard.writeText(order.riot_id)
    setNickCopied(true)
    setTimeout(() => setNickCopied(false), 1500)
  }

  const dropVisible = DROPPABLE_STATUSES.includes(order.status)

  const infoItems: OrderInfoGridItem[] = [
    { icon: Gamepad2, label: 'Serviço', value: getOrderServiceName(order) },
    ...((isBoostFlow || isClash) ? [{ icon: Shuffle, label: 'Modo do pedido', value: modeLabel }] : []),
    ...(isBoostFlow
      ? [{ icon: Users, label: 'Fila', value: order.queue_type === 'solo_duo' ? 'Solo/Duo' : 'Flex' }]
      : isClash && order.clash_day
        ? [{ icon: Users, label: 'Dia', value: (() => {
            const { day, month } = getClashDateParts(order.created_at, order.clash_day!)
            return `${day}/${month} · ${CLASH_DAY_LABEL[order.clash_day!]}`
          })() }]
        : []),
    ...(order.service_type === 'coaching' && order.sessions_purchased != null
      ? [{ icon: CalendarDays, label: 'Sessões', value: `${order.sessions_purchased}` }]
      : []),
    { icon: User, label: 'Cliente', value: parties?.customerUsername ?? 'Carregando…' },
    ...((isBoostFlow || isClash) ? [{
      icon: Hash, label: 'Riot ID', value: order.riot_id ? (
        <span className="inline-flex items-center justify-center gap-1.5">
          {order.riot_id}
          <button type="button" onClick={() => void copyNickname()} aria-label="Copiar Riot ID" className="text-ink-muted hover:text-brand transition-colors">
            {nickCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </button>
        </span>
      ) : 'Não informado',
    }] : []),
    ...getLaneDisplayItems(order, 'admin').map((item) => ({ icon: Route, label: item.label, value: <ServiceTagPills lanes={item.lanes} compact emptyFallback="---" /> })),
    {
      icon: User, label: 'Booster associado', value: (() => {
        const boosterId = order.assigned_booster_id ?? order.preferred_booster_id
        if (!boosterId) return 'Não associado'
        return (
          <span className="inline-flex items-center gap-1.5">
            <BoosterLink userId={boosterId} booster={parties?.boosterByUserId.get(boosterId)} />
            {!order.assigned_booster_id && (
              <span className={`text-[10px] font-bold uppercase ${order.reassigned_by_admin ? 'text-rank-master' : 'text-accent'}`}>
                {order.reassigned_by_admin ? 'Reatribuído (aguardando aceite)' : 'Exclusivo'}
              </span>
            )}
          </span>
        )
      })(),
    },
    { icon: Clock, label: 'Entrega estimada', value: isClash ? clashClosingLabel : (order.estimated_hours ? formatEstimatedDelivery(order.estimated_hours) : 'Não disponível') },
    { icon: Wallet, label: 'Total pago', value: currency(paidAmount ?? order.total_price) },
  ]

  return (
    <div className="space-y-6">
      <OrderPageHeader
        backHref="/admin/orders"
        orderIdShort={order.id.slice(0, 8).toUpperCase()}
        statusBadge={<OrderStatusBadge order={order} />}
        statusActions={order.status === 'drop_requested' ? (
          <Link
            to="/admin/drops"
            title="Drop pendente de aprovação."
            className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg uppercase tracking-wide bg-warning/15 text-warning border border-warning/30 hover:bg-warning/25 transition-colors"
          >
            <Lock className="h-3 w-3" />
            Travado · Analisar solicitação
          </Link>
        ) : undefined}
        extra={(
          <>
            <span className="text-xs text-ink-muted">Criado em {formatDateTime(order.created_at)}</span>
            {order.drop_count > 0 && (
              <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg uppercase tracking-wide bg-warning/15 text-warning border border-warning/30">
                <History className="h-3 w-3" />
                Dropado {order.drop_count > 1 ? `${order.drop_count}x` : ''} · valor e prazo já atualizados
                {order.last_dropped_at ? ` · último drop ${timeAgo(order.last_dropped_at)}` : ''}
              </span>
            )}
            {['in_progress', 'paused', 'awaiting_customer'].includes(order.status) && (
              <CountdownTimer startedAt={order.match_sync_started_at} estimatedHours={order.estimated_hours} />
            )}
          </>
        )}
        onDrop={dropVisible ? () => setDropModalOpen(true) : undefined}
        dropTooltip={order.drop_count >= 2 ? 'Limite de 2 drops atingido -- confirmar aqui cancela o pedido.' : undefined}
        primary={<AdminStatusActionsMenu order={order} />}
      />

      <OrderDetailShell
        order={order}
        viewerRole="admin"
        detailsTitle="Detalhes do pedido"
        history={history}
        coachPackage={coachPackage}
        infoItems={infoItems}
        notesLabel="Notas do Cliente"
        syncMatches={syncMatches}
        accountLockedMessage={
          order.status === 'awaiting_payment'
            ? 'A conta do pedido fica disponível após a confirmação do pagamento.'
            : ['paid', 'awaiting_assignment'].includes(order.status)
              ? 'A conta fica disponível quando um booster aceitar o pedido.'
              : order.status === 'completed' && order.boost_mode !== 'duo'
                ? 'O acesso às credenciais fica bloqueado após a conclusão do pedido.'
                : !orderRequiresAccountAccess(order) && order.boost_mode !== 'duo'
                  ? 'Este serviço não exige credenciais de conta.'
                  : undefined
        }
        accountContent={
          order.boost_mode === 'duo' ? (
            ['in_progress', 'paused', 'awaiting_customer', 'completed'].includes(order.status)
              ? <DuoAccountHistoryList orderId={order.id} />
              : <DuoPartnerRiotId orderId={order.id} />
          ) : orderRequiresAccountAccess(order) ? (
            <AccessTokenSection order={order} />
          ) : null
        }
      />

      <AdminDropModal orderId={order.id} dropCount={order.drop_count} open={dropModalOpen} onClose={() => setDropModalOpen(false)} />
    </div>
  )
}
