import { FormField } from '@/components/ui/FormField'
import { cn } from '@/lib/utils'
import { LANES, LANE_ICON_URL } from '@/lib/lolTaxonomy'
import type { BoostMode } from '@/types'

interface LaneSelectFieldProps {
  lanes: string[]
  onChange: (lanes: string[]) => void
  boostMode: BoostMode
  error?: string
}

// Reaproveitado em elo_boost/win_boost/md5 (StepConfigure.tsx) e Clash
// (ClashConfigPicker.tsx) -- mesmo vocabulário/ícones de ServiceTagPills
// (lolTaxonomy.ts), só que como input em vez de exibição. O rótulo muda de
// sentido com a modalidade: solo = o cliente pede uma rota pro BOOSTER
// jogar (só ele joga a conta); duo = o cliente escolhe a rota que ELE MESMO
// vai jogar, o resto fica disponível pro booster (getAvailableLanes).
// Opcional -- pode ficar sem nenhuma selecionada (mesma regra no backend,
// orderPricing.ts, que não rejeita mais customer_lanes vazio).
export function LaneSelectField({ lanes, onChange, boostMode, error }: LaneSelectFieldProps) {
  function toggle(key: string) {
    if (lanes.includes(key)) onChange(lanes.filter(l => l !== key))
    else if (lanes.length < 2) onChange([...lanes, key])
  }

  return (
    <FormField
      label={boostMode === 'duo' ? 'Suas rotas' : 'Rotas para o booster'}
      error={error}
      hint={
        boostMode === 'duo'
          ? 'Opcional. Escolha até 2 rotas que você mesmo vai jogar — as demais ficam liberadas para o booster.'
          : 'Opcional. Escolha até 2 rotas que você quer que o booster jogue nesta conta.'
      }
    >
      <div className="flex flex-wrap gap-2">
        {LANES.map(({ key, label }) => {
          const selected = lanes.includes(key)
          const disabled = !selected && lanes.length >= 2
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggle(key)}
              disabled={disabled}
              className={cn(
                'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-bold border-2 transition-all',
                selected
                  ? 'bg-brand/15 border-brand text-brand'
                  : disabled
                    ? 'border-border-subtle text-ink-muted opacity-40 cursor-not-allowed'
                    : 'border-border-subtle text-ink-secondary hover:border-brand/40 hover:text-ink',
              )}
            >
              <img
                src={LANE_ICON_URL[key]}
                alt=""
                className="h-4 w-4 shrink-0"
                loading="lazy"
                onError={(e) => { e.currentTarget.style.display = 'none' }}
              />
              {label}
            </button>
          )
        })}
      </div>
    </FormField>
  )
}
