import { useState } from 'react'
import { Banknote, CheckCircle2, Clock3, FileText, ShieldCheck, Upload, XCircle } from 'lucide-react'
import { Button, Card, EmptyState, Modal, Skeleton } from '@/components/ui'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { cn, formatDateTime, PAYOUT_REQUEST_STATUS_LABEL } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import {
  useAdminPayoutRequests, useAdminReviewPayoutRequest, useAdminMarkPayoutPaid, usePayoutRequestBreakdown,
} from '@/api/payouts'
import { uploadPayoutProof, getPayoutProofSignedUrl } from '@/api/payouts'
import type { PayoutRequestRow, PayoutRequestStatus } from '@/api/payouts'

const STATUS_LABEL = PAYOUT_REQUEST_STATUS_LABEL
const STATUS_COLOR: Record<PayoutRequestStatus, string> = {
  requested: 'text-warning bg-warning/10 border-warning/20',
  under_review: 'text-warning bg-warning/10 border-warning/20',
  approved: 'text-warning bg-warning/10 border-warning/20',
  paid: 'text-success bg-success/10 border-success/20',
  rejected: 'text-danger bg-danger/10 border-danger/20',
  canceled: 'text-ink-muted bg-bg-elevated border-border-subtle',
}
// Só requested/under_review/approved têm ação pendente pro admin -- o resto
// (pago/rejeitado/cancelado) é estado final, só consulta.
const PENDING_STATUSES: PayoutRequestStatus[] = ['requested', 'under_review', 'approved']

function StatusBadge({ status }: { status: PayoutRequestStatus }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold', STATUS_COLOR[status])}>
      {STATUS_LABEL[status]}
    </span>
  )
}

function StatCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: React.ElementType; tone: string }) {
  return (
    <Card padding="md" className="min-w-0">
      <div className="flex items-center gap-3">
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', tone)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-ink-muted">{label}</p>
          <p className="truncate text-lg font-black text-ink" data-tabular>{value}</p>
        </div>
      </div>
    </Card>
  )
}

// Ação única por solicitação: o admin escolhe Pago ou Rejeitado -- sem etapa
// intermediária de "colocar em revisão"/"aprovar" separada na tela (o
// backend ainda passa por 'approved' internamente antes de 'paid', porque
// admin_mark_payout_paid exige isso, mas isso fica encadeado aqui dentro,
// invisível pro admin).
function PayoutActionModal({ request, onClose }: { request: PayoutRequestRow; onClose: () => void }) {
  const currency = useCurrency()
  const { data: breakdown, isLoading } = usePayoutRequestBreakdown(request.id)
  const review = useAdminReviewPayoutRequest()
  const markPaid = useAdminMarkPayoutPaid()
  const [note, setNote] = useState('')
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [working, setWorking] = useState(false)
  const [proofSignedUrl, setProofSignedUrl] = useState<string | null>(null)

  const isPending = PENDING_STATUSES.includes(request.status)
  const canReject = request.status === 'requested' || request.status === 'under_review'

  async function handleMarkPaid() {
    if (!proofFile) return
    setWorking(true)
    try {
      if (request.status !== 'approved') {
        await review.mutateAsync({ requestId: request.id, newStatus: 'approved' })
      }
      const path = await uploadPayoutProof({ requestId: request.id, file: proofFile })
      await markPaid.mutateAsync({ requestId: request.id, proofUrl: path })
      onClose()
    } catch {
      // Erro já refletido via review.isError / markPaid.isError abaixo.
    } finally {
      setWorking(false)
    }
  }

  function handleReject() {
    review.mutate({ requestId: request.id, newStatus: 'rejected', note }, { onSuccess: onClose })
  }

  async function handleViewProof() {
    if (!request.proof_url) return
    const url = await getPayoutProofSignedUrl(request.proof_url)
    setProofSignedUrl(url)
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <Modal open onOpenChange={(open) => !open && onClose()} title={`Solicitação de saque · ${request.booster_legal_name_snapshot ?? request.booster_id.slice(0, 8)}`}>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><p className="text-xs text-ink-muted">CPF</p><p className="font-semibold text-ink" data-tabular>{request.booster_cpf_snapshot ?? '—'}</p></div>
          <div><p className="text-xs text-ink-muted">Nome legal</p><p className="font-semibold text-ink">{request.booster_legal_name_snapshot ?? '—'}</p></div>
          <div><p className="text-xs text-ink-muted">Valor solicitado</p><p className="font-bold text-ink" data-tabular>{currency(request.amount)}</p></div>
          <div><p className="text-xs text-ink-muted">Status</p><StatusBadge status={request.status} /></div>
          <div><p className="text-xs text-ink-muted">Solicitado em</p><p className="text-ink-secondary">{formatDateTime(request.requested_at)}</p></div>
          {request.paid_at && <div><p className="text-xs text-ink-muted">Pago em</p><p className="text-success">{formatDateTime(request.paid_at)}</p></div>}
        </div>

        <div>
          <p className="mb-2 text-xs font-bold uppercase text-ink-secondary">Pedidos que compõem este saque</p>
          {isLoading ? <Skeleton className="h-24 w-full" /> : !breakdown?.length ? (
            <p className="text-[10px] text-ink-muted">Nenhum pedido encontrado para composição.</p>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {breakdown.map((row) => (
                <div key={row.order_id} className="flex items-center justify-between rounded-lg bg-bg-elevated px-3 py-2 text-xs">
                  <span className="font-mono text-brand">{row.order_id.slice(0, 8).toUpperCase()}</span>
                  <span className="text-ink-secondary">{row.service_type}</span>
                  <span className="font-semibold text-ink" data-tabular>{currency(row.amount_included)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {isPending && (
          <div className="space-y-4 border-t border-border-subtle pt-4">
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase text-ink-secondary">Marcar como pago</p>
              <label className="flex items-center gap-2 rounded-xl border border-dashed border-border-strong px-4 py-3 text-sm cursor-pointer hover:border-brand/50">
                <Upload className="h-4 w-4 text-ink-muted shrink-0" />
                <span className="text-ink-secondary truncate">{proofFile?.name ?? 'Selecionar comprovante (PDF/imagem)'}</span>
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setProofFile(e.target.files?.[0] ?? null)} />
              </label>
              <Button className="w-full" variant="success" disabled={!proofFile} loading={working} leftIcon={<ShieldCheck className="h-4 w-4" />} onClick={handleMarkPaid}>
                Marcar como pago
              </Button>
            </div>

            {canReject && (
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase text-ink-secondary">Rejeitar</p>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Motivo da rejeição (obrigatório)"
                  className="input-base w-full min-h-16 resize-none text-sm"
                />
                <Button className="w-full" variant="danger" loading={review.isPending} disabled={note.trim().length < 3} leftIcon={<XCircle className="h-4 w-4" />} onClick={handleReject}>
                  Rejeitar solicitação
                </Button>
              </div>
            )}

            {(review.isError || markPaid.isError) && (
              <p className="text-xs text-danger">
                {(review.error instanceof Error && review.error.message) || (markPaid.error instanceof Error && markPaid.error.message) || 'Erro ao processar a solicitação.'}
              </p>
            )}
          </div>
        )}

        {request.status === 'paid' && request.proof_url && (
          <Button variant="secondary" size="sm" leftIcon={<FileText className="h-4 w-4" />} onClick={handleViewProof}>
            Ver comprovante
          </Button>
        )}
        {proofSignedUrl && <p className="text-[10px] text-ink-muted break-all">{proofSignedUrl}</p>}
      </div>
    </Modal>
  )
}

export function AdminPayoutsPage() {
  const currency = useCurrency()
  const [selected, setSelected] = useState<PayoutRequestRow | null>(null)
  const { data: requests, isLoading } = useAdminPayoutRequests()

  const pendingTotal = (requests ?? []).filter((r) => PENDING_STATUSES.includes(r.status)).reduce((sum, r) => sum + r.amount, 0)
  const paidTotal = (requests ?? []).filter((r) => r.status === 'paid').reduce((sum, r) => sum + r.amount, 0)

  return (
    <div className="space-y-6">
      <div>
        <p className="section-label mb-2">Financeiro</p>
        <h1 className="text-2xl font-bold text-ink">Solicitações de saque</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-secondary">
          Repasses aos boosters, sacados do saldo acumulado no ledger financeiro — não são mais uma ação por pedido.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard label="Aguardando" value={currency(pendingTotal)} icon={Clock3} tone="bg-warning/10 text-warning" />
        <StatCard label="Pago" value={currency(paidTotal)} icon={CheckCircle2} tone="bg-success/10 text-success" />
      </div>

      <Card padding="none">
        {isLoading ? (
          <div className="p-4"><Skeleton className="h-56 w-full" /></div>
        ) : !requests?.length ? (
          <EmptyState icon={Banknote} title="Nenhuma solicitação encontrada." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>CPF</TableHead>
                <TableHead>Nome legal</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Solicitado</TableHead>
                <TableHead>Última atualização</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((row) => (
                <TableRow key={row.id}>
                  <TableCell><span data-tabular>{row.booster_cpf_snapshot ?? '—'}</span></TableCell>
                  <TableCell><span className="font-semibold text-ink">{row.booster_legal_name_snapshot ?? '—'}</span></TableCell>
                  <TableCell className="text-base font-black text-ink" data-tabular>{currency(row.amount)}</TableCell>
                  <TableCell><StatusBadge status={row.status} /></TableCell>
                  <TableCell><span className="text-xs">{formatDateTime(row.requested_at)}</span></TableCell>
                  <TableCell><span className="text-xs">{formatDateTime(row.updated_at)}</span></TableCell>
                  <TableCell className="text-right">
                    <Button size="xs" variant="secondary" onClick={() => setSelected(row)}>
                      {PENDING_STATUSES.includes(row.status) ? 'Ação' : 'Ver detalhes'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {selected && <PayoutActionModal request={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
