import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, MessageCircle, Plus, RefreshCw, Wallet } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, CurrencyMaskedInput, EmptyState, ErrorAlert, Modal, Skeleton } from '@/components/ui'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { formatDateTime } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import type { Refund } from '@/types'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import { useAdminAdjustBoosterBalance, useAdminRefunds, useAdminReviewCases } from '@/api/admin'
import type { AdminReviewCase } from '@/api/admin'
import { useAdminCreateManualRefund, useOrder } from '@/api/orders'

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
function NewManualRefundModal({ open, onClose, initialOrderId = '' }: { open: boolean; onClose: () => void; initialOrderId?: string }) {
  const currency = useCurrency()
  const [orderId, setOrderId] = useState(initialOrderId)
  const [reason, setReason] = useState('')
  const [amountCents, setAmountCents] = useState(0)
  const createRefund = useAdminCreateManualRefund()

  const trimmedId = orderId.trim()
  const looksLikeUuid = ORDER_ID_PATTERN.test(trimmedId)
  const { data: lookupOrder, isFetching: lookupLoading } = useOrder(looksLikeUuid ? trimmedId : undefined)
  const { data: customerUsername } = useQuery({
    queryKey: ['admin', 'refund-customer', lookupOrder?.customer_id],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('username').eq('id', lookupOrder!.customer_id).maybeSingle()
      return data?.username ?? null
    },
    enabled: !!lookupOrder?.customer_id,
  })

  function close() {
    onClose()
    setOrderId('')
    setReason('')
    setAmountCents(0)
  }

  const canSubmit = looksLikeUuid && !!lookupOrder && reason.trim().length >= 10 && amountCents > 0

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) close() }}
      title="Novo reembolso manual"
      description="Registra um reembolso manual (PIX por fora) sem chamar o Mercado Pago."
    >
      <div>
        <label className="text-xs font-semibold text-ink-secondary block mb-1.5">Número do pedido (ID completo)</label>
        <input
          value={orderId}
          onChange={(e) => setOrderId(e.target.value)}
          placeholder="Cole o ID completo do pedido..."
          className="input-base w-full text-sm font-mono"
        />
        {trimmedId.length > 0 && !looksLikeUuid && (
          <p className="text-xs text-warning mt-1">ID inválido — cole o UUID completo do pedido (visível na URL da página do pedido).</p>
        )}
        {looksLikeUuid && lookupLoading && <p className="text-xs text-ink-muted mt-1">Buscando pedido…</p>}
        {looksLikeUuid && !lookupLoading && !lookupOrder && <p className="text-xs text-danger mt-1">Pedido não encontrado.</p>}
        {lookupOrder && (
          <p className="text-xs text-ink-secondary mt-1.5 bg-bg-elevated rounded-lg px-3 py-2">
            Cliente: <span className="font-semibold text-ink">{customerUsername ?? 'Carregando…'}</span> · Total do pedido: <span className="font-semibold text-ink">{currency(lookupOrder.total_price)}</span>
          </p>
        )}
      </div>

      <div>
        <label className="text-xs font-semibold text-ink-secondary block mb-1.5">Valor do reembolso</label>
        <CurrencyMaskedInput valueCents={amountCents} onChangeCents={setAmountCents} />
      </div>

      <div>
        <label className="text-xs font-semibold text-ink-secondary block mb-1.5">Motivo (mín. 10 caracteres)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
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
          onClick={() => createRefund.mutate(
            { orderId: trimmedId, reason: reason.trim(), amount: amountCents / 100 },
            { onSuccess: close },
          )}
        >
          Registrar reembolso
        </Button>
      </div>
    </Modal>
  )
}

function AdjustBoosterBalanceModal({ boosterId, open, onClose }: { boosterId: string; open: boolean; onClose: () => void }) {
  const [amountCents, setAmountCents] = useState(0)
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit')
  const [reason, setReason] = useState('')
  const adjust = useAdminAdjustBoosterBalance()

  function close() {
    onClose()
    setAmountCents(0)
    setReason('')
    setDirection('credit')
  }

  const canSubmit = amountCents > 0 && reason.trim().length >= 10

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
        <CurrencyMaskedInput valueCents={amountCents} onChangeCents={setAmountCents} />
      </div>

      <div>
        <label className="text-xs font-semibold text-ink-secondary block mb-1.5">Motivo (mín. 10 caracteres)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
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
          onClick={() => adjust.mutate(
            { boosterId, amount: direction === 'debit' ? -(amountCents / 100) : amountCents / 100, reason: reason.trim() },
            { onSuccess: close },
          )}
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
function ReviewCaseCard({ item, onOpenRefund }: { item: AdminReviewCase; onOpenRefund: (orderId: string) => void }) {
  const currency = useCurrency()
  const [adjustOpen, setAdjustOpen] = useState(false)
  const { data: boosterName } = useQuery({
    queryKey: ['admin', 'review-case-booster', item.last_assigned_booster_id],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('username').eq('id', item.last_assigned_booster_id!).maybeSingle()
      return data?.username ?? null
    },
    enabled: !!item.last_assigned_booster_id,
  })

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

function ReviewCasesSection({ onOpenRefund }: { onOpenRefund: (orderId: string) => void }) {
  const { data: cases, isLoading } = useAdminReviewCases()

  if (isLoading) return <Skeleton className="h-24 rounded-2xl" />
  if (!cases || cases.length === 0) return null

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-ink">Casos em análise ({cases.length})</h2>
      {cases.map((item) => (
        <ReviewCaseCard key={item.order_id} item={item} onOpenRefund={onOpenRefund} />
      ))}
    </div>
  )
}

export function AdminRefundsPage() {
  const { t } = useTranslation()
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

  return (
    <div className="space-y-6">
      <ReviewCasesSection onOpenRefund={openRefundFor} />

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <p className="section-label mb-2">Financeiro</p>
          <h1 className="text-2xl font-bold text-ink">{t('admin.refunds.title')}</h1>
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
      <div className="card p-0 backdrop-blur-none shadow-none bg-bg-surface">
        {isLoading ? <div className="p-4"><Skeleton className="h-48 w-full" /></div> :
          !refunds?.length ? <EmptyState icon={RefreshCw} title={t('admin.refunds.empty')} /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.refunds.table.id')}</TableHead>
                <TableHead>{t('admin.refunds.table.order')}</TableHead>
                <TableHead>{t('admin.refunds.table.amount')}</TableHead>
                <TableHead>{t('admin.refunds.table.reason')}</TableHead>
                <TableHead>{t('admin.refunds.table.status')}</TableHead>
                <TableHead>{t('admin.refunds.table.date')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {refunds.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    {r.is_manual ? (
                      <span className="badge text-[10px] font-bold bg-bg-elevated text-ink-secondary">Manual</span>
                    ) : (
                      <span className="font-mono text-xs">{r.mp_refund_id?.slice(-10) ?? '—'}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link to={`/admin/orders/${r.order_id}`} className="font-mono text-xs text-brand hover:underline">
                      {r.order_id.slice(0, 8).toUpperCase()}
                    </Link>
                  </TableCell>
                  <TableCell className="font-semibold text-ink">{currency(r.amount)}</TableCell>
                  <TableCell>{r.reason}</TableCell>
                  <TableCell>
                    <span className={`badge capitalize ${r.status === 'succeeded' ? 'text-success bg-success/10' : r.status === 'failed' ? 'text-danger bg-danger/10' : 'text-warning bg-warning/10'}`}>
                      {REFUND_STATUS_LABEL[r.status]}
                    </span>
                  </TableCell>
                  <TableCell>{formatDateTime(r.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <NewManualRefundModal key={refundOrderId} open={newRefundOpen} onClose={() => setNewRefundOpen(false)} initialOrderId={refundOrderId} />
    </div>
  )
}
