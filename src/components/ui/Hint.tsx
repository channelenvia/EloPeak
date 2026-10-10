import { useId } from 'react'
import { cn } from '@/lib/cn'

interface HintProps {
  /** Texto do tooltip (hover e foco de teclado). */
  content: React.ReactNode
  children: React.ReactNode
  /** Quando existe, o conteúdo vira um botão clicável. */
  onClick?: () => void
  /** Chamada de ação mostrada no fim do tooltip (ex.: "Clique para pagar"). */
  actionLabel?: string
  /** Lado do tooltip em relação ao gatilho. */
  align?: 'left' | 'right'
  className?: string
}

// Tooltip de hover/foco (sem biblioteca) que, com onClick, vira um gatilho
// clicável. Usado pelo badge de status do pedido.
export function Hint({ content, children, onClick, actionLabel, align = 'left', className }: HintProps) {
  const id = useId()
  const triggerClass = 'focus-ring rounded-full'
  return (
    <span className={cn('group/hint relative inline-flex', className)}>
      {onClick ? (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick() }}
          aria-describedby={id}
          className={cn(triggerClass, 'cursor-pointer transition-[filter,transform] hover:brightness-125 active:scale-[0.97]')}
        >
          {children}
        </button>
      ) : (
        <span tabIndex={0} aria-describedby={id} className={cn(triggerClass, 'cursor-help')}>{children}</span>
      )}
      <span
        id={id}
        role="tooltip"
        className={cn(
          'pointer-events-none absolute top-full z-30 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-border-subtle bg-bg-raised p-3',
          'text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-ink-secondary shadow-card-hover',
          'opacity-0 transition-opacity duration-fast group-hover/hint:opacity-100 group-focus-within/hint:opacity-100',
          align === 'right' ? 'right-0' : 'left-0',
        )}
      >
        {content}
        {onClick && actionLabel && <span className="mt-1.5 block font-semibold text-brand">{actionLabel} →</span>}
      </span>
    </span>
  )
}
