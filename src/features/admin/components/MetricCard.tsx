import type { ComponentType } from 'react'
import { AnimatedNumber, Card } from '@/components/ui'
import { cn } from '@/lib/cn'

interface MetricCardProps {
  label: string
  value: number
  /** Formata o número em andamento (ex.: moeda); sem isso, inteiro pt-BR. */
  format?: (n: number) => string
  icon: ComponentType<{ className?: string }>
  tone: string
}

// Métrica compacta do financeiro do admin (ícone ao lado do valor), com contagem animada.
export function MetricCard({ label, value, format, icon: Icon, tone }: MetricCardProps) {
  return (
    <Card padding="md" className="min-w-0">
      <div className="flex items-center gap-3">
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', tone)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-ink-muted">{label}</p>
          <p className="truncate text-lg font-black text-ink">
            <AnimatedNumber value={value} format={format} />
          </p>
        </div>
      </div>
    </Card>
  )
}
