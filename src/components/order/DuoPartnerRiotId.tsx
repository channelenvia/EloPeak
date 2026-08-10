import { Hash } from 'lucide-react'
import { Skeleton } from '@/components/ui'
import { useOrderDuoPartnerRiotId } from '@/api/orders'

export function DuoPartnerRiotId({ orderId }: { orderId: string }) {
  const { data: riotId, isLoading } = useOrderDuoPartnerRiotId(orderId, true)

  if (isLoading) return <Skeleton className="h-14 w-full rounded-xl" />

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-muted">
        Conta que vai jogar com você nesse pedido, escolhida pelo booster.
      </p>
      {riotId ? (
        <div className="flex items-center gap-2 bg-bg-elevated rounded-xl px-3 py-2.5">
          <Hash className="h-4 w-4 text-brand shrink-0" />
          <p className="text-sm font-semibold text-ink truncate">{riotId}</p>
        </div>
      ) : (
        <p className="text-xs text-ink-muted py-2">
          O booster ainda não escolheu a conta duo para esse pedido.
        </p>
      )}
    </div>
  )
}
