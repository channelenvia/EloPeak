import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
  /** "sm" = barra de busca de lista (toolbar, ao lado dos filtros); "md" = campo de busca dentro de modal/picker. */
  size?: 'sm' | 'md'
  /** Classe no wrapper (controla a largura -- ex.: "w-full sm:w-64 shrink-0"). */
  wrapperClassName?: string
}

// Único campo de busca com ícone do app -- antes reimplementado à mão (div
// relative + Search posicionado + input-base) em toda lista/picker que
// precisa filtrar por texto. "sm" cobre as barras de busca de lista
// (OrderHistory, Orders do booster/admin, AvailableJobs); "md" cobre busca
// dentro de modal/picker (reatribuir booster, revisão pendente, pacotes de
// coach).
export function SearchInput({ size = 'sm', wrapperClassName, className, ...props }: SearchInputProps) {
  return (
    <div className={cn('relative', wrapperClassName)}>
      <Search className={cn(
        'absolute top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none',
        size === 'sm' ? 'left-2.5 h-3.5 w-3.5' : 'left-3 h-4 w-4',
      )} />
      <input
        type="text"
        className={cn('input-base', size === 'sm' ? 'pl-8 py-1.5 text-xs' : 'pl-9 text-sm', className)}
        {...props}
      />
    </div>
  )
}
