// src/features/admin/pages/Drops.tsx
import { parseCompletionPct } from '@/lib/coachCompletion'
import { QueryErrorNotice } from '@/components/QueryErrorNotice'
import { useEffect, useState } from 'react'
import { ActionBar } from '@/components/ui/ActionBar'
import { CardGrid } from '@/components/ui/CardGrid'
import { PageHeader } from '@/components/ui/PageHeader'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { Button, Card, EmptyState, Pagination, SearchInput, Skeleton, Modal } from '@/components/ui'
import { timeAgo } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import { useAdminDropRequests, useResolveDropRequest } from '@/api/admin'
import { useBoosterNames } from '@/api/boosters'
import { useProfileUsernames } from '@/api/admin'
import { usePagedList } from '@/hooks/usePagedList'

export function AdminDropsPage() {
  const currency = useCurrency()
  const [resolving, setResolving] = useState<{ id: string; approve: boolean } | null>(null)
  const [adminNote, setAdminNote] = useState('')
  // Coaching não tem métrica automática de progresso (order_drop_completion_
  // pct sempre retorna 0 pra ele) -- pede quanto do pacote o coach já deu
  // antes de aprovar o drop, em vez de pagar sempre 0% (ver migration
  // 20260908090000). Só usado quando a solicitação pendente é de coaching.
  const [completionPct, setCompletionPct] = useState('')
  // O Modal só é fechado (zerando completionPct) via Cancelar/backdrop/
  // sucesso -- mas `resolving` também pode trocar direto de uma solicitação
  // pra outra sem passar por ali (ex.: o valor de `id` muda mantendo o
  // modal "aberto"). Sem isso, um % digitado pra uma solicitação de coaching
  // podia vazar como o % de outra se o admin abrisse uma segunda sem fechar
  // a primeira antes.
  useEffect(() => {
    setCompletionPct('')
  }, [resolving?.id])

  const [search, setSearch] = useState('')

  const { data: requests, isLoading, isError, error, refetch } = useAdminDropRequests()

  // Nome do booster em vez do UUID cru — mesma ideia do admin/pages/OrderDetail.tsx.
  const boosterIds = [...new Set((requests ?? []).map((r) => r.booster_id))]
  const { data: boosterNames } = useBoosterNames(boosterIds)

  // Username do cliente quando requested_by_role === 'customer' e do admin
  // quando requested_by_role === 'admin' -- batch em vez de N+1 queries por
  // card, mesmo padrão de useBoosterNames acima.
  // Para drops de admin, admin_id é quem executou o drop (auth.uid() na
  // chamada de admin_drop_order) -- não o resolver (que só existe pra drops
  // originados por booster/cliente que passam pela fila).
  const profileIds = [...new Set(
    (requests ?? []).flatMap((r) => {
      if (r.requested_by_role === 'customer') return r.order?.customer_id ? [r.order.customer_id] : []
      if (r.requested_by_role === 'admin')    return r.admin_id ? [r.admin_id] : []
      return []
    })
  )]
  const { data: profileUsernames } = useProfileUsernames(profileIds)

  const resolveMutation = useResolveDropRequest()
  const resolve = {
    isPending: resolveMutation.isPending,
    mutate: (params: { id: string; approve: boolean; note: string; coachingCompletionPct?: number }) =>
      resolveMutation.mutate(
        {
          requestId: params.id, approve: params.approve, adminNote: params.note || undefined,
          coachingCompletionPct: params.coachingCompletionPct,
        },
        { onSuccess: () => { setResolving(null); setAdminNote(''); setCompletionPct('') } },
      ),
  }

  // Busca por código do pedido ou nome do booster -- mesmo campo de busca
  // usado nas demais listas (Pedidos, Meus Pedidos, Jobs disponíveis), já que
  // esta era a única lista de instâncias do admin sem nenhum jeito de filtrar
  // por texto.
  const matchesSearch = (r: { order_id: string; booster_id: string }) => {
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return r.order_id.toLowerCase().includes(q) || (boosterNames?.get(r.booster_id)?.display_name.toLowerCase().includes(q) ?? false)
  }
  const pendingRequests = (requests?.filter(r => r.status === 'pending') ?? []).filter(matchesSearch)
  const pastRequests = (requests?.filter(r => r.status !== 'pending') ?? []).filter(matchesSearch)
  const pendingPage = usePagedList(pendingRequests, 20, search)
  const pastPage = usePagedList(pastRequests, 20, search)

  const ROLE_LABEL: Record<string, string> = { booster: 'Booster', admin: 'Admin', customer: 'Cliente' }

  return (
    <div className="space-y-6">
      <PageHeader title="Solicitações de Drop" />
      {(requests?.length ?? 0) >= 100 && (
        <p className="text-xs text-warning">Mostrando as 100 solicitações mais recentes — pode haver mais.</p>
      )}

      <SearchInput
        wrapperClassName="w-full sm:w-64 shrink-0"
        placeholder="Buscar por pedido ou booster…"
        aria-label="Buscar por pedido ou booster"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {/* Pending */}
      <section>
        <h3 className="text-base font-semibold text-ink mb-3">Pendentes</h3>
        <QueryErrorNotice isError={isError} error={error} onRetry={refetch} />
        {isLoading ? (
          <CardGrid cols={4}>
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-52 w-full rounded-2xl" />)}
          </CardGrid>
        ) : !pendingRequests.length ? (
          <Card variant="operational" padding="none">
            <EmptyState icon={AlertTriangle} title="Nenhuma solicitação pendente" />
          </Card>
        ) : (
          <>
          <CardGrid cols={4}>
            {pendingPage.pageItems.map((r) => {
              return (
              <Card key={r.id} padding="md" className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/admin/orders/${r.order_id}`} className="font-mono text-xs font-bold text-brand hover:underline">
                    #{r.order_id.slice(0, 8).toUpperCase()}
                  </Link>
                  <span className="badge text-2xs font-bold bg-bg-raised text-ink-secondary shrink-0">
                    {ROLE_LABEL[r.requested_by_role] ?? r.requested_by_role}
                  </span>
                </div>

                {(r.order?.drop_count ?? 0) >= 2 && (
                  <span
                    title="Este pedido já foi dropado 2 vezes -- aprovar essa solicitação vai CANCELAR o pedido em vez de devolvê-lo pro painel."
                    className="badge text-2xs font-bold bg-danger/10 text-danger w-fit"
                  >
                    Cancela o pedido
                  </span>
                )}

                <p className="text-xs text-ink-secondary line-clamp-2">{r.reason}</p>

                {/* Quem solicitou o drop */}
                <div className="text-xs">
                  {(() => {
                    if (r.requested_by_role === 'booster') {
                      const b = boosterNames?.get(r.booster_id)
                      return b ? (
                        <Link to={`/admin/boosters/${b.id}`} className="text-brand hover:underline font-medium">
                          {b.display_name}
                        </Link>
                      ) : (
                        <span className="font-mono text-ink-muted">{r.booster_id.slice(0, 8)}…</span>
                      )
                    }
                    if (r.requested_by_role === 'customer') {
                      const cid = r.order?.customer_id
                      const username = cid ? profileUsernames?.get(cid) : null
                      return username ? (
                        <Link to={`/admin/customers/${cid}`} className="text-brand hover:underline font-medium">
                          {username}
                        </Link>
                      ) : (
                        <span className="font-mono text-ink-muted">{cid ? `${cid.slice(0, 8)}…` : 'Cliente'}</span>
                      )
                    }
                    if (r.requested_by_role === 'admin') {
                      const username = r.admin_id ? profileUsernames?.get(r.admin_id) : null
                      return username ? (
                        <span className="font-medium text-ink">{username}</span>
                      ) : (
                        <span className="font-mono text-ink-muted">{r.admin_id ? `${r.admin_id.slice(0, 8)}…` : 'Admin'}</span>
                      )
                    }
                    return null
                  })()}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-bg-raised/40 p-2">
                    <p className="text-sm font-bold" data-tabular>
                      <span className="text-success">{r.wins_at_request}W</span>{' / '}
                      <span className="text-danger">{r.losses_at_request}L</span>
                    </p>
                    <p className="text-2xs text-ink-muted mt-1 leading-tight uppercase tracking-wide">Vitórias / Derrotas</p>
                  </div>
                  <div className="rounded-xl bg-bg-raised/40 p-2">
                    {r.status === 'pending' ? (
                      <p className="text-2xs text-ink-muted">Calculado na aprovação</p>
                    ) : (
                      <>
                        <p className={`text-sm font-bold ${r.penalty_amount > 0 ? 'text-success' : r.penalty_amount < 0 ? 'text-danger' : 'text-ink-muted'}`} data-tabular>
                          {currency(r.penalty_amount)}
                        </p>
                        <p className="text-2xs text-ink-muted mt-1 leading-tight uppercase tracking-wide">
                          {r.penalty_amount > 0 ? 'Recebe' : r.penalty_amount < 0 ? 'Deve' : 'Neutro'}
                        </p>
                      </>
                    )}
                  </div>
                </div>

                <p className="text-xs text-ink-muted">{timeAgo(r.created_at)}</p>

                <div className="flex gap-1.5 mt-auto pt-1">
                  <Button
                    size="xs"
                    variant="success"
                    className="flex-1"
                    leftIcon={<CheckCircle2 className="h-3 w-3" />}
                    onClick={() => setResolving({ id: r.id, approve: true })}
                  >
                    Aprovar
                  </Button>
                  <Button
                    size="xs"
                    variant="danger"
                    className="flex-1"
                    leftIcon={<XCircle className="h-3 w-3" />}
                    onClick={() => setResolving({ id: r.id, approve: false })}
                  >
                    Rejeitar
                  </Button>
                </div>
              </Card>
              )
            })}
          </CardGrid>
          <Pagination page={pendingPage.page} hasNextPage={pendingPage.hasNextPage} onPrev={pendingPage.onPrev} onNext={pendingPage.onNext} />
          </>
        )}
      </section>

      {/* History */}
      {pastRequests.length > 0 && (
        <section>
          <h3 className="text-base font-semibold text-ink mb-3">Histórico</h3>
          <CardGrid cols={4}>
            {pastPage.pageItems.map((r) => {
              return (
              <Link key={r.id} to={`/admin/orders/${r.order_id}`}>
                <Card variant="interactive" padding="md" className="h-full flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-brand">#{r.order_id.slice(0, 8).toUpperCase()}</span>
                    <span className={`badge text-xs font-bold ${r.status === 'approved' ? 'text-success bg-success/10' : 'text-danger bg-danger/10'}`}>
                      {r.status === 'approved' ? 'Aprovado' : 'Rejeitado'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="badge text-2xs font-bold bg-bg-raised text-ink-secondary">
                      {ROLE_LABEL[r.requested_by_role] ?? r.requested_by_role}
                    </span>
                    {(() => {
                      if (r.requested_by_role === 'booster') {
                        const b = boosterNames?.get(r.booster_id)
                        const name = b ? b.display_name : `${r.booster_id.slice(0, 8)}…`
                        return b ? (
                          <Link
                            to={`/admin/boosters/${b.id}`}
                            className="text-xs font-medium text-brand hover:underline truncate"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {name}
                          </Link>
                        ) : (
                          <span className="text-xs font-medium text-ink-muted truncate">{name}</span>
                        )
                      }
                      if (r.requested_by_role === 'customer') {
                        const cid = r.order?.customer_id
                        const username = cid ? profileUsernames?.get(cid) : null
                        return username ? (
                          <Link
                            to={`/admin/customers/${cid}`}
                            className="text-xs font-medium text-brand hover:underline truncate"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {username}
                          </Link>
                        ) : (
                          <span className="text-xs font-medium text-ink-muted truncate">
                            {cid ? `${cid.slice(0, 8)}…` : 'Cliente'}
                          </span>
                        )
                      }
                      if (r.requested_by_role === 'admin') {
                        const username = r.admin_id ? profileUsernames?.get(r.admin_id) : null
                        return (
                          <span className="text-xs font-medium text-ink truncate">
                            {username ? `${username}` : (r.admin_id ? `${r.admin_id.slice(0, 8)}…` : 'Admin')}
                          </span>
                        )
                      }
                      return null
                    })()}
                    <span className={`text-xs font-semibold ml-auto ${r.penalty_amount > 0 ? 'text-success' : r.penalty_amount < 0 ? 'text-danger' : 'text-ink-muted'}`} data-tabular>
                      {currency(r.penalty_amount)}
                    </span>
                  </div>
                  <p className="text-xs text-ink-secondary line-clamp-2">{r.admin_note ?? '—'}</p>
                  <p className="text-xs text-ink-muted mt-auto pt-1">{r.resolved_at ? timeAgo(r.resolved_at) : '—'}</p>
                </Card>
              </Link>
              )
            })}
          </CardGrid>
          <Pagination page={pastPage.page} hasNextPage={pastPage.hasNextPage} onPrev={pastPage.onPrev} onNext={pastPage.onNext} />
        </section>
      )}

      {/* Resolve modal */}
      <Modal
        open={!!resolving}
        onOpenChange={(open) => { if (!open) { setResolving(null); setAdminNote(''); setCompletionPct('') } }}
        title={resolving?.approve ? 'Aprovar solicitação de drop' : 'Rejeitar solicitação de drop'}
      >
        <div>
          <label htmlFor="drop-resolve-admin-note" className="text-xs font-semibold text-ink-secondary block mb-1.5">
            Nota para o booster (opcional)
          </label>
          <textarea
            id="drop-resolve-admin-note"
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
            placeholder="Justificativa ou observação…"
            className="input-base w-full min-h-[80px] resize-none text-sm"
          />
        </div>
        {(() => {
          const resolvingRequest = pendingRequests.find(r => r.id === resolving?.id)
          const isCoaching = resolvingRequest?.order?.service_type === 'coaching'
          const willCancel = resolving?.approve && (resolvingRequest?.order?.drop_count ?? 0) >= 2
          const note = !resolving?.approve
            ? 'O pedido volta ao status anterior.'
            : willCancel
              ? 'Este pedido já foi dropado 2 vezes -- aprovar aqui CANCELA o pedido em vez de devolvê-lo pro painel. Trate o pagamento do booster e o cliente manualmente depois.'
              : 'O pedido volta pro painel. Pagamento proporcional ao progresso já concluído.'
          return (
            <>
              {resolving?.approve && isCoaching && (
                <div>
                  <label htmlFor="drop-resolve-coaching-pct" className="text-xs font-semibold text-ink-secondary block mb-1.5">
                    % do pacote já entregue pelo coach
                  </label>
                  <input
                    id="drop-resolve-coaching-pct"
                    type="number"
                    min={0}
                    max={100}
                    value={completionPct}
                    onChange={(e) => setCompletionPct(e.target.value)}
                    className="input-base w-full text-sm"
                  />
                  <p className="text-xs text-ink-muted mt-1">
                    Coaching não tem como medir progresso automaticamente -- informe quanto do pacote já foi dado antes do drop. Digite 0 se nada foi entregue ainda (o campo não pode ficar vazio).
                  </p>
                </div>
              )}
              <p className={`text-xs ${willCancel ? 'text-danger' : 'text-ink-secondary'}`}>{note}</p>
            </>
          )
        })()}
        <ActionBar>
          <Button disabled={resolve.isPending} variant="secondary" onClick={() => { setResolving(null); setAdminNote(''); setCompletionPct('') }}>
            Cancelar
          </Button>
          <Button
            variant={resolving?.approve ? 'success' : 'danger'}
            loading={resolve.isPending}
            disabled={!!resolving?.approve && pendingRequests.find((r) => r.id === resolving.id)?.order?.service_type === 'coaching' && parseCompletionPct(completionPct) === null}
            onClick={() => {
              if (!resolving) return
              const isCoaching = pendingRequests.find(r => r.id === resolving.id)?.order?.service_type === 'coaching'
              resolve.mutate({
                id: resolving.id, approve: resolving.approve, note: adminNote,
                coachingCompletionPct: resolving.approve && isCoaching ? parseCompletionPct(completionPct) ?? undefined : undefined,
              })
            }}
          >
            Confirmar
          </Button>
        </ActionBar>
      </Modal>
    </div>
  )
}
