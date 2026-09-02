import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

// Seletor binário embutido no fim de um campo de texto (Riot ID) -- fica
// colapsado mostrando só a opção atual; a seta pra baixo expande um
// dropdown ABAIXO do campo, revelando a outra opção pra trocar (não do
// lado, pra não competir com o texto digitado). Extraído de
// StepConfigure.tsx (Tipo de Fila) pra ser reaproveitado também no dia do
// Clash (Sábado/Domingo) -- mesma mecânica, só troca as duas opções e o
// rótulo de cada uma.
export function InlineFieldSelect<T extends string>({
  value, options, label, onChange, fieldLabel = 'opção',
}: {
  value: T
  options: readonly [T, T]
  label: (option: T) => string
  onChange: (option: T) => void
  /** Nome do campo, sem verbo -- ex.: "tipo de fila", "dia do Clash".
   * Vira "Trocar {fieldLabel}" / "Fechar {fieldLabel}". */
  fieldLabel?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const other = options[0] === value ? options[1] : options[0]

  return (
    <div className="relative w-[5.5rem] shrink-0">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className={cn(
          'flex w-full items-center justify-between gap-1 border border-border-subtle bg-bg-surface px-2 py-1 shadow-sm hover:border-brand/40 hover:shadow-brand transition-all',
          expanded ? 'rounded-t-lg border-b-0' : 'rounded-lg',
        )}
        aria-label={expanded ? `Fechar ${fieldLabel}` : `Trocar ${fieldLabel}`}
      >
        <span className="text-xs font-bold text-brand whitespace-nowrap">{label(value)}</span>
        <ChevronDown className={cn('h-3 w-3 text-ink-muted transition-transform shrink-0', expanded && 'rotate-180')} />
      </button>
      {expanded && (
        <div className="absolute inset-x-0 top-full z-20 rounded-b-lg border border-t-0 border-border-subtle bg-bg-surface shadow-sm overflow-hidden animate-in fade-in-0 slide-in-from-top-1 duration-150">
          <button
            type="button"
            onClick={() => {
              onChange(other)
              setExpanded(false)
            }}
            className="block w-full px-2 py-1 text-xs font-bold text-brand text-left hover:bg-brand/10 transition-colors whitespace-nowrap"
          >
            {label(other)}
          </button>
        </div>
      )}
    </div>
  )
}
