import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
  /** "sm" = barra de busca de lista (toolbar, ao lado dos filtros); "md" = campo de busca dentro de modal/picker. */
  size?: 'sm' | 'md'
  /** Classe no wrapper (controla a largura -- ex.: "w-full sm:w-64 shrink-0"). */
  wrapperClassName?: string
}

// Campo de busca com ícone. "sm" = barras de busca de lista; "md" = busca
// dentro de modal/picker.
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
