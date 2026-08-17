import type { ReactNode } from 'react'
import { ShieldCheck, AlertTriangle } from 'lucide-react'

const VARIANT = {
  guarantee: { icon: ShieldCheck, box: 'border-brand/20 bg-brand/5', icon_color: 'text-brand' },
  warning: { icon: AlertTriangle, box: 'border-warning/30 bg-warning/5', icon_color: 'text-warning' },
} as const

export function GuaranteeNotice({
  title, children, variant = 'guarantee',
}: {
  title: string
  children?: ReactNode
  variant?: keyof typeof VARIANT
}) {
  const { icon: Icon, box, icon_color } = VARIANT[variant]
  return (
    <div className={`rounded-2xl border p-4 ${box}`}>
      <div className={`flex items-center gap-2 ${children ? 'mb-2' : ''}`}>
        <Icon className={`h-4 w-4 shrink-0 ${icon_color}`} />
        <p className="text-sm font-bold text-ink">{title}</p>
      </div>
      {children && <p className="text-xs text-ink-secondary leading-relaxed">{children}</p>}
    </div>
  )
}
