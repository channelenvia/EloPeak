import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertTriangle, MessageCircle, Plus, RefreshCw, Wallet } from 'lucide-react'
import { Button, Card, CurrencyMaskedInput, EmptyState, ErrorAlert, FilterTabs, Modal, Pagination, SearchInput, Skeleton } from '@/components/ui'
import { formatDateTime } from '@/lib/utils'
import { usePagedList } from '@/hooks/usePagedList'
import type { Refund } from '@/types'
import { useCurrency } from '@/hooks/useCurrency'
import { useAdminAdjustBoosterBalance, useAdminRefunds, useAdminReviewCases, useProfileUsername, useProfileUsernames } from '@/api/admin'
import type { AdminReviewCase } from '@/api/admin'
import { useAdminCreateManualRefund, useOrder } from '@/api/orders'
import { useBoosterPayoutTotals } from '@/api/payouts'
import { useCountedFilterTabs } from '@/hooks/useCountedFilterTabs'

const REFUND_STATUS_LABEL: Record<Refund['status'], string> = {
  pending: 'Pendente',
  succeeded: 'Concluído',
  failed: 'Falhou',
}

const ORDER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Reembolso aqui é sempre tratado manualmente entre admin e cliente (PIX de
// volta por fora, combinado via DM/ticket) -- este formulário só registra o
// que já aconteceu, não chama o Mercado Pago. Por isso pede o ID completo do
// pedido (não dá pra buscar por texto parcial) e mostra cliente/valor total
// do pedido encontrado como confirmação antes de deixar submeter.
interface ManualRefundFormData {
  orderId: string
  reason: string
  amountCents: number
}

function NewManualRefundModal({ open, onClose, initialOrderId = '' }: { open: boolean; onClose: () => void; initialOrderId?: string }) {
  const currency = useCurrency()
  const createRefund = useAdminCreateManualRefund()

  const { control, register, handleSubmit, watch, reset, trigger, formState: { errors, isValid } } = useForm<ManualRefundFormData>({
    resolver: zodResolver(z.object({
      orderId: z.string().refine((v) => ORDER_ID_PATTERN.test(v.trim()), 'ID inválido — cole o UUID completo do pedido (visível na URL da página do pedido).'),
      reason: z.string().trim().min(10, 'Motivo deve ter pelo menos 10 caracteres.').max(500),
      amountCents: z.number({ invalid_type_error: 'Informe um valor de reembolso.' }).int().min(1, 'Informe um valor de reembolso.'),
    })),
    defaultValues: { orderId: initialOrderId, reason: '', amountCents: 0 },
    mode: 'onChange',
  })

  const orderId = watch('orderId')
  const amountCents = watch('amountCents')
  const trimmedId = orderId.trim()
  const looksLikeUuid = ORDER_ID_PATTERN.test(trimmedId)
  const { data: lookupOrder, isFetching: lookupLoading } = useOrder(looksLikeUuid ? trimmedId : undefined)
  const { data: customerUsername } = useProfileUsername(lookupOrder?.customer_id)

  const maxCents = lookupOrder ? Math.round(lookupOrder.total_price * 100) : undefined
  // O teto some/aparece conforme o pedido é encontrado -- revalida o campo
  // já digitado assim que isso muda (mesmo padrão de RequestPayoutCard,
  // booster/pages/Payments.tsx).
  useEffect(() => { void trigger('amountCents') }, [maxCents, trigger])

  function close() {
    onClose()
    reset({ orderId: '', reason: '', amountCents: 0 })
  }

  const canSubmit = isValid && looksLikeUuid && !!lookupOrder && (!maxCents || amountCents <= maxCents)

  function onSubmit(data: ManualRefundFormData) {
    createRefund.mutate({ orderId: data.orderId.trim(), reason: data.reason.trim(), amount: data.amountCents / 100 }, { onSuccess: close })
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) close() }}
      title="Novo reembolso manual"
      description="Registra um reembolso manual (PIX por fora) sem chamar o Mercado Pago."
    >
      <div>
        <label htmlFor="manual-refund-order-id" className="text-xs font-semibold text-ink-secondary block mb-1.5">Número do pedido (ID completo)</label>
        <input
          id="manual-refund-order-id"
          {...register('orderId')}
          placeholder="Cole o ID completo do pedido..."
          className="input-base w-full text-sm font-mono"
        />
        {trimmedId.length > 0 && errors.orderId && (
          <p className="text-xs text-warning mt-1">{errors.orderId.message}</p>
        )}
        {looksLikeUuid && lookupLoading && <p className="text-xs text-ink-muted mt-1">Buscando pedido…</p>}
        {looksLikeUuid && !lookupLoading && !lookupOrder && <p className="text-xs text-danger mt-1">Pedido não encontrado.</p>}
        {lookupOrder && (
          <p className="text-xs text-ink-secondary mt-1.5 bg-bg-raised rounded-lg px-3 py-2">
            Cliente: <span className="font-semibold text-ink">{customerUsername ?? 'Carregando…'}</span> · Total do pedido: <span className="font-semibold text-ink">{currency(lookupOrder.total_price)}</span>
          </p>
        )}
      </div>

      <div>
        <label className="text-xs font-semibold text-ink-secondary block mb-1.5">Valor do reembolso</label>
        <Controller
          control={control}
          name="amountCents"
          render={({ field }) => (
            <CurrencyMaskedInput valueCents={field.value} onChangeCents={field.onChange} maxCents={maxCents} aria-label="Valor do reembolso" />
          )}
        />
        {maxCents !== undefined && amountCents > maxCents && (
          <p className="text-xs text-danger mt-1">Valor não pode passar do total do pedido ({currency(lookupOrder!.total_price)}).</p>
        )}
      </div>

      <div>
        <label htmlFor="manual-refund-reason" className="text-xs font-semibold text-ink-secondary block mb-1.5">Motivo (mín. 10 caracteres)</label>
        <textarea
          id="manual-refund-reason"
          {...register('reason')}
          placeholder="Descreva o motivo do reembolso..."
          className="input-base w-full min-h-[80px] resize-none text-sm"
          maxLength={500}
        />
      </div>

      {createRefund.isError && (
        <ErrorAlert message={createRefund.error instanceof Error ? createRefund.error.message : 'Erro'} />
      )}

      <div className="flex gap-3 justify-end pt-2">
        <Button variant="ghost" onClick={close}>Cancelar</Button>
        <Button
          variant="danger"
          loading={createRefund.isPending}
          disabled={!canSubmit}
          onClick={handleSubmit(onSubmit)}
        >
          Registrar reembolso
        </Button>
      </div>
    </Modal>
  )
}

interface AdjustBalanceFormData {
  reason: string
  amountCents: number
}

function AdjustBoosterBalanceModal({ boosterId, open, onClose }: { boosterId: string; open: boolean; onClose: () => void }) {
  const currency = useCurrency()
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit')
  const adjust = useAdminAdjustBoosterBalance()
  // Só usado como teto de UX pro débito -- se a RPC não devolver o saldo (ex.:
  // função restrita ao próprio booster), o backend segue como fonte de verdade.
  const { data: totals } = useBoosterPayoutTotals(open ? boosterId : undefined)
  const maxDebitCents = direction === 'debit' && totals ? Math.round(totals.available_balance * 100) : undefined

  const { control, register, handleSubmit, watch, reset, trigger, formState: { isValid } } = useForm<AdjustBalanceFormData>({
    resolver: zodResolver(z.object({
      reason: z.string().trim().min(10, 'Motivo deve ter pelo menos 10 caracteres.').max(500),
      amountCents: z.number({ invalid_type_error: 'Informe um valor.' }).int().min(1, 'Informe um valor.'),
    })),
    defaultValues: { reason: '', amountCents: 0 },
    mode: 'onChange',
  })

  const amountCents = watch('amountCents')
  useEffect(() => { void trigger('amountCents') }, [maxDebitCents, trigger])

  function close() {
    onClose()
    reset({ reason: '', amountCents: 0 })
    setDirection('credit')
  }

  const canSubmit = isValid && (maxDebitCents === undefined || amountCents <= maxDebitCents)

  function onSubmit(data: AdjustBalanceFormData) {
    adjust.mutate(
      { boosterId, amount: direction === 'debit' ? -(data.amountCents / 100) : data.amountCents / 100, reason: data.reason.trim() },
      { onSuccess: close },
    )
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) close() }}
      title="Ajustar saldo do booster"
      description="Credita ou debita diretamente o saldo do booster (booster_ledger_entries) -- use pra fechar um caso em análise junto com o reembolso do cliente."
    >
      <div className="flex gap-2">
        <Button
          variant={direction === 'credit' ? 'primary' : 'secondary'}
          className="flex-1"
          onClick={() => setDirection('credit')}
        >
          Creditar
        </Button>
        <Button
          variant={direction === 'debit' ? 'danger' : 'secondary'}
          className="flex-1"
          onClick={() => setDirection('debit')}
        >
          Debitar
        </Button>
      </div>

      <div>
        <label className="text-xs font-semibold text-ink-secondary block mb-1.5">Valor</label>
        <Controller
          control={control}
          name="amountCents"
          render={({ field }) => (
            <CurrencyMaskedInput valueCents={field.value} onChangeCents={field.onChange} maxCents={maxDebitCents} aria-label="Valor do ajuste" />
          )}
        />
        {maxDebitCents !== undefined && amountCents > maxDebitCents && (
          <p className="text-xs text-danger mt-1">Valor não pode passar do saldo disponível do booster ({currency(totals!.available_balance)}).</p>
        )}
      </div>

      <div>
        <label htmlFor="adjust-balance-reason" className="text-xs font-semibold text-ink-secondary block mb-1.5">Motivo (mín. 10 caracteres)</label>
        <textarea
          id="adjust-balance-reason"
          {...register('reason')}
          placeholder="Descreva o motivo do ajuste..."
          className="input-base w-full min-h-[80px] resize-none text-sm"
          maxLength={500}
        />
      </div>

      {adjust.isError && (
        <ErrorAlert message={adjust.error instanceof Error ? adjust.error.message : 'Erro'} />
      )}

      <div className="flex gap-3 justify-end pt-2">
        <Button variant="ghost" onClick={close}>Cancelar</Button>
        <Button
          variant={direction === 'debit' ? 'danger' : 'primary'}
          loading={adjust.isPending}
          disabled={!canSubmit}
          onClick={handleSubmit(onSubmit)}
        >
          Confirmar ajuste
        </Button>
      </div>
    </Modal>
  )
}

// Casos que atingiram o limite de 2 drops (apply_order_drop cancela em vez
// de reabrir) -- nada é automático aqui, o admin negocia com cliente e
// booster pelo chat do próprio pedido (já embutido em OrderDetail) e resolve
// os dois lados: reembolso do cliente (reusa o modal de reembolso manual
// abaixo) e/ou ajuste do saldo do booster.
function ReviewCaseCard({ item, boosterName, onOpenRefund }: { item: AdminReviewCase; boosterName?: string | null; onOpenRefund: (orderId: string) => void }) {
  const currency = useCurrency()
  const [adjustOpen, setAdjustOpen] = useState(false)

  return (
    <Card variant="operational" padding="md" className="border-danger/30 bg-danger/[0.03]">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-danger" />
            <Link to={`/admin/orders/${item.order_id}`} className="font-mono text-sm text-brand hover:underline">
              #{item.order_id.slice(0, 8).toUpperCase()}
            </Link>
            <span className="text-[10px] font-bold bg-danger/10 text-danger px-2 py-0.5 rounded-lg">
              {item.drop_count} drops
            </span>
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
            Reembolsar cliente
          </Button>
          {item.last_assigned_booster_id && (
            <Button variant="secondary" size="sm" leftIcon={<Wallet className="h-3.5 w-3.5" />} onClick={() => setAdjustOpen(true)}>
              Ajustar saldo do booster
            </Button>
          )}
        </div>
      </div>

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
function ReviewCasesSection({ onOpenRefund }: { onOpenRefund: (orderId: string) => void }) {
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

export function AdminRefundsPage() {
  const currency = useCurrency()
  const [searchParams] = useSearchParams()
  // Chegando daqui via "Marcar pra reembolsar" na página do pedido (admin)
  // -- abre o formulário de reembolso manual já com o pedido preenchido, em
  // vez do admin precisar copiar/colar o UUID de novo.
  const prefilledOrderId = searchParams.get('order_id') ?? ''
  const [newRefundOpen, setNewRefundOpen] = useState(!!prefilledOrderId)
  const [refundOrderId, setRefundOrderId] = useState(prefilledOrderId)

  function openRefundFor(orderId: string) {
    setRefundOrderId(orderId)
    setNewRefundOpen(true)
  }

  const { data: refunds, isLoading } = useAdminRefunds()
  const [search, setSearch] = useState('')
  const { value: statusFilter, onChange: setStatusFilter, countFor, filtered: statusFiltered } = useCountedFilterTabs(
    refunds, 'all' as Refund['status'] | 'all', (r, s) => s === 'all' || r.status === s,
  )
  const filtered = statusFiltered.filter((r) => !search.trim() || r.order_id.toLowerCase().includes(search.trim().toLowerCase()))
  const { page, pageItems, hasNextPage, onPrev, onNext } = usePagedList(filtered, 20, `${statusFilter}:${search}`)

  return (
    <div className="space-y-6">
      <ReviewCasesSection onOpenRefund={openRefundFor} />

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <p className="section-label mb-2">Financeiro</p>
          <h1 className="text-2xl font-bold text-ink">A analisar</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-secondary">
            Reembolsos processados pelo Mercado Pago e reembolsos manuais registrados por um admin.
          </p>
        </div>
        <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setNewRefundOpen(true)}>
          Novo reembolso
        </Button>
      </div>
      {(refunds?.length ?? 0) >= 100 && (
        <p className="text-xs text-warning">Mostrando os 100 reembolsos mais recentes — pode haver mais.</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SearchInput
          wrapperClassName="w-full sm:w-64 shrink-0"
          placeholder="Buscar por código do pedido..."
          aria-label="Buscar por código do pedido"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <FilterTabs
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'all', label: 'Todos', count: countFor('all') },
            { value: 'pending', label: REFUND_STATUS_LABEL.pending, count: countFor('pending') },
            { value: 'succeeded', label: REFUND_STATUS_LABEL.succeeded, count: countFor('succeeded') },
            { value: 'failed', label: REFUND_STATUS_LABEL.failed, count: countFor('failed') },
          ]}
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-36 w-full rounded-2xl" />)}
        </div>
      ) : !filtered.length ? (
        <div className="card p-0 backdrop-blur-none shadow-none bg-bg-surface">
          <EmptyState icon={RefreshCw} title="Nenhum reembolso emitido" />
        </div>
      ) : (
        <>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {pageItems.map((r) => (
            <Link key={r.id} to={`/admin/orders/${r.order_id}`}>
              <Card variant="interactive" padding="md" className="h-full flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-xs font-bold text-brand">#{r.order_id.slice(0, 8).toUpperCase()}</span>
                  <span className={`badge capitalize ${r.status === 'succeeded' ? 'text-success bg-success/10' : r.status === 'failed' ? 'text-danger bg-danger/10' : 'text-warning bg-warning/10'}`}>
                    {REFUND_STATUS_LABEL[r.status]}
                  </span>
                </div>
                <p className="text-lg font-black text-ink" data-tabular>{currency(r.amount)}</p>
                <p className="text-xs text-ink-secondary line-clamp-2">{r.reason}</p>
                <div className="flex items-center justify-between text-[11px] text-ink-muted mt-auto pt-1">
                  {r.is_manual ? (
                    <span className="badge text-[10px] font-bold bg-bg-raised text-ink-secondary">Manual</span>
                  ) : (
                    <span className="font-mono">{r.mp_refund_id?.slice(-10) ?? '—'}</span>
                  )}
                  <span>{formatDateTime(r.created_at)}</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
        <Pagination page={page} hasNextPage={hasNextPage} onPrev={onPrev} onNext={onNext} />
        </>
      )}

      <NewManualRefundModal key={refundOrderId} open={newRefundOpen} onClose={() => setNewRefundOpen(false)} initialOrderId={refundOrderId} />
    </div>
  )
}
