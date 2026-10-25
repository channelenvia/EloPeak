import type { ComponentType, ReactNode } from 'react'
import { AnimatedNumber } from './AnimatedNumber'
import { Card } from './Card'

interface StatCardProps {
  label: string
  /** Número → conta até o valor (ver AnimatedNumber); qualquer outro nó é exibido como veio. */
  value: ReactNode
  /** Formata o número em andamento (ex.: moeda). Só vale quando `value` é number. */
  format?: (n: number) => string
  icon: ComponentType<{ className?: string }>
  color: string
  trend?: string | null
  iconSize?: 'sm' | 'md'
  valueSize?: 'lg' | 'xl'
  /** Passe true quando o card estiver dentro de um <Link>/onClick -- mesmo
   * hover (borda + sombra + leve elevação) de todo outro card clicável do
   * app (Card variant="interactive"). Sem isso, um StatCard clicável ficava
   * sem nenhum retorno visual de hover, diferente do resto da UI. */
  interactive?: boolean
}

export function StatCard({ label, value, format, icon: Icon, color, trend, iconSize = 'sm', valueSize = 'xl', interactive = false }: StatCardProps) {
  const iconBoxClass = iconSize === 'md' ? 'h-9 w-9 rounded-xl' : 'h-8 w-8 rounded-lg'
  const valueClass = valueSize === 'lg' ? 'text-2xl' : 'text-xl'

  return (
    <Card padding="md" variant={interactive ? 'interactive' : 'standard'}>
      <div className="flex items-start justify-between mb-3">
        <div className={`${iconBoxClass} ${color} flex items-center justify-center`}>
          <Icon className="h-4 w-4" />
        </div>
        {trend && <span className="text-xs font-semibold text-success">{trend}</span>}
      </div>
      <div className={`${valueClass} font-bold text-ink`}>
        {typeof value === 'number' ? <AnimatedNumber value={value} format={format} /> : value}
      </div>
      <p className="text-xs text-ink-secondary mt-0.5">{label}</p>
    </Card>
  )
}
