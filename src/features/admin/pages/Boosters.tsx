import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Ban, CheckCircle2, ChevronDown, RotateCcw, Shield, StickyNote, Trophy, Star, UserX, XCircle } from 'lucide-react'
import { Button, Card, BoosterStatusBadge, EmptyState, FilterTabs, Pagination, SearchInput, Skeleton, ErrorAlert, Popover, Modal } from '@/components/ui'
import { cn, formatDate, formatDateTime, timeAgo } from '@/lib/utils'
import type { BoosterAdminNote, BoosterProfile } from '@/types'
import { useAdminBoosters, useAdminApproveBooster, useBoosterAdminNotes, useSetBoosterAdminNote, useExpelBooster } from '@/api/boosters'
import { usePagedList } from '@/hooks/usePagedList'

function BoosterActionsMenu({
  booster, note, statusPending, onApprove, onReject, onSuspend, onReinstate, onExpel, expelPending,
}: {
  booster: BoosterProfile
  note?: BoosterAdminNote
  statusPending: boolean
  onApprove: () => void
  onReject: () => void
  onSuspend: () => void
  onReinstate: () => void
  onExpel: (reason: string) => void
  expelPending: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [draft, setDraft] = useState(note?.note ?? '')
  const [expelOpen, setExpelOpen] = useState(false)
  const [suspendConfirmOpen, setSuspendConfirmOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const setNote = useSetBoosterAdminNote()
  const hasNote = !!note?.note?.trim()

  const { register: registerExpel, handleSubmit: handleExpelSubmit, reset: resetExpel, formState: { isValid: expelValid } } = useForm<{ reason: string }>({
    resolver: zodResolver(z.object({ reason: z.string().trim().min(10, 'Motivo deve ter pelo menos 10 caracteres.') })),
    defaultValues: { reason: '' },
    mode: 'onChange',
  })
  function closeExpel() {
    setExpelOpen(false)
    resetExpel({ reason: '' })
  }
  function submitExpel(data: { reason: string }) {
    onExpel(data.reason.trim())
    closeExpel()
  }

  const isNew = booster.status === 'pending' || booster.status === 'under_review'
  const isActive = booster.status === 'approved'
  const isSuspended = booster.status === 'suspended'

  const itemClass = 'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-sm font-medium transition-colors disabled:opacity-50'

  return (
    <>
      <Button
        ref={triggerRef}
        size="xs"
        variant="secondary"
        onClick={() => setMenuOpen((v) => !v)}
        rightIcon={<ChevronDown className={cn('h-3 w-3 transition-transform', menuOpen && 'rotate-180')} />}
      >
        Ações
      </Button>

      <Popover open={menuOpen} onClose={() => setMenuOpen(false)} anchorRef={triggerRef} className="w-60 p-2 space-y-1">
        <button
          type="button"
          onClick={() => { setDraft(note?.note ?? ''); setNotesOpen(true); setMenuOpen(false) }}
          className={cn(itemClass, 'text-ink-secondary hover:bg-bg-raised')}
        >
          <StickyNote className="h-4 w-4 shrink-0" />
          Notas
          {hasNote && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand shrink-0" />}
        </button>

        {isNew && (
          <>
            <button
              type="button"
              disabled={statusPending}
              onClick={() => { onApprove(); setMenuOpen(false) }}
              className={cn(itemClass, 'text-success hover:bg-success/10')}
            >
              <CheckCircle2 className="h-4 w-4 shrink-0" /> Aprovar
            </button>
            <button
              type="button"
              disabled={statusPending}
              onClick={() => { onReject(); setMenuOpen(false) }}
              className={cn(itemClass, 'text-danger hover:bg-danger/10')}
            >
              <XCircle className="h-4 w-4 shrink-0" /> Recusar
            </button>
          </>
        )}

        {isActive && (
          <button
            type="button"
            disabled={statusPending}
            onClick={() => { setSuspendConfirmOpen(true); setMenuOpen(false) }}
            className={cn(itemClass, 'text-danger hover:bg-danger/10')}
          >
            <Ban className="h-4 w-4 shrink-0" /> Suspender
          </button>
        )}

        {isSuspended && (
          <>
            <button
              type="button"
              disabled={statusPending}
              onClick={() => { onReinstate(); setMenuOpen(false) }}
              className={cn(itemClass, 'text-ink-secondary hover:bg-bg-raised')}
            >
              <RotateCcw className="h-4 w-4 shrink-0" /> Reativar
            </button>
            <button
              type="button"
              disabled={statusPending}
              onClick={() => { setExpelOpen(true); setMenuOpen(false) }}
              className={cn(itemClass, 'text-danger hover:bg-danger/10')}
            >
              <UserX className="h-4 w-4 shrink-0" /> Expulsar
            </button>
          </>
        )}
      </Popover>

      <Popover open={notesOpen} onClose={() => setNotesOpen(false)} anchorRef={triggerRef} className="w-[26rem] p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">Notas -- visível só para admins</p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Escreva o que quiser sobre este booster..."
          className="input-base w-full min-h-[260px] resize-none text-sm"
          maxLength={2000}
          autoFocus
        />
        {note?.updated_at && (
          <p className="text-xs text-ink-muted">Atualizado {timeAgo(note.updated_at)}</p>
        )}
        {setNote.isError && (
          <ErrorAlert message={setNote.error instanceof Error ? setNote.error.message : 'Erro ao salvar'} />
        )}
        <div className="flex gap-3 justify-end pt-1">
          <Button variant="ghost" onClick={() => setNotesOpen(false)}>Fechar</Button>
          <Button
            loading={setNote.isPending}
            onClick={() => setNote.mutate({ boosterId: booster.id, note: draft }, { onSuccess: () => setNotesOpen(false) })}
          >
            Salvar
          </Button>
        </div>
      </Popover>

      <Modal
        open={expelOpen}
        onOpenChange={(open) => { if (!open) closeExpel() }}
        title={`Expulsar ${booster.display_name}`}
      >
        <div>
          <label htmlFor="booster-expel-reason" className="text-xs font-semibold text-ink-secondary block mb-1.5">
            Motivo <span className="text-danger">*</span>
          </label>
          <textarea
            id="booster-expel-reason"
            {...registerExpel('reason')}
            placeholder="Descreva o motivo da expulsão..."
            className="input-base w-full min-h-[100px] resize-none text-sm"
            maxLength={500}
          />
        </div>
        <p className="text-xs text-danger">Ação permanente: o login é banido e não pode ser reativado.</p>
        <div className="flex gap-3 justify-end pt-2">
          <Button variant="ghost" onClick={closeExpel}>Cancelar</Button>
          <Button
            variant="danger"
            loading={expelPending}
            disabled={!expelValid}
            onClick={handleExpelSubmit(submitExpel)}
          >
            Expulsar Permanentemente
          </Button>
        </div>
      </Modal>

      <Modal
        open={suspendConfirmOpen}
        onOpenChange={setSuspendConfirmOpen}
        title={`Suspender ${booster.display_name}`}
        description="O booster fica suspenso por 24h e sai temporariamente dos jobs -- diferente de Expulsar, essa ação é reversível (Reativar)."
      >
        <div className="flex gap-3 justify-end pt-2">
          <Button variant="ghost" onClick={() => setSuspendConfirmOpen(false)}>Cancelar</Button>
          <Button
            variant="danger"
            loading={statusPending}
            onClick={() => { onSuspend(); setSuspendConfirmOpen(false) }}
          >
            Suspender
          </Button>
        </div>
      </Modal>
    </>
  )
}

export function AdminBoostersPage() {
  const [filter, setFilter] = useState<BoosterProfile['status'] | 'all'>('approved')
  const [search, setSearch] = useState('')
  const navigate = useNavigate()

  const filterLabels: Record<string, string> = {
    all: 'Todos',
    pending: 'Pendentes',
    approved: 'Aprovados',
    suspended: 'Suspensos',
  }

  const { data: boosters, isLoading } = useAdminBoosters(filter)
  // Independente do filtro ativo, pra alimentar o pontinho vermelho na aba
  // "Pendentes" -- o admin precisa ver que há candidatura nova mesmo
  // olhando outra aba. Mesma queryKey de useAdminBoosters('pending'),
  // então quando o filtro já é 'pending' os dois hooks dividem o cache
  // (sem fetch duplicado).
  const { data: pendingBoosters } = useAdminBoosters('pending')
  const pendingCount = pendingBoosters?.length ?? 0
  const { data: boosterNotes } = useBoosterAdminNotes()
  const updateBoosterStatusMutation = useAdminApproveBooster()
  const updateBoosterStatus = {
    mutate: (params: { id: string; status: 'approved' | 'rejected' | 'suspended' }) =>
      updateBoosterStatusMutation.mutate({ boosterId: params.id, newStatus: params.status }),
  }
  const expelBoosterMutation = useExpelBooster()

  const filtered = (boosters ?? []).filter((b) =>
    !search || b.display_name.toLowerCase().includes(search.trim().toLowerCase())
  )
  const { page, pageItems, hasNextPage, onPrev, onNext } = usePagedList(filtered, 20, `${filter}:${search}`)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">Boosters</h1>

      {/* Toolbar -- busca à esquerda, filtro de status à direita: mesmo
          layout/estilização das listas de pedido (busca + FilterTabs). */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SearchInput
          wrapperClassName="w-full sm:w-64 shrink-0"
          placeholder="Buscar por nome do booster..."
          aria-label="Buscar por nome do booster"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <FilterTabs
          value={filter}
          onChange={setFilter}
          options={(['approved', 'pending', 'suspended', 'all'] as const).map((s) => ({
            value: s,
            label: filterLabels[s] ?? s,
            dot: s === 'pending' && pendingCount > 0,
          }))}
        />
      </div>

      {(boosters?.length ?? 0) >= 100 && (
        <p className="text-xs text-warning">Mostrando os 100 boosters mais recentes deste filtro — pode haver mais.</p>
      )}

      {updateBoosterStatusMutation.isError && (
        <ErrorAlert message={(updateBoosterStatusMutation.error as Error).message} />
      )}

      {expelBoosterMutation.isError && (
        <ErrorAlert message={(expelBoosterMutation.error as Error).message} />
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-2xl" />)}
        </div>
      ) : !filtered.length ? (
        <div className="card p-0 backdrop-blur-none shadow-none bg-bg-surface">
          <EmptyState icon={Shield} title="Nenhum booster encontrado" />
        </div>
      ) : (
        <>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {pageItems.map((b) => (
            <Card
              key={b.id}
              variant="interactive"
              padding="md"
              className="flex flex-col gap-3"
              onClick={() => navigate(`/admin/boosters/${b.id}`)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-brand font-semibold text-sm truncate">{b.display_name}</span>
                    {b.is_top3 && (
                      <span className="flex items-center gap-1 text-[10px] font-bold bg-warning/10 text-warning border border-warning/20 rounded-lg px-1.5 py-0.5 uppercase tracking-wide shrink-0">
                        <Trophy className="h-2.5 w-2.5" /> TOP3
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-ink-muted mt-0.5">Entrou {formatDate(b.created_at)}</p>
                </div>
                <BoosterStatusBadge status={b.status} />
              </div>

              {b.status === 'suspended' && b.suspended_until && (
                <p className="text-[11px] text-ink-muted -mt-2">Suspenso até {formatDateTime(b.suspended_until)}</p>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-bg-raised/40 p-2">
                  <div className="flex items-center gap-1.5">
                    <Star className="h-3.5 w-3.5 text-warning fill-warning shrink-0" />
                    <p className="text-sm font-bold text-ink">{b.rating.toFixed(1)}</p>
                  </div>
                  <p className="text-[9px] text-ink-muted mt-1 leading-tight uppercase tracking-wide">Avaliação</p>
                </div>
                <div className="rounded-xl bg-bg-raised/40 p-2">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                    <p className="text-sm font-bold text-ink">{b.total_completed}</p>
                  </div>
                  <p className="text-[9px] text-ink-muted mt-1 leading-tight uppercase tracking-wide">Concluídos</p>
                </div>
              </div>

              <div className="mt-auto pt-1" onClick={(e) => e.stopPropagation()}>
                <BoosterActionsMenu
                  booster={b}
                  note={boosterNotes?.get(b.id)}
                  statusPending={updateBoosterStatusMutation.isPending && updateBoosterStatusMutation.variables?.boosterId === b.id}
                  onApprove={() => updateBoosterStatus.mutate({ id: b.id, status: 'approved' })}
                  onReject={() => updateBoosterStatus.mutate({ id: b.id, status: 'rejected' })}
                  onSuspend={() => updateBoosterStatus.mutate({ id: b.id, status: 'suspended' })}
                  onReinstate={() => updateBoosterStatus.mutate({ id: b.id, status: 'approved' })}
                  onExpel={(reason) => expelBoosterMutation.mutate({ boosterId: b.id, reason })}
                  expelPending={expelBoosterMutation.isPending && expelBoosterMutation.variables?.boosterId === b.id}
                />
              </div>
            </Card>
          ))}
        </div>
        <Pagination page={page} hasNextPage={hasNextPage} onPrev={onPrev} onNext={onNext} />
        </>
      )}
    </div>
  )
}
