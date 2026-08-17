import { SelectableTile } from './SelectableTile'

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
      {options.map((n) => (
        <SelectableTile
          key={n}
          size="md"
          className="flex-1 aspect-square max-w-[56px]"
          selected={value === n}
          locked={n > max}
          onClick={() => onChange(n)}
        >
          {n}
        </SelectableTile>
      ))}
    </div>
  )
}
