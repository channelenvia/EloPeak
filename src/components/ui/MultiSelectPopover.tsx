import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MultiSelectPopoverProps {
  label: string
  options: readonly { key: string; label: string }[]
  selected: ReadonlySet<string>
  onToggle: (key: string) => void
}

/**
 * Popover de filtro multi-seleção (rotas, especialidades, etc.) — mesmo
 * padrão ancorado do NotificationBell (botão + painel absoluto + fecha ao
 * clicar fora), reaproveitado aqui pra qualquer lista curta de checkboxes
 * que filtra automaticamente a cada marcação, sem botão de "aplicar".
 */
export function MultiSelectPopover({ label, options, selected, onToggle }: MultiSelectPopoverProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors',
          selected.size > 0
            ? 'border-brand bg-brand/10 text-brand'
            : 'border-bg-elevated text-ink-secondary hover:border-brand/40',
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

      {open && (
        <div className="absolute left-0 top-full mt-2 w-56 max-h-72 overflow-y-auto bg-bg-surface/95 backdrop-blur-xl border border-bg-elevated rounded-2xl shadow-2xl z-50 p-2">
          {options.map(({ key, label: optionLabel }) => {
            const on = selected.has(key)
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() => onToggle(key)}
                className={cn(
                  'w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-left text-xs font-medium transition-colors',
                  on ? 'bg-brand/10 text-brand' : 'text-ink-secondary hover:bg-bg-elevated',
                )}
              >
                <span className={cn(
                  'h-4 w-4 rounded-md border flex items-center justify-center shrink-0',
                  on ? 'border-brand bg-brand text-white' : 'border-bg-elevated',
                )}>
                  {on && <Check className="h-3 w-3" />}
                </span>
                {optionLabel}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
