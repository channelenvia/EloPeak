import { InlineEmpty } from '@/components/ui/EmptyState'
import { ActionBar } from '@/components/ui/ActionBar'
import { useBoostersWithSlots } from '@/api/boosters'
import type { BoosterWithSlots } from '@/api/boosters'
import { useAdminAssignPendingReviewOrder } from '@/api/admin'
import { useAdminDropOrder, useAdminReassignBooster } from '@/api/orders'
import { BoosterStatusBadge, Button, ErrorAlert, Modal, SearchInput } from '@/components/ui'
import { cn } from '@/lib/cn'
import { parseCompletionPct } from '@/lib/coachCompletion'
import type { Order, ServiceType } from '@/types'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

interface AdminDropFormData {
  reason: string
  completionPct: string
}

export function AdminDropModal({ orderId, serviceType, dropCount, open, onClose }: { orderId: string; serviceType: ServiceType; dropCount: number; open: boolean; onClose: () => void }) {
  const dropOrder = useAdminDropOrder(orderId)
  const willCancel = dropCount >= 2
  const isCoaching = serviceType === 'coaching'

  const { register, handleSubmit, reset, formState: { isValid } } = useForm<AdminDropFormData>({
    resolver: zodResolver(z.object({
      reason: z.string().trim().min(10, 'Motivo deve ter pelo menos 10 caracteres.'),
      completionPct: z.string().refine((v) => !isCoaching || parseCompletionPct(v) !== null, 'Informe o % entregue (0 a 100).'),
    })),
    // Coaching não tem métrica automática de progresso (sem partida/rank pra
    // medir) -- order_drop_completion_pct sempre retorna 0 pra esse serviço.
    // Pede o % de sessões já entregues pro admin em vez de pagar sempre 0%
    // (ver migration 20260908090000). Só aparece pra coaching -- os outros
    // serviços continuam com o cálculo automático de sempre.
    defaultValues: { reason: '', completionPct: '' },
    mode: 'onChange',
  })

  function close() {
    onClose()
    reset({ reason: '', completionPct: '' })
  }

  function onSubmit(data: AdminDropFormData) {
    dropOrder.mutate(
      { reason: data.reason.trim(), coachingCompletionPct: isCoaching ? parseCompletionPct(data.completionPct) ?? undefined : undefined },
      { onSuccess: close },
    )
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) close() }}
      title="Dropar Pedido"
    >
      <div>
        <label htmlFor="admin-drop-reason" className="text-xs font-semibold text-ink-secondary block mb-1.5">Motivo (mín. 10 caracteres)</label>
        <textarea id="admin-drop-reason" {...register('reason')} placeholder="Justificativa para o drop…" className="input-base w-full min-h-[80px] resize-none text-sm" maxLength={500} />
      </div>
      {isCoaching && (
        <div>
          <label htmlFor="admin-drop-coaching-pct" className="text-xs font-semibold text-ink-secondary block mb-1.5">
            % do pacote já entregue pelo coach
          </label>
          <input
            id="admin-drop-coaching-pct"
            type="number"
            min={0}
            max={100}
            {...register('completionPct')}
            className="input-base w-full text-sm"
          />
          <p className="text-xs text-ink-muted mt-1">
            Coaching não tem como medir progresso automaticamente (sem partida/rank) -- informe quanto do pacote já foi dado antes do drop. Digite 0 se nada foi entregue ainda (o campo não pode ficar vazio).
          </p>
        </div>
      )}
      {dropOrder.isError && (
        <ErrorAlert message={dropOrder.error instanceof Error ? dropOrder.error.message : 'Erro'} className="mt-2" />
      )}
      <p className={cn('text-xs', willCancel ? 'text-danger' : 'text-ink-secondary')}>
        {willCancel
          ? 'Este pedido já foi dropado 2 vezes -- o limite pra voltar pro painel automaticamente foi atingido. Confirmar aqui CANCELA o pedido; o pagamento do booster e o cliente precisam ser tratados manualmente depois.'
          : 'O booster é retirado e o pedido volta pro painel. Pagamento proporcional ao progresso já concluído.'}
      </p>
      <ActionBar>
        <Button disabled={dropOrder.isPending} variant="secondary" onClick={close}>Cancelar</Button>
        <Button
          variant="danger"
          loading={dropOrder.isPending}
          disabled={!isValid}
          onClick={handleSubmit(onSubmit)}
        >
          {willCancel ? 'Cancelar pedido' : 'Confirmar drop'}
        </Button>
      </ActionBar>
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
export function AdminReassignModal({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
  const [search, setSearch] = useState('')
  const [selectedBoosterId, setSelectedBoosterId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [completionPct, setCompletionPct] = useState('')
  const { data: boosters, isLoading: loadingBoosters } = useBoostersWithSlots(open)
  const reassign = useAdminReassignBooster(order.id)
  const isNewAssignment = !order.assigned_booster_id
  // Trocar o coach de um pedido de coaching ativo passa pelo mesmo drop
  // proporcional de qualquer reatribuição (apply_order_drop) -- coaching não
  // tem métrica automática de progresso (order_drop_completion_pct sempre
  // retorna 0 pra ele), então pede quanto do pacote o coach anterior já deu
  // em vez de pagar sempre 0% (ver migration 20260908090000).
  const showCoachingCompletionInput = !isNewAssignment && order.service_type === 'coaching'

  const filtered = (boosters ?? [])
    .filter((b: BoosterWithSlots) => b.user_id !== order.assigned_booster_id)
    .filter((b: BoosterWithSlots) => b.status === 'approved')
    .filter((b: BoosterWithSlots) => b.display_name.toLowerCase().includes(search.trim().toLowerCase()))

  function close() {
    onClose()
    setSearch('')
    setSelectedBoosterId(null)
    setReason('')
    setCompletionPct('0')
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) close() }}
      title={isNewAssignment ? 'Atribuir booster' : 'Reatribuir booster'}
      maxWidth="lg"
    >
      <SearchInput
        size="md"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar booster…"
        aria-label="Buscar booster"
      />

      <div className="max-h-64 overflow-y-auto space-y-1 -mx-1 px-1">
        {loadingBoosters && <p className="text-sm text-ink-secondary py-4 text-center">Carregando boosters…</p>}
        {!loadingBoosters && filtered.length === 0 && (
          <InlineEmpty>Nenhum booster encontrado.</InlineEmpty>
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
        <label htmlFor="admin-reassign-reason" className="text-xs font-semibold text-ink-secondary block mb-1.5">Motivo (opcional)</label>
        <textarea
          id="admin-reassign-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Só preencha se quiser registrar algo -- normalmente o combinado já foi direto com o booster…"
          className="input-base w-full min-h-[80px] resize-none text-sm"
          maxLength={500}
        />
      </div>

      {showCoachingCompletionInput && (
        <div>
          <label htmlFor="admin-reassign-coaching-pct" className="text-xs font-semibold text-ink-secondary block mb-1.5">
            % do pacote já entregue pelo coach atual
          </label>
          <input
            id="admin-reassign-coaching-pct"
            type="number"
            min={0}
            max={100}
            value={completionPct}
            onChange={(e) => setCompletionPct(e.target.value)}
            className="input-base w-full text-sm"
          />
          <p className="text-xs text-ink-muted mt-1">
            Coaching não tem como medir progresso automaticamente -- informe quanto do pacote o coach atual já deu antes de trocar. Digite 0 se nada foi entregue ainda (o campo não pode ficar vazio).
          </p>
        </div>
      )}

      {reassign.isError && (
        <ErrorAlert message={reassign.error instanceof Error ? reassign.error.message : 'Erro'} className="mt-2" />
      )}

      <p className="text-xs text-ink-secondary">
        {isNewAssignment
          ? 'Ele some da aba Jobs dos outros e aparece só pra ele, marcado como "Reatribuído" (roxo). Recebe notificação e DM no Discord, e tem 9h pra aceitar antes de voltar pro pool geral.'
          : 'Ignora o limite de slots -- ação exclusiva do admin, use só em casos bem específicos. Ele recebe notificação e DM no Discord, e tem 9h pra aceitar antes de voltar pro pool geral.'}
      </p>

      <ActionBar>
        <Button disabled={reassign.isPending} variant="secondary" onClick={close}>Cancelar</Button>
        <Button
          variant="primary"
          loading={reassign.isPending}
          disabled={!selectedBoosterId || (showCoachingCompletionInput && parseCompletionPct(completionPct) === null)}
          onClick={() => {
            if (!selectedBoosterId) return
            reassign.mutate({
              targetBoosterId: selectedBoosterId, reason: reason.trim(),
              coachingCompletionPct: showCoachingCompletionInput ? parseCompletionPct(completionPct) ?? undefined : undefined,
            }, { onSuccess: close })
          }}
        >
          {isNewAssignment ? 'Atribuir' : 'Reatribuir'}
        </Button>
      </ActionBar>
    </Modal>
  )
}


// Modal genérico de "ação + motivo (mín. 10 caracteres)" -- usado pelas 3
// ações que só precisam disso (Analisar, e o Cancelar dos dois estágios de
// revisão). Drop e Reatribuir continuam com seus próprios modais (campos
// extras: booster, aviso de cancelamento por limite etc.).
export function ReasonPromptModal({
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
  const { register, handleSubmit, reset, formState: { isValid } } = useForm<{ reason: string }>({
    resolver: zodResolver(z.object({ reason: z.string().trim().min(10, 'Motivo deve ter pelo menos 10 caracteres.') })),
    defaultValues: { reason: '' },
    mode: 'onChange',
  })
  function close() { onClose(); reset({ reason: '' }) }
  function submit(data: { reason: string }) { onConfirm(data.reason.trim(), close) }

  return (
    <Modal open={open} onOpenChange={(next) => { if (!next) close() }} title={title}>
      <div>
        <label htmlFor="reason-prompt-input" className="text-xs font-semibold text-ink-secondary block mb-1.5">Motivo (mín. 10 caracteres)</label>
        <textarea
          id="reason-prompt-input"
          {...register('reason')}
          placeholder="Justificativa…"
          className="input-base w-full min-h-[80px] resize-none text-sm"
          maxLength={500}
        />
      </div>
      {!!error && (
        <ErrorAlert message={error instanceof Error ? error.message : 'Erro'} className="mt-2" />
      )}
      <p className={cn('text-xs', variant === 'danger' ? 'text-danger' : 'text-ink-secondary')}>{description}</p>
      <ActionBar>
        <Button disabled={isPending} variant="secondary" onClick={close}>Voltar</Button>
        <Button
          variant={variant}
          loading={isPending}
          disabled={!isValid}
          onClick={handleSubmit(submit)}
        >
          {confirmLabel}
        </Button>
      </ActionBar>
    </Modal>
  )
}

// Atribuir durante pending_review/under_review: reserva exclusiva (9h),
// mesmo formato de busca do AdminReassignModal acima, só que chamando
// admin_assign_pending_review_order em vez de admin_reassign_booster (RPC
// distinta -- ver migration 20260906190000).
export function PendingReviewAssignModal({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
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
    >
      <SearchInput
        size="md"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar booster…"
        aria-label="Buscar booster"
      />

      <div className="max-h-64 overflow-y-auto space-y-1 -mx-1 px-1">
        {loadingBoosters && <p className="text-sm text-ink-secondary py-4 text-center">Carregando boosters…</p>}
        {!loadingBoosters && filtered.length === 0 && (
          <InlineEmpty>Nenhum booster encontrado.</InlineEmpty>
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
        <label htmlFor="pending-review-order-detail-assign-reason" className="text-xs font-semibold text-ink-secondary block mb-1.5">Motivo (opcional)</label>
        <textarea
          id="pending-review-order-detail-assign-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Só preencha se quiser registrar algo -- normalmente o combinado já foi direto com o booster…"
          className="input-base w-full min-h-[80px] resize-none text-sm"
          maxLength={500}
        />
      </div>
      {assignOrder.isError && (
        <ErrorAlert message={assignOrder.error instanceof Error ? assignOrder.error.message : 'Erro'} className="mt-2" />
      )}
      <p className="text-xs text-ink-secondary">
        Reserva o pedido só pra esse booster -- ele tem 9h pra aceitar, sem passar pelo pool público.
      </p>
      <ActionBar>
        <Button disabled={assignOrder.isPending} variant="secondary" onClick={close}>Cancelar</Button>
        <Button
          variant="primary"
          loading={assignOrder.isPending}
          disabled={!selectedBoosterId}
          onClick={() => {
            if (!selectedBoosterId) return
            assignOrder.mutate({ orderId: order.id, targetBoosterId: selectedBoosterId, reason: reason.trim() }, { onSuccess: close })
          }}
        >
          Atribuir
        </Button>
      </ActionBar>
    </Modal>
  )
}
