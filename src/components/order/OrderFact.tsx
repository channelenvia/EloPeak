import { cn } from '@/lib/cn'

interface OrderFactProps {
  label: string
  children: React.ReactNode
  /** Ocupa a linha inteira do grid (valores longos, como o Riot ID). */
  wide?: boolean
  className?: string
}

// Par rótulo/valor dos campos do resumo de pedido: rótulo micro em caixa-alta
// acima, valor em 14px logo abaixo. Sempre dentro de <OrderFacts> (dl).
export function OrderFact({ label, children, wide, className }: OrderFactProps) {
  return (
    <div className={cn('min-w-0', wide && 'col-span-2', className)}>
      <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-1 min-w-0 text-sm font-medium text-ink" data-tabular>{children}</dd>
    </div>
  )
}

export function OrderFacts({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-2 gap-x-4 gap-y-3">{children}</dl>
}
