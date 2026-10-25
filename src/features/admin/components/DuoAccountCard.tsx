import { Copy, Eye, EyeOff, History, Trash2 } from 'lucide-react'
import { Button, Card, RankBadge } from '@/components/ui'
import { copyToClipboard } from '@/lib/clipboard'
import { RANK_TIER_LABEL, formatDate } from '@/lib/utils'
import type { AdminDuoAccount } from '@/api/duoAccounts'
import type { RevealState } from './useDuoCredentialReveal'

export interface DuoAccountCardProps {
  account: AdminDuoAccount
  reveal: RevealState | undefined
  isTogglingActive: boolean
  isReleasing: boolean
  onToggleActive: (a: AdminDuoAccount) => void
  onToggleReveal: (a: AdminDuoAccount) => void
  onEdit: (a: AdminDuoAccount) => void
  onDelete: (a: AdminDuoAccount) => void
  onRelease: (a: AdminDuoAccount) => void
  onHistory: (a: AdminDuoAccount) => void
}

function CopyRow({ value, title, label, muted }: { value: string; title: string; label: string; muted?: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <p className={muted ? 'text-ink-muted truncate' : 'truncate'}>{value}</p>
      <button type="button" title={title} onClick={() => void copyToClipboard(value, label)} className="shrink-0 text-ink-muted hover:text-ink">
        <Copy className="h-3 w-3" />
      </button>
    </div>
  )
}

function Credentials({ reveal }: { reveal: RevealState | undefined }) {
  return (
    <div className="rounded-xl bg-bg-raised/40 p-2">
      <p className="text-2xs text-ink-muted uppercase tracking-wide mb-1">Credenciais</p>
      {reveal && reveal !== 'loading' && reveal !== 'error' ? (
        <div className="text-xs font-mono text-ink space-y-0.5">
          <CopyRow value={reveal.login} title="Copiar login" label="Login" />
          <CopyRow value={reveal.password} title="Copiar senha" label="Senha" muted />
        </div>
      ) : reveal === 'error' ? (
        <span className="text-xs text-danger">Falha ao revelar</span>
      ) : (
        <span className="text-xs text-ink-muted">••••••••</span>
      )}
    </div>
  )
}

function ReservationStatus({ account: a, isReleasing, onHistory, onRelease }: Pick<DuoAccountCardProps, 'account' | 'isReleasing' | 'onHistory' | 'onRelease'>) {
  if (!a.reserved_by) {
    return (
      <button
        type="button"
        onClick={() => onHistory(a)}
        className="badge text-2xs text-ink-muted bg-bg-raised hover:bg-bg-interactive transition-colors cursor-pointer inline-flex items-center gap-1 w-fit"
        title="Ver histórico de reservas"
      >
        <History className="h-3 w-3" /> Livre
      </button>
    )
  }
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onHistory(a)}
        className="badge text-2xs text-warning bg-warning/10 hover:bg-warning/20 transition-colors cursor-pointer"
        title={a.reserved_by_name ? `Reservada por ${a.reserved_by_name} — ver histórico` : 'Ver histórico de reservas'}
      >
        Reservada
      </button>
      <Button size="xs" variant="ghost" loading={isReleasing} onClick={() => onRelease(a)}>
        Liberar
      </Button>
    </div>
  )
}

export function DuoAccountCard(props: DuoAccountCardProps) {
  const { account: a, reveal, isTogglingActive, onToggleActive, onToggleReveal, onEdit, onDelete } = props
  const isRevealed = !!reveal && reveal !== 'loading' && reveal !== 'error'

  return (
    <Card padding="md" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-ink text-sm truncate">{a.riot_id ?? a.label}</p>
          {a.current_rank ? (
            <div className="flex items-center gap-1.5 mt-1">
              <RankBadge tier={a.current_rank.tier} division={a.current_rank.division} size="xs" showLabel={false} />
              <span className="text-xs text-ink-secondary">
                {RANK_TIER_LABEL[a.current_rank.tier]}{a.current_rank.division ? ` ${a.current_rank.division}` : ''}
              </span>
            </div>
          ) : <span className="text-2xs text-ink-muted">Sem rank</span>}
        </div>
        <button
          onClick={() => onToggleActive(a)}
          disabled={isTogglingActive}
          className={`badge text-2xs shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${a.is_active ? 'text-success bg-success/10' : 'text-ink-muted bg-bg-raised'}`}
        >
          {a.is_active ? 'Ativa' : 'Inativa'}
        </button>
      </div>

      <Credentials reveal={reveal} />
      <ReservationStatus account={a} isReleasing={props.isReleasing} onHistory={props.onHistory} onRelease={props.onRelease} />

      <p className="text-xs text-ink-muted">Criada em {formatDate(a.created_at)}</p>

      <div className="flex items-center gap-1 mt-auto pt-1 border-t border-border-subtle">
        <Button size="xs" variant="ghost" onClick={() => onToggleReveal(a)} loading={reveal === 'loading'}>
          {isRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </Button>
        <Button size="xs" variant="ghost" className="flex-1" onClick={() => onEdit(a)}>
          Editar
        </Button>
        <Button
          size="xs"
          variant="ghost"
          className="text-danger hover:bg-danger/10"
          disabled={!!a.reserved_by}
          title={a.reserved_by ? 'Libere a reserva antes de excluir' : 'Excluir conta'}
          onClick={() => onDelete(a)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </Card>
  )
}
