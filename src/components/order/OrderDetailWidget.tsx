import { useEffect, useRef, useState } from 'react'
import { Popover } from '@/components/ui'
import { cn } from '@/lib/utils'

interface OrderDetailWidgetProps {
  icon: React.ElementType
  label: string
  status?: React.ReactNode
  children: React.ReactNode
  popoverClassName?: string
  /** Muda de valor pra forçar a abertura do popover (ex.: deep link #credentials). */
  forceOpenSignal?: unknown
  /** Trigger de texto simples (mesmo tamanho do título da seção) em vez do tile com ícone -- usado quando o widget divide a linha com um <h3>. */
  compact?: boolean
}

/**
 * Tile clicável que abre seu conteúdo num popover ancorado -- usado pra
 * "Conta do pedido"/"Histórico do Pedido" dentro do card "Detalhes do
 * pedido", nas páginas de cliente/booster/admin, em vez de cada seção ser um
 * card cheio próprio empilhado na página.
 */
export function OrderDetailWidget({ icon: Icon, label, status, children, popoverClassName, forceOpenSignal, compact }: OrderDetailWidgetProps) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (forceOpenSignal === undefined) return
    anchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setOpen(true)
  }, [forceOpenSignal])

  return (
    <>
      {compact ? (
        <button
          ref={anchorRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'inline-flex items-center gap-1.5 text-sm font-semibold shrink-0 transition-colors',
            open ? 'text-brand' : 'text-ink-secondary hover:text-ink',
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ) : (
        <button
          ref={anchorRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'flex items-center gap-2.5 rounded-xl border-2 px-3.5 py-2.5 text-left transition-colors',
            open ? 'border-brand bg-brand/10' : 'border-border-subtle bg-bg-card hover:border-brand/40 hover:bg-bg-elevated',
          )}
        >
          <div className={cn(
            'h-8 w-8 rounded-lg flex items-center justify-center shrink-0',
            open ? 'bg-brand text-white' : 'bg-bg-elevated text-ink-secondary',
          )}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className={cn('text-xs font-semibold', open ? 'text-brand' : 'text-ink')}>{label}</p>
            {status && <p className="text-[10px] text-ink-muted truncate">{status}</p>}
          </div>
        </button>
      )}

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} align={compact ? 'end' : 'start'} className={cn('w-[min(90vw,380px)] p-4', popoverClassName)}>
        {children}
      </Popover>
    </>
  )
}
