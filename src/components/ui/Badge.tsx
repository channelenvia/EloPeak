import { useSharedNow } from '@/hooks/useSharedNow'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'
import { Hint } from './Hint'
import { describeOrderStatus, type OrderViewerRole } from '@/lib/orderStatusInfo'
import type { Order, BoosterStatus } from '@/types'
import {
  ORDER_STATUS_LABEL, ORDER_STATUS_COLOR, getOrderStatusGroup, ORDER_STATUS_GROUP_LABEL, ORDER_STATUS_GROUP_COLOR,
  BOOSTER_STATUS_LABEL, BOOSTER_STATUS_COLOR, isOrderOverdue, PAYMENT_IN_ANALYSIS_LABEL,
} from '@/lib/utils'

// Pill com variantes semânticas. A cor dos *StatusBadge entra via className
// (tailwind-merge sobrescreve a variante "neutral" padrão).
const badgeVariants = cva('badge', {
  variants: {
    variant: {
      neutral: 'text-ink-secondary bg-bg-raised',
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
    size: {
      md: '',
      // Chip compacto em caixa-alta (rótulos de status/tag dentro de cards e headers).
      tag: 'px-2 rounded-lg text-2xs font-bold uppercase tracking-wide',
    },
  },
  defaultVariants: { variant: 'neutral', size: 'md' },
})

interface BadgeProps extends VariantProps<typeof badgeVariants> {
  className?: string
  children?: React.ReactNode
  dot?: boolean
}

export function Badge({ className, variant, size, children, dot }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size }), className)}>
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
type OrderStatusBadgeOrder =
  Pick<Order, 'status' | 'assigned_booster_id'> & Partial<Pick<Order, 'match_sync_started_at' | 'estimated_hours'>>

interface OrderStatusBadgeProps {
  order: OrderStatusBadgeOrder
  /** Com o perfil de quem vê, o badge ganha tooltip descrevendo o status. */
  viewerRole?: OrderViewerRole
  /** Sobrescreve a descrição padrão do tooltip. */
  description?: string
  /** Ação do status (ex.: pagar, enviar credenciais): transforma o badge em botão. */
  onAction?: () => void
  actionLabel?: string
  align?: 'left' | 'right'
  /** Cartão já enviado e em análise: troca "Aguardando Pagamento" por "Analisando pagamento". */
  paymentInAnalysis?: boolean
}

export function OrderStatusBadge({ order, viewerRole, description, onAction, actionLabel, align, paymentInAnalysis }: OrderStatusBadgeProps) {
  const group = getOrderStatusGroup(order)
  useSharedNow() // re-renderiza quando o prazo estoura, sem depender de outro render
  const overdue = group === 'in_progress' && isOrderOverdue({
    match_sync_started_at: order.match_sync_started_at ?? null,
    estimated_hours: order.estimated_hours ?? null,
  })
  // Atraso sobrepõe o rótulo/cor normal do grupo "em andamento" -- o usuário
  // precisa ver que o prazo estourou olhando só pro badge.
  const badge = overdue ? (
    <Badge className="text-danger bg-danger/10" dot>Atrasado</Badge>
  ) : group === 'awaiting_payment' && paymentInAnalysis ? (
    <Badge className="text-info bg-info/10" dot>{PAYMENT_IN_ANALYSIS_LABEL}</Badge>
  ) : group === 'hidden' ? (
    <Badge className={ORDER_STATUS_COLOR[order.status]} dot>{ORDER_STATUS_LABEL[order.status]}</Badge>
  ) : (
    <Badge className={ORDER_STATUS_GROUP_COLOR[group]} dot>{ORDER_STATUS_GROUP_LABEL[group]}</Badge>
  )

  const text = description ?? (viewerRole ? describeOrderStatus(order, viewerRole, { paymentInAnalysis }) : null)
  if (!text) return badge
  return <Hint content={text} onClick={onAction} actionLabel={actionLabel} align={align}>{badge}</Hint>
}

export function BoosterStatusBadge({ status }: { status: BoosterStatus }) {
  return (
    <Badge className={BOOSTER_STATUS_COLOR[status]} dot>
      {BOOSTER_STATUS_LABEL[status]}
    </Badge>
  )
}

// Ponto pulsante de "ao vivo"/online (antes repetido à mão em 5 telas).
export function LiveDot({ className }: { className?: string }) {
  return <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full bg-success animate-pulse-slow', className)} />
}
