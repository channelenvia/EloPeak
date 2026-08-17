import { forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// Estado visual compartilhado por qualquer "chip selecionável em grade":
// contagem de vitórias, divisão de rank, tier de rank, dia da Clash etc.
// Antes cada um desses reimplementava a mesma combinação de borda/opacidade
// com strings Tailwind copiadas (WinCountButtons, a grade de divisões e o
// TierButton dentro de RankLockGrid) em vez de compartilhar uma fonte única.
// Esse componente é essa fonte única — conteúdo (número, ícone, texto) fica
// por conta de quem usa.
const selectableTileVariants = cva(
  'flex items-center justify-center rounded-xl border-2 font-bold transition-all duration-fast focus-ring disabled:cursor-not-allowed',
  {
    variants: {
      state: {
        default: 'border-border-subtle bg-bg-surface text-ink-secondary hover:border-brand/30 hover:bg-bg-raised',
        selected: 'border-brand bg-brand text-white',
        // Seleção com preenchimento sutil em vez de sólido — usada quando o
        // conteúdo (ícone + label) já carrega cor própria (ex.: emblema de rank).
        'selected-tinted': 'border-brand bg-brand/10',
        locked: 'border-transparent bg-transparent text-ink-muted opacity-30',
      },
      size: {
        sm: 'text-xs py-1.5',
        md: 'text-lg py-2.5',
        tile: 'flex-col gap-1 py-2.5 px-1',
      },
    },
    defaultVariants: { state: 'default', size: 'sm' },
  },
)

export interface SelectableTileProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'>,
    Pick<VariantProps<typeof selectableTileVariants>, 'size'> {
  selected?: boolean
  locked?: boolean
  /** Preenchimento sutil (bg-brand/10) em vez de sólido quando selecionado. */
  tinted?: boolean
}

export const SelectableTile = forwardRef<HTMLButtonElement, SelectableTileProps>(
  ({ className, selected, locked, tinted, size, children, disabled, ...props }, ref) => {
    const state = locked ? 'locked' : selected ? (tinted ? 'selected-tinted' : 'selected') : 'default'
    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled ?? locked}
        className={cn(selectableTileVariants({ state, size }), className)}
        {...props}
      >
        {children}
      </button>
    )
  },
)
SelectableTile.displayName = 'SelectableTile'
