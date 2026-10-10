import { cn } from '@/lib/cn'

// Colunas responsivas padrão para grades de cards (pedidos, métricas, serviços).
const COLS = {
  3: 'md:grid-cols-2 xl:grid-cols-3',
  4: 'sm:grid-cols-2 xl:grid-cols-4',
} as const

interface CardGridProps extends React.HTMLAttributes<HTMLDivElement> {
  cols?: keyof typeof COLS
}

export function CardGrid({ cols = 3, className, ...props }: CardGridProps) {
  return <div className={cn('grid grid-cols-1 gap-4', COLS[cols], className)} {...props} />
}
