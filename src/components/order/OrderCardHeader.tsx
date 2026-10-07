import { Badge } from '@/components/ui/Badge'
import type { Order } from '@/types'

interface OrderCardHeaderProps {
  order: Pick<Order, 'id' | 'drop_count'>
  title: string
  /** Lado direito (badge de status, tempo de revisão...). */
  trailing: React.ReactNode
}

// Cabeçalho único dos cards de pedido (cliente, admin, booster): código curto
// + "Dropado" acima, título do serviço abaixo, status à direita.
export function OrderCardHeader({ order, title, trailing }: OrderCardHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <p className="font-mono text-xs text-ink-muted">#{order.id.slice(0, 8).toUpperCase()}</p>
          {order.drop_count > 0 && <Badge variant="warning" size="tag">Dropado</Badge>}
        </div>
        <p className="truncate text-base font-semibold text-ink">{title}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{trailing}</div>
    </div>
  )
}
