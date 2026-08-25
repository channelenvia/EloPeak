// src/features/admin/pages/Drops.tsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { Button, EmptyState, Skeleton, Modal } from '@/components/ui'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { timeAgo } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import { useAdminDropRequests, useResolveDropRequest } from '@/api/admin'
import { useBoosterNames } from '@/api/boosters'

export function AdminDropsPage() {
  const currency = useCurrency()
  const [resolving, setResolving] = useState<{ id: string; approve: boolean } | null>(null)
  const [adminNote, setAdminNote] = useState('')

  const { data: requests, isLoading } = useAdminDropRequests()

  // Nome do booster em vez do UUID cru — mesma ideia do admin/pages/OrderDetail.tsx.
  const boosterIds = [...new Set((requests ?? []).map((r) => r.booster_id))]
  const { data: boosterNames } = useBoosterNames(boosterIds)

  const resolveMutation = useResolveDropRequest()
  const resolve = {
    isPending: resolveMutation.isPending,
    mutate: (params: { id: string; approve: boolean; note: string }) =>
      resolveMutation.mutate(
        { requestId: params.id, approve: params.approve, adminNote: params.note || undefined },
        { onSuccess: () => { setResolving(null); setAdminNote('') } },
      ),
  }

  const pendingRequests = requests?.filter(r => r.status === 'pending') ?? []
  const pastRequests = requests?.filter(r => r.status !== 'pending') ?? []

  const ROLE_LABEL: Record<string, string> = { booster: 'Booster', admin: 'Admin', customer: 'Cliente' }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">Solicitações de Drop</h1>
      {(requests?.length ?? 0) >= 100 && (
        <p className="text-xs text-warning">Mostrando as 100 solicitações mais recentes — pode haver mais.</p>
      )}

      {/* Pending */}
      <section>
        <h3 className="text-base font-semibold text-ink mb-3">Pendentes</h3>
        <div className="card p-0">
          {isLoading ? (
            <div className="p-4"><Skeleton className="h-48 w-full" /></div>
          ) : !pendingRequests.length ? (
            <EmptyState icon={AlertTriangle} title="Nenhuma solicitação pendente" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Booster</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Vitórias / Derrotas</TableHead>
                  <TableHead>Conclusão / Pagamento</TableHead>
                  <TableHead>Há quanto tempo</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingRequests.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">
                      <Link to={`/admin/orders/${r.order_id}`} className="text-brand hover:underline">
                        #{r.order_id.slice(0, 8).toUpperCase()}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="badge text-[10px] font-bold bg-bg-elevated text-ink-secondary">
                        {ROLE_LABEL[r.requested_by_role] ?? r.requested_by_role}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">
                      {boosterNames?.get(r.booster_id) ? (
                        <Link to={`/admin/boosters/${boosterNames.get(r.booster_id)!.id}`} className="text-brand hover:underline font-medium">
                          {boosterNames.get(r.booster_id)!.display_name}
                        </Link>
                      ) : (
                        <span className="font-mono">{r.booster_id.slice(0, 8)}…</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <p className="text-xs text-ink-secondary max-w-xs truncate">{r.reason}</p>
                    </TableCell>
                    <TableCell>
                      <span className="text-success font-semibold">{r.wins_at_request}W</span>
                      {' / '}
                      <span className="text-danger font-semibold">{r.losses_at_request}L</span>
                    </TableCell>
                    <TableCell>
                      <span className={`font-bold ${r.penalty_amount > 0 ? 'text-success' : 'text-ink-muted'}`}>
                        {r.penalty_pct}% ({currency(r.penalty_amount)})
                      </span>
                    </TableCell>
                    <TableCell>{timeAgo(r.created_at)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="xs"
                          variant="success"
                          leftIcon={<CheckCircle2 className="h-3 w-3" />}
                          onClick={() => setResolving({ id: r.id, approve: true })}
                        >
                          Aprovar
                        </Button>
                        <Button
                          size="xs"
                          variant="danger"
                          leftIcon={<XCircle className="h-3 w-3" />}
                          onClick={() => setResolving({ id: r.id, approve: false })}
                        >
                          Rejeitar
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </section>

      {/* History */}
      {pastRequests.length > 0 && (
        <section>
          <h3 className="text-base font-semibold text-ink mb-3">Histórico</h3>
          <div className="card p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Conclusão / Pagamento</TableHead>
                  <TableHead>Resolvido</TableHead>
                  <TableHead>Nota admin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pastRequests.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">
                      <Link to={`/admin/orders/${r.order_id}`} className="text-brand hover:underline">
                        #{r.order_id.slice(0, 8).toUpperCase()}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="badge text-[10px] font-bold bg-bg-elevated text-ink-secondary">
                        {ROLE_LABEL[r.requested_by_role] ?? r.requested_by_role}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`badge text-xs font-bold ${r.status === 'approved' ? 'text-success bg-success/10' : 'text-danger bg-danger/10'}`}>
                        {r.status === 'approved' ? 'Aprovado' : 'Rejeitado'}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">{r.penalty_pct}% ({currency(r.penalty_amount)})</TableCell>
                    <TableCell className="text-xs">{r.resolved_at ? timeAgo(r.resolved_at) : '—'}</TableCell>
                    <TableCell><p className="text-xs text-ink-secondary max-w-xs truncate">{r.admin_note ?? '—'}</p></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      {/* Resolve modal */}
      <Modal
        open={!!resolving}
        onOpenChange={(open) => { if (!open) { setResolving(null); setAdminNote('') } }}
        title={resolving?.approve ? 'Aprovar solicitação de drop' : 'Rejeitar solicitação de drop'}
        description={resolving?.approve
          ? 'O pedido volta pro painel. Pagamento proporcional ao progresso já concluído.'
          : 'O pedido volta ao status anterior.'}
      >
        <div>
          <label className="text-xs font-semibold text-ink-secondary block mb-1.5">
            Nota para o booster (opcional)
          </label>
          <textarea
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
            placeholder="Justificativa ou observação..."
            className="input-base w-full min-h-[80px] resize-none text-sm"
          />
        </div>
        <div className="flex gap-3 justify-end pt-2">
          <Button variant="ghost" onClick={() => { setResolving(null); setAdminNote('') }}>
            Cancelar
          </Button>
          <Button
            variant={resolving?.approve ? 'success' : 'danger'}
            loading={resolve.isPending}
            onClick={() => resolving && resolve.mutate({ id: resolving.id, approve: resolving.approve, note: adminNote })}
          >
            Confirmar
          </Button>
        </div>
      </Modal>
    </div>
  )
}
