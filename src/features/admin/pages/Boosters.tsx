import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Ban, CheckCircle2, ChevronDown, RotateCcw, Shield, StickyNote, Trophy, Star, UserX, XCircle } from 'lucide-react'
import { Button, BoosterStatusBadge, EmptyState, Skeleton, ErrorAlert, Popover, Modal } from '@/components/ui'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { cn, formatDate, formatDateTime, timeAgo } from '@/lib/utils'
import type { BoosterAdminNote, BoosterProfile } from '@/types'
import { useTranslation } from 'react-i18next'
import { useAdminBoosters, useAdminApproveBooster, useBoosterAdminNotes, useSetBoosterAdminNote, useExpelBooster } from '@/api/boosters'

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
  const [expelReason, setExpelReason] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const setNote = useSetBoosterAdminNote()
  const hasNote = !!note?.note?.trim()

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
          className={cn(itemClass, 'text-ink-secondary hover:bg-bg-elevated')}
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
            onClick={() => { onSuspend(); setMenuOpen(false) }}
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
              className={cn(itemClass, 'text-ink-secondary hover:bg-bg-elevated')}
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
        onOpenChange={(open) => { if (!open) { setExpelOpen(false); setExpelReason('') } }}
        title={`Expulsar ${booster.display_name}`}
        description="Ação permanente: o login é banido e não pode ser reativado."
      >
        <div>
          <label className="text-xs font-semibold text-ink-secondary block mb-1.5">
            Motivo <span className="text-danger">*</span>
          </label>
          <textarea
            value={expelReason}
            onChange={(e) => setExpelReason(e.target.value)}
            placeholder="Descreva o motivo da expulsão..."
            className="input-base w-full min-h-[100px] resize-none text-sm"
            maxLength={500}
          />
        </div>
        <div className="flex gap-3 justify-end pt-2">
          <Button variant="ghost" onClick={() => { setExpelOpen(false); setExpelReason('') }}>Cancelar</Button>
          <Button
            variant="danger"
            loading={expelPending}
            disabled={expelReason.trim().length < 10}
            onClick={() => { onExpel(expelReason.trim()); setExpelOpen(false); setExpelReason('') }}
          >
            Expulsar Permanentemente
          </Button>
        </div>
      </Modal>
    </>
  )
}

export function AdminBoostersPage() {
  const [filter, setFilter] = useState<BoosterProfile['status'] | 'all'>('all')
  const { t } = useTranslation()

  const filterLabels: Record<string, string> = {
    all: t('admin.boosters.filters.all'),
    pending: t('admin.boosters.filters.pending'),
    approved: t('admin.boosters.filters.approved'),
    suspended: t('admin.boosters.filters.suspended'),
  }

  const { data: boosters, isLoading } = useAdminBoosters(filter)
  const { data: boosterNotes } = useBoosterAdminNotes()
  const updateBoosterStatusMutation = useAdminApproveBooster()
  const updateBoosterStatus = {
    mutate: (params: { id: string; status: 'approved' | 'rejected' | 'suspended' }) =>
      updateBoosterStatusMutation.mutate({ boosterId: params.id, newStatus: params.status }),
  }
  const expelBoosterMutation = useExpelBooster()

  const filtered = boosters ?? []

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">{t('admin.boosters.title')}</h1>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex gap-1 bg-bg-surface/80 backdrop-blur-sm border border-border-subtle rounded-xl p-1 w-fit">
          {(['all', 'pending', 'approved', 'suspended'] as const).map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${filter === s ? 'bg-brand text-white' : 'text-ink-secondary hover:text-ink'}`}>
              {filterLabels[s] ?? s}
            </button>
          ))}
        </div>
      </div>

      {filtered.length >= 100 && (
        <p className="text-xs text-warning">Mostrando os 100 boosters mais recentes deste filtro — pode haver mais.</p>
      )}

      {updateBoosterStatusMutation.isError && (
        <ErrorAlert message={(updateBoosterStatusMutation.error as Error).message} />
      )}

      {expelBoosterMutation.isError && (
        <ErrorAlert message={(expelBoosterMutation.error as Error).message} />
      )}

      <div className="card p-0">
        {isLoading ? <div className="p-4"><Skeleton className="h-48 w-full" /></div> :
          !filtered.length ? <EmptyState icon={Shield} title={t('admin.boosters.empty')} /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.boosters.table.name')}</TableHead>
                <TableHead>{t('admin.boosters.table.rating')}</TableHead>
                <TableHead>{t('admin.boosters.table.completed')}</TableHead>
                <TableHead>{t('admin.boosters.table.status')}</TableHead>
                <TableHead>{t('admin.boosters.table.joined')}</TableHead>
                <TableHead>{t('admin.boosters.table.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Link to={`/admin/boosters/${b.id}`} className="text-brand hover:underline font-medium text-sm">
                        {b.display_name}
                      </Link>
                      {b.is_top3 && (
                        <span className="flex items-center gap-1 text-[10px] font-bold bg-warning/10 text-warning border border-warning/20 rounded-lg px-2 py-0.5 uppercase tracking-wide">
                          <Trophy className="h-2.5 w-2.5" /> TOP3
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1">
                      {b.rating.toFixed(1)}
                      <Star className="h-3 w-3 text-warning fill-warning" />
                    </span>
                  </TableCell>
                  <TableCell>{b.total_completed}</TableCell>
                  <TableCell>
                    <BoosterStatusBadge status={b.status} />
                    {b.status === 'suspended' && b.suspended_until && (
                      <p className="text-[11px] text-ink-muted mt-1">
                        Até {formatDateTime(b.suspended_until)}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>{formatDate(b.created_at)}</TableCell>
                  <TableCell>
                    <BoosterActionsMenu
                      booster={b}
                      note={boosterNotes?.get(b.id)}
                      statusPending={updateBoosterStatusMutation.isPending}
                      onApprove={() => updateBoosterStatus.mutate({ id: b.id, status: 'approved' })}
                      onReject={() => updateBoosterStatus.mutate({ id: b.id, status: 'rejected' })}
                      onSuspend={() => updateBoosterStatus.mutate({ id: b.id, status: 'suspended' })}
                      onReinstate={() => updateBoosterStatus.mutate({ id: b.id, status: 'approved' })}
                      onExpel={(reason) => expelBoosterMutation.mutate({ boosterId: b.id, reason })}
                      expelPending={expelBoosterMutation.isPending}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
