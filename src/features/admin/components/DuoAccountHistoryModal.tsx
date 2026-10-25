import { InlineEmpty } from '@/components/ui/EmptyState'
import { ErrorAlert, Modal, Skeleton } from '@/components/ui'
import { formatDateTime } from '@/lib/utils'
import { useDuoAccountReservationHistory } from '@/api/duoAccounts'
import type { AdminDuoAccount } from '@/api/duoAccounts'
import { formatDurationSeconds } from './duoAccountUtils'

function ActiveReservation({ account }: { account: AdminDuoAccount }) {
  if (!account.reserved_by) return null
  return (
    <div className="rounded-xl border border-warning/25 bg-warning/5 px-4 py-3">
      <p className="text-2xs font-bold text-warning uppercase tracking-wide mb-1">Reserva ativa agora</p>
      <p className="text-sm font-bold text-ink">{account.reserved_by_name ?? 'Booster'}</p>
      {account.reserved_at && (
        <p className="text-xs text-ink-muted mt-0.5">
          desde {formatDateTime(account.reserved_at)} · {formatDurationSeconds(
            Math.max(0, (Date.now() - new Date(account.reserved_at).getTime()) / 1000),
          )}
        </p>
      )}
    </div>
  )
}

function StatCell({ value, label }: { value: string | number; label: string }) {
  return (
    <div>
      <p className="text-sm font-bold text-ink">{value}</p>
      <p className="text-2xs text-ink-muted mt-0.5">{label}</p>
    </div>
  )
}

type HistoryEntry = NonNullable<ReturnType<typeof useDuoAccountReservationHistory>['data']>['history'][number]

function HistoryRow({ h }: { h: HistoryEntry }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border-subtle px-3 py-2 text-xs">
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
  )
}

export function DuoAccountHistoryModal({ account, onClose }: { account: AdminDuoAccount | null; onClose: () => void }) {
  const { data, isLoading, isError } = useDuoAccountReservationHistory(account?.id)

  function renderBody() {
    if (isLoading) return <Skeleton className="h-48 w-full" />
    if (isError) return <ErrorAlert message="Não foi possível carregar o histórico desta conta." />
    if (!data || !account) return null
    return (
      <div className="space-y-4">
        <ActiveReservation account={account} />
        <div className="grid grid-cols-3 gap-2 rounded-xl bg-bg-raised p-3 text-center" data-tabular>
          <StatCell value={data.stats.total_reservations} label="Reservas totais" />
          <StatCell value={data.stats.distinct_boosters} label="Boosters distintos" />
          <StatCell value={formatDurationSeconds(data.stats.total_seconds)} label="Tempo total reservada" />
        </div>
        {data.history.length === 0 ? (
          <InlineEmpty>Nenhuma reserva registrada ainda.</InlineEmpty>
        ) : (
          <div className="max-h-80 space-y-1.5 overflow-y-auto pr-0.5">
            {data.history.map((h) => <HistoryRow key={h.id} h={h} />)}
          </div>
        )}
      </div>
    )
  }

  return (
    <Modal
      open={!!account}
      onOpenChange={(open) => !open && onClose()}
      title={`Histórico de reservas — ${account?.riot_id ?? account?.label}`}
      maxWidth="2xl"
    >
      {renderBody()}
    </Modal>
  )
}
