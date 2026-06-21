import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import { cn } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import { CheckCircle2, Zap, Eye, Radio, Trophy, EyeOff, Tv, Users } from 'lucide-react'
import { Skeleton } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import type { ServiceExtra } from '@/types'

const ICON_MAP: Record<string, React.ElementType> = {
  zap: Zap, eye: Eye, radio: Radio, trophy: Trophy, 'eye-off': EyeOff, tv: Tv, users: Users,
}

export function StepExtras() {
  const { selectedExtras, toggleExtra, basePrice, setExtrasPrice } = useOrderBuilderStore()
  const currency = useCurrency()
  const selectedIds = new Set(selectedExtras.map(e => e.extra.id))

  const { data: extras = [], isLoading } = useQuery({
    queryKey: ['service-extras'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('service_extras')
        .select('*')
        .eq('is_active', true)
        .order('sort_order')
      if (error) throw error
      return data as ServiceExtra[]
    },
    staleTime: 1000 * 60 * 10,
  })

  useEffect(() => {
    const total = selectedExtras.reduce((sum, { extra }) => {
      if (extra.price_modifier > 0) return sum + extra.price_modifier
      if (extra.price_modifier_pct > 0) return sum + (basePrice * extra.price_modifier_pct) / 100
      return sum
    }, 0)
    setExtrasPrice(Math.round(total * 100) / 100)
  }, [selectedExtras, basePrice, setExtrasPrice])

  function getExtraPrice(extra: ServiceExtra): number {
    if (extra.price_modifier > 0) return extra.price_modifier
    if (extra.price_modifier_pct > 0) return (basePrice * extra.price_modifier_pct) / 100
    return 0
  }

  function formatExtraPrice(extra: ServiceExtra): string {
    if (extra.price_modifier > 0) return `+${currency(extra.price_modifier)}`
    if (extra.price_modifier_pct > 0) return `+${extra.price_modifier_pct}%`
    return 'Grátis'
  }

  return (
    <div>
      <h2 className="text-lg font-bold text-ink mb-1">Extras Premium</h2>
      <p className="text-sm text-ink-secondary mb-6">
        Adicione extras opcionais ao seu serviço. Você pode pular esta etapa.
      </p>

      {isLoading ? (
        <div className="grid sm:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {extras.map((extra) => {
            const selected = selectedIds.has(extra.id)
            const Icon = ICON_MAP[extra.icon ?? 'zap'] ?? Zap
            const price = getExtraPrice(extra)

            return (
              <button
                key={extra.id}
                onClick={() => toggleExtra(extra)}
                className={cn(
                  'relative flex items-start gap-4 p-4 rounded-2xl border-2 text-left transition-all duration-150',
                  selected
                    ? 'border-brand bg-brand-muted shadow-brand'
                    : 'border-bg-elevated bg-bg-card hover:border-brand/40 hover:bg-bg-elevated'
                )}
              >
                {selected && (
                  <CheckCircle2 className="absolute top-3 right-3 h-4 w-4 text-brand" />
                )}
                <div className={cn('h-9 w-9 rounded-xl flex items-center justify-center shrink-0', selected ? 'bg-brand text-white' : 'bg-bg-elevated text-ink-secondary')}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0 pr-6">
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn('text-sm font-semibold', selected ? 'text-brand' : 'text-ink')}>{extra.name}</p>
                    <span className={cn('text-xs font-bold shrink-0', price === 0 ? 'text-success' : 'text-brand')}>
                      {formatExtraPrice(extra)}
                    </span>
                  </div>
                  <p className="text-xs text-ink-secondary mt-1 leading-relaxed">{extra.description}</p>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {selectedExtras.length > 0 && (
        <p className="mt-4 text-xs text-ink-secondary text-center">
          {selectedExtras.length} extra{selectedExtras.length > 1 ? 's' : ''} selecionado{selectedExtras.length > 1 ? 's' : ''}
        </p>
      )}
    </div>
  )
}
