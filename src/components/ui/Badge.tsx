import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import type { Order, BoosterStatus } from '@/types'
import {
  ORDER_STATUS_LABEL, ORDER_STATUS_COLOR, getOrderStatusGroup, ORDER_STATUS_GROUP_LABEL, ORDER_STATUS_GROUP_COLOR,
  BOOSTER_STATUS_LABEL, BOOSTER_STATUS_COLOR,
} from '@/lib/utils'

// Antes só existia como wrapper interno (não exportado) — ~6 lugares no app
// hand-rolavam seu próprio <span> de pill em vez de reusar isso. Agora é um
// primitivo real com variantes semânticas, pra parar essa duplicação daqui
// pra frente. OrderStatusBadge/BoosterStatusBadge preservam exatamente o
// mesmo comportamento (passam a cor via className, que sobrescreve a
// variante "neutral" default via tailwind-merge).
const badgeVariants = cva('badge', {
  variants: {
    variant: {
      neutral: 'text-ink-secondary bg-bg-elevated',
      brand: 'text-brand bg-brand/10',
      accent: 'text-accent bg-accent/10',
      success: 'text-success bg-success/10',
      warning: 'text-warning bg-warning/10',
      danger: 'text-danger bg-danger/10',
      info: 'text-info bg-info/10',
      // Contexto de role/rank — levemente mais estruturado (com borda), pra
      // uso em locais onde o badge precisa se distinguir de um status.
      outline: 'text-ink-secondary bg-transparent border border-border-subtle',
    },
  },
  defaultVariants: { variant: 'neutral' },
})

interface BadgeProps extends VariantProps<typeof badgeVariants> {
  className?: string
  children?: React.ReactNode
  dot?: boolean
}

export function Badge({ className, variant, children, dot }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

// Mostra o rótulo agrupado e padronizado (Em Andamento/Aguardando
// Booster/Aguardando Credenciais/etc) em vez do status bruto -- exceto pra
// canceled/refunded/disputed, que não têm grupo próprio e caem no rótulo
// granular original (o único contexto em que ainda aparecem é a auditoria
// do admin, onde a distinção entre os três importa).
export function OrderStatusBadge({ order }: { order: Pick<Order, 'status' | 'assigned_booster_id'> }) {
  const group = getOrderStatusGroup(order)
  if (group === 'hidden') {
    return (
      <Badge className={ORDER_STATUS_COLOR[order.status]} dot>
        {ORDER_STATUS_LABEL[order.status]}
      </Badge>
    )
  }
  return (
    <Badge className={ORDER_STATUS_GROUP_COLOR[group]} dot>
      {ORDER_STATUS_GROUP_LABEL[group]}
    </Badge>
  )
}

export function BoosterStatusBadge({ status }: { status: BoosterStatus }) {
  return (
    <Badge className={BOOSTER_STATUS_COLOR[status]} dot>
      {BOOSTER_STATUS_LABEL[status]}
    </Badge>
  )
}
