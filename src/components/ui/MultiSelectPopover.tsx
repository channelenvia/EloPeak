import { useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover } from './Popover'

interface MultiSelectPopoverProps {
  label: string
  options: readonly { key: string; label: string }[]
  selected: ReadonlySet<string>
  onToggle: (key: string) => void
}

/**
 * Popover de filtro multi-seleção (rotas, especialidades, etc.) — pra
 * qualquer lista curta de checkboxes que filtra automaticamente a cada
 * marcação, sem botão de "aplicar". Antes reimplementava seu próprio
 * portal/posicionamento/fechar-ao-clicar-fora em paralelo ao <Popover>; agora
 * só cuida do trigger e da lista, delegando o painel ancorado pro primitivo
 * compartilhado (que também escapa de ancestrais com overflow:hidden/auto,
 * o que essa implementação antiga não fazia).
 */
export function MultiSelectPopover({ label, options, selected, onToggle }: MultiSelectPopoverProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'focus-ring flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors',
          selected.size > 0
            ? 'border-brand bg-brand/10 text-brand'
            : 'border-border-subtle text-ink-secondary hover:border-brand/40',
        )}
      >
        {label}
        {selected.size > 0 && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-brand/20 text-brand">
            {selected.size}
          </span>
        )}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        align="start"
        className="w-56 max-h-72 overflow-y-auto p-2"
      >
        {options.map(({ key, label: optionLabel }) => {
          const on = selected.has(key)
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(key)}
              className={cn(
                'focus-ring w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-left text-xs font-medium transition-colors',
                on ? 'bg-brand/10 text-brand' : 'text-ink-secondary hover:bg-bg-raised',
              )}
            >
              <span className={cn(
                'h-4 w-4 rounded-md border flex items-center justify-center shrink-0',
                on ? 'border-brand bg-brand text-white' : 'border-border-subtle',
              )}>
                {on && <Check className="h-3 w-3" />}
              </span>
              {optionLabel}
            </button>
          )
        })}
      </Popover>
    </>
  )
}
