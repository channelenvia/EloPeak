import type { ComponentType, ReactNode } from 'react'
import { Card } from './Card'

interface StatCardProps {
  label: string
  value: ReactNode
  icon: ComponentType<{ className?: string }>
  color: string
  trend?: string | null
  iconSize?: 'sm' | 'md'
  valueSize?: 'lg' | 'xl'
}

export function StatCard({ label, value, icon: Icon, color, trend, iconSize = 'sm', valueSize = 'xl' }: StatCardProps) {
  const iconBoxClass = iconSize === 'md' ? 'h-9 w-9 rounded-xl' : 'h-8 w-8 rounded-lg'
  const valueClass = valueSize === 'lg' ? 'text-2xl' : 'text-xl'

  return (
    <Card padding="md">
      <div className="flex items-start justify-between mb-3">
        <div className={`${iconBoxClass} ${color} flex items-center justify-center`}>
          <Icon className="h-4 w-4" />
        </div>
        {trend && <span className="text-xs font-semibold text-success">{trend}</span>}
      </div>
      <div className={`${valueClass} font-bold text-ink`}>{value}</div>
      <p className="text-xs text-ink-secondary mt-0.5">{label}</p>
    </Card>
  )
}
