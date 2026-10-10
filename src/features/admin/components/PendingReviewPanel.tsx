import { useState } from 'react'
import { ActionBar } from '@/components/ui/ActionBar'
import { InlineEmpty } from '@/components/ui/EmptyState'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, ErrorAlert, Modal, SearchInput } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useAdminAssignPendingReviewOrder, useAdminCancelPendingReviewOrder } from '@/api/admin'
import { useBoostersWithSlots } from '@/api/boosters'
import type { BoosterWithSlots } from '@/api/boosters'
import type { Order } from '@/types'

export function CancelModal({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
  const cancelOrder = useAdminCancelPendingReviewOrder()
  const { register, handleSubmit, reset, formState: { isValid } } = useForm<{ reason: string }>({
    resolver: zodResolver(z.object({ reason: z.string().trim().min(10, 'Motivo deve ter pelo menos 10 caracteres.') })),
    defaultValues: { reason: '' },
    mode: 'onChange',
  })

  function close() { onClose(); reset({ reason: '' }) }
  function submit(data: { reason: string }) {
    cancelOrder.mutate({ orderId: order.id, reason: data.reason.trim() }, { onSuccess: close })
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) close() }}
      title="Cancelar pedido"
      description="O pedido é cancelado antes de ir pro pool -- o cliente já pagou, o reembolso é tratado manualmente pela equipe."
    >
      <div>
        <label htmlFor="pending-review-cancel-reason" className="text-xs font-semibold text-ink-secondary block mb-1.5">Motivo (mín. 10 caracteres)</label>
        <textarea
          id="pending-review-cancel-reason"
          {...register('reason')}
          placeholder="Justificativa para o cancelamento…"
          className="input-base w-full min-h-[80px] resize-none text-sm"
          maxLength={500}
        />
      </div>
      {cancelOrder.isError && (
        <ErrorAlert message={cancelOrder.error instanceof Error ? cancelOrder.error.message : 'Erro'} className="mt-2" />
      )}
      <ActionBar>
        <Button disabled={cancelOrder.isPending} variant="secondary" onClick={close}>Voltar</Button>
        <Button
          variant="danger"
          loading={cancelOrder.isPending}
          disabled={!isValid}
          onClick={handleSubmit(submit)}
        >
          Cancelar pedido
        </Button>
      </ActionBar>
    </Modal>
  )
}

export function AssignModal({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
  const [search, setSearch] = useState('')
  const [selectedBoosterId, setSelectedBoosterId] = useState<string | null>(null)
  const { data: boosters, isLoading: loadingBoosters } = useBoostersWithSlots(open)
  const assignOrder = useAdminAssignPendingReviewOrder()
  const { register, handleSubmit, reset, formState: { isValid } } = useForm<{ reason: string }>({
    resolver: zodResolver(z.object({ reason: z.string().trim().min(10, 'Motivo deve ter pelo menos 10 caracteres.') })),
    defaultValues: { reason: '' },
    mode: 'onChange',
  })
  // preferred_booster_id já setado = uma atribuição anterior reservou esse
  // pedido -- reabrir o mesmo modal aqui troca pra outro booster, então o
  // texto muda pra "reatribuir" em vez de "atribuir" (mesma RPC dos dois).
  const isReassign = !!order.preferred_booster_id

  const filtered = (boosters ?? [])
    .filter((b: BoosterWithSlots) => b.status === 'approved')
    .filter((b: BoosterWithSlots) => b.display_name.toLowerCase().includes(search.trim().toLowerCase()))

  function close() { onClose(); setSearch(''); setSelectedBoosterId(null); reset({ reason: '' }) }
  function submit(data: { reason: string }) {
    if (!selectedBoosterId) return
    assignOrder.mutate({ orderId: order.id, targetBoosterId: selectedBoosterId, reason: data.reason.trim() }, { onSuccess: close })
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) close() }}
      title={isReassign ? 'Reatribuir a outro booster' : 'Atribuir a um booster'}
      maxWidth="lg"
      description="Reserva o pedido só pra esse booster -- ele tem 9h pra aceitar, sem passar pelo pool público."
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
        <label htmlFor="pending-review-assign-reason" className="text-xs font-semibold text-ink-secondary block mb-1.5">Motivo (mín. 10 caracteres)</label>
        <textarea
          id="pending-review-assign-reason"
          {...register('reason')}
          placeholder="Justificativa para a atribuição…"
          className="input-base w-full min-h-[80px] resize-none text-sm"
          maxLength={500}
        />
      </div>
      {assignOrder.isError && (
        <ErrorAlert message={assignOrder.error instanceof Error ? assignOrder.error.message : 'Erro'} className="mt-2" />
      )}
      <ActionBar>
        <Button disabled={assignOrder.isPending} variant="secondary" onClick={close}>Cancelar</Button>
        <Button
          variant="primary"
          loading={assignOrder.isPending}
          disabled={!selectedBoosterId || !isValid}
          onClick={handleSubmit(submit)}
        >
          {isReassign ? 'Reatribuir' : 'Atribuir'}
        </Button>
      </ActionBar>
    </Modal>
  )
}
