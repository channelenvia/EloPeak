import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, RefreshCw } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Button, CurrencyMaskedInput, EmptyState, ErrorAlert, Modal, Skeleton } from '@/components/ui'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { formatDateTime } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import type { Refund } from '@/types'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import { useAdminRefunds } from '@/api/admin'
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
function NewManualRefundModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const currency = useCurrency()
  const [orderId, setOrderId] = useState('')
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

export function AdminRefundsPage() {
  const { t } = useTranslation()
  const currency = useCurrency()
  const [newRefundOpen, setNewRefundOpen] = useState(false)

  const { data: refunds, isLoading } = useAdminRefunds()

  return (
    <div className="space-y-6">
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
      <div className="card p-0">
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

      <NewManualRefundModal open={newRefundOpen} onClose={() => setNewRefundOpen(false)} />
    </div>
  )
}
