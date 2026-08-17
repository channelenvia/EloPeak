import { Hash, History } from 'lucide-react'
import { ErrorAlert, Skeleton } from '@/components/ui'
import { useOrderDuoAccountHistory } from '@/api/orders'
import { formatDateTime } from '@/lib/utils'

// Substitui DuoPartnerRiotId (que só mostra a conta atual) quando o pedido
// já está concluído -- lista todas as contas duo associadas ao pedido,
// mais recente primeiro (get_order_duo_account_history já devolve nessa
// ordem: conta própria do booster, se houver, seguida das reservas de pool
// por reserved_at desc). Somente leitura, usada nas 3 telas (cliente,
// booster e admin).
export function DuoAccountHistoryList({ orderId }: { orderId: string }) {
  const { data: history, isLoading, isError, error } = useOrderDuoAccountHistory(orderId, true)

  if (isLoading) return <Skeleton className="h-14 w-full rounded-xl" />

  if (isError) {
    return <ErrorAlert message={error instanceof Error ? error.message : 'Erro ao carregar histórico de contas duo'} />
  }

  if (!history?.length) {
    return (
      <p className="text-xs text-ink-muted py-2">
        Nenhuma conta duo foi associada a esse pedido.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-muted flex items-center gap-1.5">
        <History className="h-3.5 w-3.5 shrink-0" />
        Contas jogadas no duo, da mais recente pra mais antiga.
      </p>
      <div className="space-y-1.5">
        {history.map((entry) => (
          <div key={`${entry.riot_id}-${entry.reserved_at ?? 'own'}`} className="flex items-center gap-2 bg-bg-elevated rounded-xl px-3 py-2.5">
            <Hash className="h-4 w-4 text-brand shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink truncate">{entry.riot_id}</p>
              {/* Nunca revela se a conta é do pool da plataforma ou própria
                  do booster -- só o Riot ID e quando foi vinculada (contas
                  próprias não têm timestamp de vínculo, ver own_account no
                  tipo). */}
              <p className="text-[10px] text-ink-muted">
                {entry.reserved_at ? formatDateTime(entry.reserved_at) : '—'}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
