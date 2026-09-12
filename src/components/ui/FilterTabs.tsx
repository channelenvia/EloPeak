import { cn } from '@/lib/utils'

export interface FilterTabOption<T extends string> {
  value: T
  label: string
  /** Contador dinâmico ao lado do label (ex.: quantos pedidos bateriam esse filtro). */
  count?: number
  /** Pontinho de notificação (ex.: "há candidatura pendente") em vez de/além do count. */
  dot?: boolean
}

interface FilterTabsProps<T extends string> {
  options: FilterTabOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Rótulo em caps acima do grupo de pills (ex.: "Fila", "Modo") -- omite quando o grupo já é auto-explicativo (ex.: status de um booster). */
  label?: string
  /** Uma linha só, sem quebrar (ex.: Tier do Clash, 5 opções). */
  nowrap?: boolean
}

// Grupo de pills sempre visíveis pra alternar entre um pequeno conjunto de
// filtros mutuamente exclusivos (status de booster, fila, modo, tier...) --
// fonte única de estilo, antes duplicada à mão (bg-bg-surface/80 backdrop-
// blur num lugar, bg-bg-raised sem contador em outro). Pra filtros com MUITAS
// opções ou sub-filtros condicionais, use o padrão de dropdown
// (filterDropdownStyles.ts) em vez deste.
export function FilterTabs<T extends string>({ options, value, onChange, label, nowrap }: FilterTabsProps<T>) {
  const pills = (
    <div role="group" aria-label={label} className={cn('flex gap-1 bg-bg-raised rounded-lg p-1 w-fit', nowrap ? 'flex-nowrap' : 'flex-wrap')}>
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'relative flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap',
              active ? 'bg-brand text-white' : 'text-ink-secondary hover:text-ink',
            )}
          >
            {opt.label}
            {opt.count != null && <span className={cn('text-[10px]', active ? 'text-white/80' : 'text-ink-muted')}>{opt.count}</span>}
            {opt.dot && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-bg-surface" />}
          </button>
        )
      })}
    </div>
  )

  if (!label) return pills

  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted mb-1.5">{label}</p>
      {pills}
    </div>
  )
}
