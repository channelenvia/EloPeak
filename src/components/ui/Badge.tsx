import { cn } from '@/lib/utils'
import type { OrderStatus, BoosterStatus } from '@/types'
import {
  ORDER_STATUS_LABEL, ORDER_STATUS_COLOR,
  BOOSTER_STATUS_LABEL, BOOSTER_STATUS_COLOR,
} from '@/lib/utils'

interface BadgeProps {
  className?: string
  children?: React.ReactNode
  dot?: boolean
}

function Badge({ className, children, dot }: BadgeProps) {
  return (
    <span className={cn('badge', className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge className={ORDER_STATUS_COLOR[status]} dot>
      {ORDER_STATUS_LABEL[status]}
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
