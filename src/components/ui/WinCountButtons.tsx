import { cn } from '@/lib/utils'

interface WinCountButtonsProps {
  value: number | null
  max: number
  onChange: (n: number) => void
}

// Botões quadrados 1..max (nunca mais que 5) — nunca um <select>. `max` é
// sempre o limite JÁ calculado pelo chamador (5 fixo para Vitórias comuns,
// ou o teto de partidas restantes para MD5) — este componente nunca decide
// o limite sozinho, só o renderiza.
export function WinCountButtons({ value, max, onChange }: WinCountButtonsProps) {
  const options = [1, 2, 3, 4, 5]
  return (
    <div className="flex gap-2">
      {options.map((n) => {
        const disabled = n > max
        return (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onClick={() => onChange(n)}
            className={cn(
              'flex-1 aspect-square max-w-[56px] rounded-xl border-2 text-lg font-extrabold transition-all',
              value === n ? 'border-brand bg-brand text-white'
                : disabled ? 'border-transparent bg-bg-elevated/40 text-ink-muted opacity-30 cursor-not-allowed'
                  : 'border-bg-elevated bg-bg-card text-ink-secondary hover:border-brand/30',
            )}
          >
            {n}
          </button>
        )
      })}
    </div>
  )
}
