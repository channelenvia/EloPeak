import { useEffect, useMemo, useState } from 'react'
import { ActionBar } from '@/components/ui/ActionBar'
import { CardGrid } from '@/components/ui/CardGrid'
import { PageHeader } from '@/components/ui/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Link, useSearchParams } from 'react-router-dom'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertTriangle, Check, MessageCircle, Plus, RefreshCw, Undo2, Wallet, XCircle } from 'lucide-react'
import { Button, Card, CurrencyMaskedInput, EmptyState, ErrorAlert, FilterTabs, Modal, Pagination, SearchInput, Skeleton } from '@/components/ui'
import { formatDateTime } from '@/lib/utils'
import { usePagedList } from '@/hooks/usePagedList'
import type { Refund } from '@/types'
import { useCurrency } from '@/hooks/useCurrency'
import { useAdminAdjustBoosterBalance, useAdminRefunds, useAdminReviewCases, useProfileUsername, useProfileUsernames } from '@/api/admin'
import type { AdminReviewCase } from '@/api/admin'
import { useAdminCancelManualRefund, useAdminConfirmManualRefund, useAdminCreateManualRefund, useOrder, useOrderSettlementPreview } from '@/api/orders'
import { useBoosterPayoutTotals } from '@/api/payouts'
import { useCountedFilterTabs } from '@/hooks/useCountedFilterTabs'
import { CancelWithoutRefundModal } from '@/features/admin/components/CancelWithoutRefundModal'

const REFUND_STATUS_LABEL: Record<Refund['status'], string> = {
  pending: 'A reembolsar',
  succeeded: 'Reembolsado',
  failed: 'Falhou',
}

// Marcação manual desfeita pelo admin não é uma falha do provedor.
function refundStatusLabel(refund: Refund) {
  return refund.is_manual && refund.status === 'failed' ? 'Desfeito' : REFUND_STATUS_LABEL[refund.status]
}

const ORDER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Reembolso aqui é sempre tratado manualmente entre admin e cliente (PIX de
// volta por fora, combinado via DM/ticket, ou estorno do cartão no painel do
// Mercado Pago) -- este formulário só registra o
// que já aconteceu, não chama o Mercado Pago. Por isso pede o ID completo do
// pedido (não dá pra buscar por texto parcial) e mostra cliente/valor total
// do pedido encontrado como confirmação antes de deixar submeter.
interface ManualRefundFormData {
  orderId: string
  reason: string
}

function NewManualRefundModal({ open, onClose, initialOrderId = '' }: { open: boolean; onClose: () => void; initialOrderId?: string }) {
  const currency = useCurrency()
  const createRefund = useAdminCreateManualRefund()

  const { register, handleSubmit, watch, reset, formState: { errors, isValid } } = useForm<ManualRefundFormData>({
    resolver: zodResolver(z.object({
      orderId: z.string().refine((v) => ORDER_ID_PATTERN.test(v.trim()), 'ID inválido — cole o UUID completo do pedido (visível na URL da página do pedido).'),
      reason: z.string().trim().min(10, 'Motivo deve ter pelo menos 10 caracteres.').max(500),
    })),
    defaultValues: { orderId: initialOrderId, reason: '' },
    mode: 'onChange',
  })

  const orderId = watch('orderId')
  const trimmedId = orderId.trim()
  const looksLikeUuid = ORDER_ID_PATTERN.test(trimmedId)
  const { data: lookupOrder, isFetching: lookupLoading } = useOrder(looksLikeUuid ? trimmedId : undefined)
  const { data: customerUsername } = useProfileUsername(lookupOrder?.customer_id)

  const { data: preview, isFetching: previewLoading } = useOrderSettlementPreview(lookupOrder ? trimmedId : undefined)

  function close() {
    onClose()
    reset({ orderId: '', reason: '' })
  }

  const isUnderReview = lookupOrder?.status === 'under_review'
  const canSubmit = isValid && looksLikeUuid && !!lookupOrder && isUnderReview && !!preview && preview.refund_amount > 0

  function onSubmit(data: ManualRefundFormData) {
    createRefund.mutate({ orderId: data.orderId.trim(), reason: data.reason.trim() }, { onSuccess: close })
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) close() }}
      title="Marcar pra reembolsar"
      description="Cria o item em A reembolsar, sem chamar o Mercado Pago. Devolva o dinheiro por fora (PIX manual ou estorno do cartão no painel do Mercado Pago) e confirme no check: só então o pedido vira Reembolsado."
    >
      <div>
        <label htmlFor="manual-refund-order-id" className="text-xs font-semibold text-ink-secondary block mb-1.5">Número do pedido (ID completo)</label>
        <input
          id="manual-refund-order-id"
          {...register('orderId')}
          placeholder="Cole o ID completo do pedido…"
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

      {lookupOrder && !isUnderReview && (
        <p className="text-xs text-warning">Marque o pedido como &quot;Analisar&quot; antes de reembolsar ou cancelar.</p>
      )}
      {lookupOrder && previewLoading && <p className="text-xs text-ink-muted">Calculando…</p>}
      {preview && (
        <div className="rounded-lg bg-bg-raised px-3 py-2.5 text-xs space-y-1" data-testid="settlement-preview">
          <p className="font-semibold text-ink-secondary">Cálculo (definido pelo sistema)</p>
          <p>Valor pago: <span className="font-semibold text-ink">{currency(preview.paid)}</span> · Progresso: <span className="font-semibold text-ink">{preview.progress_pct}%</span></p>
          <p>Booster recebe pelo progresso: <span className="font-semibold text-ink">{currency(preview.booster_credit)}</span></p>
          <p>Reembolso ao cliente: <span className="font-semibold text-success">{currency(preview.refund_amount)}</span></p>
        </div>
      )}

      <div>
        <label htmlFor="manual-refund-reason" className="text-xs font-semibold text-ink-secondary block mb-1.5">Motivo (mín. 10 caracteres)</label>
        <textarea
          id="manual-refund-reason"
          {...register('reason')}
          placeholder="Descreva o motivo do reembolso…"
          className="input-base w-full min-h-[80px] resize-none text-sm"
          maxLength={500}
        />
      </div>

      {createRefund.isError && (
        <ErrorAlert message={createRefund.error instanceof Error ? createRefund.error.message : 'Erro'} />
      )}

      <ActionBar>
        <Button disabled={createRefund.isPending} variant="secondary" onClick={close}>Cancelar</Button>
        <Button
          variant="danger"
          loading={createRefund.isPending}
          disabled={!canSubmit}
          onClick={handleSubmit(onSubmit)}
        >
          Marcar pra reembolsar
        </Button>
      </ActionBar>
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
      amountCents: z.number({ error: 'Informe um valor.' }).int().min(1, 'Informe um valor.'),
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
          placeholder="Descreva o motivo do ajuste…"
          className="input-base w-full min-h-[80px] resize-none text-sm"
          maxLength={500}
        />
      </div>

      {adjust.isError && (
        <ErrorAlert message={adjust.error instanceof Error ? adjust.error.message : 'Erro'} />
      )}

      <ActionBar>
        <Button disabled={adjust.isPending} variant="secondary" onClick={close}>Cancelar</Button>
        <Button
          variant={direction === 'debit' ? 'danger' : 'primary'}
          loading={adjust.isPending}
          disabled={!canSubmit}
          onClick={handleSubmit(onSubmit)}
        >
          Confirmar ajuste
        </Button>
      </ActionBar>
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

function ConfirmRefundModal({ refund, open, onClose }: { refund: Refund; open: boolean; onClose: () => void }) {
  const currency = useCurrency()
  const confirm = useAdminConfirmManualRefund()

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) onClose() }}
      title="Confirmar reembolso feito?"
      description={`Confirme só depois de devolver ${currency(refund.amount)} ao cliente (PIX manual ou estorno do cartão no painel do Mercado Pago). O pedido passa para Reembolsado e o cliente é avisado.`}
      maxWidth="sm"
    >
      {confirm.isError && <ErrorAlert message={confirm.error instanceof Error ? confirm.error.message : 'Erro'} />}
      <ActionBar>
        <Button variant="secondary" disabled={confirm.isPending} onClick={onClose}>Voltar</Button>
        <Button
          loading={confirm.isPending}
          leftIcon={<Check className="h-4 w-4" />}
          onClick={() => confirm.mutate(refund.id, { onSuccess: onClose })}
        >
          Confirmar reembolso
        </Button>
      </ActionBar>
    </Modal>
  )
}

function RefundCard({ refund: r }: { refund: Refund }) {
  const currency = useCurrency()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const undo = useAdminCancelManualRefund()
  const isAwaitingRefund = r.is_manual && r.status === 'pending'
  const statusTone = r.status === 'succeeded' ? 'text-success bg-success/10' : r.status === 'failed' ? 'text-danger bg-danger/10' : 'text-warning bg-warning/10'

  return (
    <Card variant="operational" padding="md" className="h-full flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <Link to={`/admin/orders/${r.order_id}`} className="font-mono text-xs font-bold text-brand hover:underline">
          #{r.order_id.slice(0, 8).toUpperCase()}
        </Link>
        <span className={`badge capitalize ${statusTone}`}>{refundStatusLabel(r)}</span>
      </div>
      <p className="text-lg font-black text-ink" data-tabular>{currency(r.amount)}</p>
      <p className="text-xs text-ink-secondary line-clamp-2">{r.reason}</p>
      <div className="flex items-center justify-between text-xs text-ink-muted mt-auto pt-1">
        {r.is_manual ? (
          <span className="badge text-2xs font-bold bg-bg-raised text-ink-secondary">Manual</span>
        ) : (
          <span className="font-mono">{r.mp_refund_id?.slice(-10) ?? '—'}</span>
        )}
        <span>{formatDateTime(r.created_at)}</span>
      </div>

      {isAwaitingRefund && (
        <div className="flex items-center gap-2 border-t border-border-subtle pt-3">
          <Button size="sm" leftIcon={<Check className="h-3.5 w-3.5" />} onClick={() => setConfirmOpen(true)}>
            Já reembolsei
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={undo.isPending}
            leftIcon={<Undo2 className="h-3.5 w-3.5" />}
            onClick={() => undo.mutate(r.id)}
          >
            Desfazer
          </Button>
        </div>
      )}
      {undo.isError && <ErrorAlert message={undo.error instanceof Error ? undo.error.message : 'Erro'} />}
      {isAwaitingRefund && <ConfirmRefundModal refund={r} open={confirmOpen} onClose={() => setConfirmOpen(false)} />}
    </Card>
  )
}

export function AdminRefundsPage() {
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

      <PageHeader eyebrow="Financeiro" title="A reembolsar" description="Reembolsos marcados por um admin e reembolsos processados pelo Mercado Pago. Depois de devolver o dinheiro, confirme no check: o pedido vira Reembolsado e o item continua aqui." actions={<><Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setNewRefundOpen(true)}>
          Marcar pra reembolsar
        </Button></>} />
      {(refunds?.length ?? 0) >= 100 && (
        <p className="text-xs text-warning">Mostrando os 100 reembolsos mais recentes — pode haver mais.</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SearchInput
          wrapperClassName="w-full sm:w-64 shrink-0"
          placeholder="Buscar por código do pedido…"
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
        <CardGrid cols={4}>
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-36 w-full rounded-2xl" />)}
        </CardGrid>
      ) : !filtered.length ? (
        <Card variant="operational" padding="none">
          <EmptyState icon={RefreshCw} title="Nenhum reembolso a fazer" />
        </Card>
      ) : (
        <>
        <CardGrid cols={4}>
          {pageItems.map((r) => (
            <RefundCard key={r.id} refund={r} />
          ))}
        </CardGrid>
        <Pagination page={page} hasNextPage={hasNextPage} onPrev={onPrev} onNext={onNext} />
        </>
      )}

      <NewManualRefundModal key={refundOrderId} open={newRefundOpen} onClose={() => setNewRefundOpen(false)} initialOrderId={refundOrderId} />
    </div>
  )
}
