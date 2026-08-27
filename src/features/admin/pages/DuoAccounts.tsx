import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Landmark, Plus, Eye, EyeOff, Search, CheckCircle2, Trash2, History } from 'lucide-react'
import { Button, EmptyState, Skeleton, Modal, RankBadge, ErrorAlert } from '@/components/ui'
import { FormField } from '@/components/ui/FormField'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { RANK_TIER_LABEL, formatDate, formatDateTime } from '@/lib/utils'
import {
  useAdminDuoAccounts, useDuoAccountAutoRefresh, useAdminSaveDuoAccount, useAdminSetDuoAccountActive,
  useAdminReleaseDuoAccount, useAdminDeleteDuoAccount, useDuoAccountReservationHistory,
  lookupDuoAccountRiotRank, adminGetDuoAccountCredentials,
} from '@/api/duoAccounts'
import type { AdminDuoAccount } from '@/api/duoAccounts'
import type { Division, RankTier } from '@/types'

function formatDurationSeconds(seconds: number): string {
  if (seconds < 60) return '<1min'
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d ${hours % 24}h`
  if (hours > 0) return `${hours}h ${minutes % 60}min`
  return `${minutes}min`
}

function DuoAccountHistoryModal({ account, onClose }: { account: AdminDuoAccount | null; onClose: () => void }) {
  const { data, isLoading, isError } = useDuoAccountReservationHistory(account?.id)

  return (
    <Modal
      open={!!account}
      onOpenChange={(open) => !open && onClose()}
      title={`Histórico de reservas — ${account?.riot_id ?? account?.label}`}
      maxWidth="2xl"
    >
      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : isError ? (
        <ErrorAlert message="Não foi possível carregar o histórico desta conta." />
      ) : data && account ? (
        <div className="space-y-4">
          {account.reserved_by && (
            <div className="rounded-xl border border-warning/25 bg-warning/5 px-4 py-3">
              <p className="text-[10px] font-bold text-warning uppercase tracking-wide mb-1">Reserva ativa agora</p>
              <p className="text-sm font-bold text-ink">{account.reserved_by_name ?? 'Booster'}</p>
              {account.reserved_at && (
                <p className="text-xs text-ink-muted mt-0.5">
                  desde {formatDateTime(account.reserved_at)} · {formatDurationSeconds(
                    Math.max(0, (Date.now() - new Date(account.reserved_at).getTime()) / 1000),
                  )}
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 rounded-xl bg-bg-elevated p-3 text-center" data-tabular>
            <div>
              <p className="text-sm font-bold text-ink">{data.stats.total_reservations}</p>
              <p className="text-[10px] text-ink-muted mt-0.5">Reservas totais</p>
            </div>
            <div>
              <p className="text-sm font-bold text-ink">{data.stats.distinct_boosters}</p>
              <p className="text-[10px] text-ink-muted mt-0.5">Boosters distintos</p>
            </div>
            <div>
              <p className="text-sm font-bold text-ink">{formatDurationSeconds(data.stats.total_seconds)}</p>
              <p className="text-[10px] text-ink-muted mt-0.5">Tempo total reservada</p>
            </div>
          </div>

          {data.history.length === 0 ? (
            <p className="text-xs text-ink-muted py-4 text-center">Nenhuma reserva registrada ainda.</p>
          ) : (
            <div className="max-h-80 space-y-1.5 overflow-y-auto pr-0.5">
              {data.history.map((h) => (
                <div key={h.id} className="flex items-center justify-between gap-3 rounded-xl border border-border-subtle px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink truncate">{h.booster_name ?? 'Booster removido'}</p>
                    <p className="text-ink-muted mt-0.5 truncate">
                      {h.order_id ? `Pedido #${h.order_id.slice(0, 8).toUpperCase()}` : 'Sem pedido associado'}
                      {h.order_service_type && ` · ${h.order_service_type}`}
                    </p>
                  </div>
                  <div className="text-right shrink-0" data-tabular>
                    <p className="text-ink-secondary">{formatDateTime(h.reserved_at)}</p>
                    <p className="text-ink-muted mt-0.5">
                      {h.released_at
                        ? formatDurationSeconds((new Date(h.released_at).getTime() - new Date(h.reserved_at).getTime()) / 1000)
                        : 'Em andamento'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  )
}

const RIOT_ID_FORMAT = /^[^#]{1,16}#[^#]{2,5}$/

interface AccountForm {
  riot_id: string
  tier: RankTier
  division: Division
  leaguePoints: number | null
  avgGain: number | null
  avgLoss: number | null
  notes: string
  is_active: boolean
  login: string
  password: string
}

const EMPTY_FORM: AccountForm = {
  riot_id: '', tier: 'gold', division: 'IV', leaguePoints: null, avgGain: null, avgLoss: null,
  notes: '', is_active: true, login: '', password: '',
}

function accountToForm(a: AdminDuoAccount): AccountForm {
  return {
    riot_id: a.riot_id ?? '',
    tier: a.current_rank?.tier ?? 'gold',
    division: a.current_rank?.division ?? 'IV',
    leaguePoints: null,
    avgGain: null,
    avgLoss: null,
    notes: a.notes ?? '',
    is_active: a.is_active,
    login: '',
    password: '',
  }
}

export function AdminDuoAccountsPage() {
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; account?: AdminDuoAccount } | null>(null)
  const [form, setForm] = useState<AccountForm>(EMPTY_FORM)
  const [revealed, setRevealed] = useState<Record<string, { login: string; password: string } | 'loading' | 'error'>>({})
  const [riotVerified, setRiotVerified] = useState(false)
  const [riotLookupError, setRiotLookupError] = useState<string | null>(null)
  const [riotLookupMessage, setRiotLookupMessage] = useState<string | null>(null)

  const lookupRiot = useMutation({
    mutationFn: async () => {
      const trimmed = form.riot_id.trim()
      if (!RIOT_ID_FORMAT.test(trimmed)) throw new Error('Riot ID inválido. Use o formato Nome#TAG (ex.: Fulano#BR1).')
      return lookupDuoAccountRiotRank(trimmed)
    },
    onSuccess: (result) => {
      setRiotLookupError(null)
      if (!result.found || !result.ranked || !result.tier) {
        setRiotLookupMessage(null)
        setRiotLookupError(!result.found ? 'Conta Riot não encontrada.' : 'Conta sem rank nesta fila — contas Duo precisam de um rank definido.')
        return
      }
      setForm((f) => ({
        ...f,
        tier: result.tier!,
        division: result.division ?? 'IV',
        leaguePoints: result.league_points ?? null,
        avgGain: result.avg_lp_gain ?? null,
        avgLoss: result.avg_lp_loss ?? null,
      }))
      setRiotLookupMessage(result.message ?? 'Rank preenchido automaticamente a partir da Riot.')
      setRiotVerified(true)
    },
    onError: (err) => {
      setRiotVerified(false)
      setRiotLookupMessage(null)
      setRiotLookupError(err instanceof Error ? err.message : 'Não foi possível consultar a Riot agora.')
    },
  })

  const { data: accounts, isLoading, isError, error: accountsError } = useAdminDuoAccounts()

  useDuoAccountAutoRefresh(accounts)

  useEffect(() => {
    if (!modal) return
    setForm(modal.mode === 'edit' && modal.account ? accountToForm(modal.account) : EMPTY_FORM)
    // Contas já existentes já passaram pela verificação em algum momento —
    // só uma nova conta exige rodar o lookup antes de liberar as credenciais.
    setRiotVerified(modal.mode === 'edit')
    setRiotLookupError(null)
    setRiotLookupMessage(null)
  }, [modal])

  const saveMutation = useAdminSaveDuoAccount()
  const save = {
    isPending: saveMutation.isPending,
    isError: saveMutation.isError,
    error: saveMutation.error,
    mutate: () => {
      if (!form.riot_id.trim()) return
      if (modal?.mode === 'create' && !riotVerified) return
      if (modal?.mode === 'create' && (!form.login.trim() || !form.password.trim())) return
      saveMutation.mutate({
        accountId: modal?.mode === 'edit' ? modal.account?.id : undefined,
        riotId: form.riot_id.trim(),
        label: form.riot_id.trim(),
        tier: form.tier,
        division: form.division,
        notes: form.notes.trim() || undefined,
        isActive: form.is_active,
        login: form.login.trim() || undefined,
        password: form.password || undefined,
      }, { onSuccess: () => setModal(null) })
    },
  }

  const toggleActiveMutation = useAdminSetDuoAccountActive()
  const toggleActive = {
    isPending: toggleActiveMutation.isPending,
    mutate: (a: AdminDuoAccount) => toggleActiveMutation.mutate({ accountId: a.id, isActive: !a.is_active }),
  }

  const releaseReservationMutation = useAdminReleaseDuoAccount()
  const releaseReservation = {
    isPending: releaseReservationMutation.isPending,
    mutate: (accountId: string) => releaseReservationMutation.mutate(accountId),
  }

  const [historyTarget, setHistoryTarget] = useState<AdminDuoAccount | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminDuoAccount | null>(null)
  const deleteAccountMutation = useAdminDeleteDuoAccount()
  const deleteAccount = {
    isPending: deleteAccountMutation.isPending,
    isError: deleteAccountMutation.isError,
    error: deleteAccountMutation.error,
    mutate: (accountId: string) => deleteAccountMutation.mutate(accountId, { onSuccess: () => setDeleteTarget(null) }),
  }

  async function toggleReveal(a: AdminDuoAccount) {
    if (revealed[a.id] && revealed[a.id] !== 'error') {
      setRevealed((r) => { const next = { ...r }; delete next[a.id]; return next })
      return
    }
    setRevealed((r) => ({ ...r, [a.id]: 'loading' }))
    const res = await adminGetDuoAccountCredentials(a.id).catch(() => null)
    if (!res?.success || !res.login) {
      setRevealed((r) => ({ ...r, [a.id]: 'error' }))
      return
    }
    setRevealed((r) => ({ ...r, [a.id]: { login: res.login!, password: res.password! } }))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Contas Duo Boost</h1>
          <p className="text-sm text-ink-secondary mt-1">Pool de contas smurf da empresa disponibilizadas aos boosters.</p>
        </div>
        <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setModal({ mode: 'create' })}>
          Adicionar Conta
        </Button>
      </div>

      <div className="card p-0">
        {isLoading ? <div className="p-4"><Skeleton className="h-48 w-full" /></div> :
          isError ? <div className="p-4"><ErrorAlert message={accountsError instanceof Error ? accountsError.message : 'Não foi possível carregar as contas Duo.'} /></div> :
          !accounts?.length ? <EmptyState icon={Landmark} title="Nenhuma conta cadastrada" description="Adicione contas para que boosters possam usá-las em Duo Boost." /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Conta</TableHead>
                <TableHead>Rank</TableHead>
                <TableHead>Credenciais</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reserva</TableHead>
                <TableHead>Criada em</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => {
                const rev = revealed[a.id]
                return (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium text-ink">{a.riot_id ?? a.label}</TableCell>
                    <TableCell>
                      {a.current_rank ? (
                        <div className="flex items-center gap-2">
                          <RankBadge tier={a.current_rank.tier} division={a.current_rank.division} size="xs" showLabel={false} />
                          <span className="text-xs text-ink-secondary">
                            {RANK_TIER_LABEL[a.current_rank.tier]}{a.current_rank.division ? ` ${a.current_rank.division}` : ''}
                          </span>
                        </div>
                      ) : <span className="text-[10px] text-ink-muted">—</span>}
                    </TableCell>
                    <TableCell>
                      {rev && rev !== 'loading' && rev !== 'error' ? (
                        <div className="text-xs font-mono text-ink space-y-0.5">
                          <p>{rev.login}</p>
                          <p className="text-ink-muted">{rev.password}</p>
                        </div>
                      ) : rev === 'error' ? (
                        <span className="text-xs text-danger">Falha ao revelar</span>
                      ) : (
                        <span className="text-xs text-ink-muted">••••••••</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={() => toggleActive.mutate(a)}
                        disabled={toggleActive.isPending}
                        className={`badge text-xs disabled:opacity-50 disabled:cursor-not-allowed ${a.is_active ? 'text-success bg-success/10' : 'text-ink-muted bg-bg-elevated'}`}
                      >
                        {a.is_active ? 'Ativa' : 'Inativa'}
                      </button>
                    </TableCell>
                    <TableCell>
                      {a.reserved_by ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setHistoryTarget(a)}
                            className="badge text-xs text-warning bg-warning/10 hover:bg-warning/20 transition-colors cursor-pointer"
                            title={a.reserved_by_name ? `Reservada por ${a.reserved_by_name} — ver histórico` : 'Ver histórico de reservas'}
                          >
                            Reservada
                          </button>
                          <Button size="xs" variant="ghost" loading={releaseReservation.isPending} onClick={() => releaseReservation.mutate(a.id)}>
                            Liberar
                          </Button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setHistoryTarget(a)}
                          className="badge text-xs text-ink-muted bg-bg-elevated hover:bg-bg-interactive transition-colors cursor-pointer inline-flex items-center gap-1"
                          title="Ver histórico de reservas"
                        >
                          <History className="h-3 w-3" /> Livre
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-ink-muted">{formatDate(a.created_at)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button size="xs" variant="ghost" onClick={() => toggleReveal(a)} loading={rev === 'loading'}>
                          {rev && rev !== 'loading' && rev !== 'error' ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </Button>
                        <Button size="xs" variant="ghost" onClick={() => setModal({ mode: 'edit', account: a })}>
                          Editar
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          className="text-danger hover:bg-danger/10"
                          disabled={!!a.reserved_by}
                          title={a.reserved_by ? 'Libere a reserva antes de excluir' : 'Excluir conta'}
                          onClick={() => setDeleteTarget(a)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <Modal
        open={!!modal}
        onOpenChange={(open) => !open && setModal(null)}
        title={modal?.mode === 'edit' ? 'Editar Conta Duo' : 'Adicionar Conta Duo'}
        description="Login e senha são criptografados no banco e só podem ser revelados por admins e boosters aprovados."
        maxWidth="2xl"
      >
        <div className="space-y-6">
          <FormField
            label="Riot ID"
            required
            hint="Consulta rank, divisão e PDL/LP atuais na Riot — nenhum campo de rank é preenchido manualmente."
          >
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                value={form.riot_id}
                onChange={(e) => {
                  setForm((f) => ({ ...f, riot_id: e.target.value }))
                  setRiotVerified(false)
                  setRiotLookupMessage(null)
                  setRiotLookupError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); lookupRiot.mutate() }
                }}
                className="input-base flex-1 text-base py-3"
                placeholder="NomeDaConta#TAG"
                autoComplete="off"
                disabled={modal?.mode === 'edit'}
                maxLength={32}
              />
              <button
                type="button"
                onClick={() => lookupRiot.mutate()}
                disabled={lookupRiot.isPending || !form.riot_id.trim()}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-bold transition-all bg-brand text-white hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
              >
                <Search className="h-4 w-4" />
                {lookupRiot.isPending ? 'Consultando...' : 'Verificar'}
              </button>
            </div>
            {riotLookupError && <ErrorAlert message={riotLookupError} className="mt-2" />}
          </FormField>

          {riotVerified && (
            <div className="flex items-center gap-5 rounded-xl border border-brand/25 bg-brand/10 px-5 py-4">
              <RankBadge tier={form.tier} division={form.division} size="lg" showLabel={false} />
              <div className="min-w-0 flex-1">
                <p className="text-base font-bold text-ink">
                  {RANK_TIER_LABEL[form.tier]} {form.division}
                </p>
                <p className="text-xs text-ink-secondary flex items-center gap-1 mt-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                  {riotLookupMessage ?? 'Rank cadastrado — verifique novamente pra atualizar.'}
                </p>
              </div>
              {form.leaguePoints != null && (
                <div className="text-right shrink-0">
                  <p className="text-base font-bold text-ink">{form.leaguePoints} PDL</p>
                  {form.avgGain != null && (
                    <p className="text-xs text-ink-muted mt-1">
                      Média: +{form.avgGain}{form.avgLoss != null ? ` / −${form.avgLoss}` : ''}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {!riotVerified ? (
            <p className="text-sm text-ink-muted rounded-xl border border-border-subtle bg-bg-elevated/40 px-5 py-4">
              Verifique o Riot ID acima para liberar os campos de login e senha.
            </p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-5">
              <FormField label={`Login${modal?.mode === 'edit' ? ' (deixe em branco p/ manter)' : ''}`}>
                <input
                  value={form.login}
                  onChange={(e) => setForm((f) => ({ ...f, login: e.target.value }))}
                  className="input-base w-full py-3"
                  autoComplete="off"
                />
              </FormField>
              <FormField label={`Senha${modal?.mode === 'edit' ? ' (deixe em branco p/ manter)' : ''}`}>
                <input
                  type="text"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  className="input-base w-full py-3"
                  autoComplete="off"
                />
              </FormField>
            </div>
          )}

          <FormField label="Notas internas">
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={3}
              className="input-base w-full resize-none"
            />
          </FormField>

          <label className="flex items-center gap-2.5 text-sm text-ink-secondary rounded-xl border border-border-subtle bg-bg-elevated/40 px-5 py-3.5 w-fit">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              className="h-4 w-4"
            />
            Disponível para boosters
          </label>

          {save.isError && <ErrorAlert message={(save.error as Error).message} />}

          <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle -mx-6 px-6 -mb-6 pb-6 mt-2">
            <Button variant="ghost" onClick={() => setModal(null)}>Cancelar</Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>
          </div>
        </div>
      </Modal>

      <DuoAccountHistoryModal account={historyTarget} onClose={() => setHistoryTarget(null)} />

      <Modal
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Excluir conta Duo"
        description={`Tem certeza que quer excluir "${deleteTarget?.riot_id ?? deleteTarget?.label}"? Essa ação não pode ser desfeita.`}
      >
        <div className="space-y-3">
          {deleteAccount.isError && (
            <ErrorAlert message={deleteAccount.error instanceof Error ? deleteAccount.error.message : 'Erro ao excluir'} />
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
            <Button
              variant="danger"
              loading={deleteAccount.isPending}
              onClick={() => deleteTarget && deleteAccount.mutate(deleteTarget.id)}
            >
              Excluir
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
