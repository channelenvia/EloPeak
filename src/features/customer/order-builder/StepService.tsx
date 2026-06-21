import { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import { cn } from '@/lib/utils'
import type { ServiceType } from '@/types'
import { TrendingUp, Zap, Users, Award, CheckCircle2 } from 'lucide-react'

const SERVICES: { type: ServiceType; name: string; desc: string; icon: React.ElementType; badge?: string }[] = [
  { type: 'elo_boost', name: 'Elo Boost', desc: 'Suba do seu rank atual para a divisão desejada.', icon: TrendingUp, badge: 'Mais Popular' },
  { type: 'win_boost', name: 'Win Boost', desc: 'Compre um número fixo de vitórias para ganhar LP rapidamente.', icon: Zap, badge: 'Rápido' },
  { type: 'coaching', name: 'Coaching', desc: 'Sessões individuais com coaches de alto ELO.', icon: Users },
  { type: 'placement_matches', name: 'Placement Matches', desc: 'Comece a temporada no rank mais alto possível.', icon: Award },
]

export function StepService() {
  const { serviceType, setService } = useOrderBuilderStore()

  return (
    <div>
      <h2 className="text-lg font-bold text-ink mb-1">Selecionar Serviço</h2>
      <p className="text-sm text-ink-secondary mb-6">Com o que você precisa de ajuda?</p>

      <div className="grid sm:grid-cols-2 gap-3">
        {SERVICES.map(({ type, name, desc, icon: Icon, badge }) => (
          <button
            key={type}
            onClick={() => setService(type, type)}
            className={cn(
              'relative flex items-start gap-4 p-5 rounded-2xl border-2 text-left transition-all duration-150',
              serviceType === type
                ? 'border-brand bg-brand-muted shadow-brand'
                : 'border-bg-elevated bg-bg-card hover:border-brand/40 hover:bg-bg-elevated cursor-pointer'
            )}
          >
            {serviceType === type ? (
              <CheckCircle2 className="absolute top-3 right-3 h-4 w-4 text-brand" />
            ) : badge ? (
              <span className="absolute top-3 right-3 text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand text-white">
                {badge}
              </span>
            ) : null}
            <div className={cn('h-10 w-10 rounded-xl flex items-center justify-center shrink-0', serviceType === type ? 'bg-brand text-white' : 'bg-bg-elevated text-ink-secondary')}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className={cn('text-sm font-semibold', serviceType === type ? 'text-brand' : 'text-ink')}>{name}</p>
              <p className="text-xs text-ink-secondary mt-1 leading-relaxed">{desc}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
