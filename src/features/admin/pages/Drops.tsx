// src/features/admin/pages/Drops.tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { Button, EmptyState, Skeleton } from '@/components/ui'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { supabase } from '@/lib/supabase'
import { timeAgo } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import type { OrderDropRequest } from '@/types'

export function AdminDropsPage() {
  const queryClient = useQueryClient()
  const currency = useCurrency()
  const [resolving, setResolving] = useState<{ id: string; approve: boolean } | null>(null)
  const [adminNote, setAdminNote] = useState('')

  const { data: requests, isLoading } = useQuery({
    queryKey: ['admin-drop-requests'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_drop_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data as OrderDropRequest[]
    },
    refetchInterval: 15000,
  })

  const resolve = useMutation({
    mutationFn: async ({ id, approve, note }: { id: string; approve: boolean; note: string }) => {
      const { data, error } = await supabase.rpc('resolve_drop_request', {
        p_request_id: id,
        p_approve: approve,
        p_admin_note: note || null,
      })
      if (error) throw error
      const result = data as { success: boolean; error?: string }
      if (!result.success) throw new Error(result.error ?? 'Erro ao resolver solicitação')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-drop-requests'] })
      setResolving(null)
      setAdminNote('')
    },
  })

  const pendingRequests = requests?.filter(r => r.status === 'pending') ?? []
  const pastRequests = requests?.filter(r => r.status !== 'pending') ?? []

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">Solicitações de Drop</h1>

      {/* Pending */}
      <section>
        <h2 className="text-sm font-semibold text-ink-secondary uppercase tracking-wide mb-3">Pendentes</h2>
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
                  <TableHead>Booster</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Vitórias / Derrotas</TableHead>
                  <TableHead>Penalidade</TableHead>
                  <TableHead>Há quanto tempo</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingRequests.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">#{r.order_id.slice(0, 8).toUpperCase()}</TableCell>
                    <TableCell className="font-mono text-xs">{r.booster_id.slice(0, 8)}…</TableCell>
                    <TableCell>
                      <p className="text-xs text-ink-secondary max-w-xs truncate">{r.reason}</p>
                    </TableCell>
                    <TableCell>
                      <span className="text-success font-semibold">{r.wins_at_request}W</span>
                      {' / '}
                      <span className="text-danger font-semibold">{r.losses_at_request}L</span>
                    </TableCell>
                    <TableCell>
                      <span className={`font-bold ${r.penalty_pct > 0 ? 'text-warning' : 'text-ink-muted'}`}>
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
          <h2 className="text-sm font-semibold text-ink-secondary uppercase tracking-wide mb-3">Histórico</h2>
          <div className="card p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Penalidade</TableHead>
                  <TableHead>Resolvido</TableHead>
                  <TableHead>Nota admin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pastRequests.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">#{r.order_id.slice(0, 8).toUpperCase()}</TableCell>
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
      {resolving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="card w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-ink">
              {resolving.approve ? 'Aprovar solicitação de drop' : 'Rejeitar solicitação de drop'}
            </h2>
            <p className="text-sm text-ink-secondary">
              {resolving.approve
                ? 'O pedido será cancelado e a penalidade deduzida dos ganhos do booster.'
                : 'O pedido voltará ao status em andamento.'}
            </p>
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
            <div className="flex gap-3 justify-end">
              <Button variant="ghost" onClick={() => { setResolving(null); setAdminNote('') }}>
                Cancelar
              </Button>
              <Button
                variant={resolving.approve ? 'success' : 'danger'}
                loading={resolve.isPending}
                onClick={() => resolve.mutate({ id: resolving.id, approve: resolving.approve, note: adminNote })}
              >
                Confirmar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
