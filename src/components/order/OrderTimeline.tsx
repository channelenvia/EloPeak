import {
  FileText, CreditCard, BadgeCheck, Search, UserCheck, Swords, PauseCircle, Flag,
  MessageCircleQuestion, CheckCircle2, ShieldAlert, RotateCcw, XCircle, Clock, type LucideIcon,
} from 'lucide-react'
import { Card } from '@/components/ui'
import { ORDER_STATUS_LABEL, timeAgo } from '@/lib/utils'
import type { OrderStatus, OrderStatusHistory } from '@/types'

// Um ícone por status -- bem diferente do Clock genérico repetido em toda
// etapa de antes. Escolhido pelo que aquele status REPRESENTA (não pela cor):
// check pra conclusão, X pra cancelamento, escudo pra disputa, etc.
const ORDER_STATUS_ICON: Record<OrderStatus, LucideIcon> = {
  draft: FileText,
  awaiting_payment: CreditCard,
  paid: BadgeCheck,
  awaiting_assignment: Search,
  assigned: UserCheck,
  in_progress: Swords,
  paused: PauseCircle,
  drop_requested: Flag,
  awaiting_customer: MessageCircleQuestion,
  completed: CheckCircle2,
  disputed: ShieldAlert,
  refunded: RotateCcw,
  canceled: XCircle,
}

// Cor do círculo preenchido na etapa ATUAL (a última do histórico) -- mesmo
// token de cor usado em ORDER_STATUS_COLOR (badges), só que como
// border+bg sólido em vez de text+bg/10. Classes por extenso (nunca
// interpoladas com `${}`) porque o Tailwind escaneia o código-fonte em busca
// de strings literais -- uma classe montada dinamicamente não é encontrada
// no scan e fica sem estilo no build de produção.
const ORDER_STATUS_ACCENT: Record<OrderStatus, string> = {
  draft: 'border-ink-muted bg-ink-muted',
  awaiting_payment: 'border-warning bg-warning',
  paid: 'border-info bg-info',
  awaiting_assignment: 'border-info bg-info',
  assigned: 'border-brand bg-brand',
  in_progress: 'border-success bg-success',
  paused: 'border-warning bg-warning',
  drop_requested: 'border-danger bg-danger',
  awaiting_customer: 'border-accent bg-accent',
  completed: 'border-success bg-success',
  disputed: 'border-danger bg-danger',
  refunded: 'border-ink-muted bg-ink-muted',
  canceled: 'border-ink-muted bg-ink-muted',
}

// Compartilhada entre cliente/booster/admin -- antes cada tela tinha seu
// próprio visual pro mesmo dado (o admin usava uma lista simples de pontos
// soltos, sem a linha conectando as etapas).
export function OrderTimeline({ history, bare = false }: { history: OrderStatusHistory[] | undefined; bare?: boolean }) {
  const content = (
    <>
      {!bare && <h3 className="text-sm font-semibold text-ink mb-4">Histórico do Pedido</h3>}
      {!history?.length ? (
        <p className="text-xs text-ink-muted">Sem histórico ainda.</p>
      ) : (
        <div className="relative">
          <div className="absolute left-3.5 top-4 bottom-4 w-px bg-border-subtle" />
          <div className="space-y-4">
            {history.map((entry, idx) => {
              const isCurrent = idx === history.length - 1
              const StatusIcon = ORDER_STATUS_ICON[entry.to_status] ?? Clock
              return (
                <div key={entry.id} className="flex items-start gap-4 relative">
                  <div className={`h-7 w-7 rounded-full border-2 flex items-center justify-center shrink-0 z-10 ${
                    isCurrent ? ORDER_STATUS_ACCENT[entry.to_status] : 'border-border-subtle bg-bg-surface'
                  }`}>
                    <StatusIcon className={`h-3.5 w-3.5 ${isCurrent ? 'text-white' : 'text-ink-muted'}`} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-ink">
                      {ORDER_STATUS_LABEL[entry.to_status] ?? entry.to_status.replace(/_/g, ' ')}
                    </p>
                    <p className="text-[10px] text-ink-muted mt-0.5">{timeAgo(entry.created_at)}</p>
                    {entry.reason && <p className="text-xs text-ink-secondary mt-0.5">{entry.reason}</p>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )

  if (bare) return content
  return <Card padding="md">{content}</Card>
}
