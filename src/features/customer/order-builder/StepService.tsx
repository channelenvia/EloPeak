import { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import { cn } from '@/lib/utils'
import type { ServiceType } from '@/types'
import { TrendingUp, Zap, Users, Swords, CheckCircle2, Check } from 'lucide-react'

// `features` só aparece no widget grande do step 1 (fullWidth) -- resume o
// que o próximo step vai pedir (modalidade, fila, Riot ID, etc.), pra o
// cliente já saber o que esperar antes de escolher. O detalhe de detecção
// automática de Vitórias/MD5, por exemplo, saiu do banner que ficava lá
// dentro do StepConfigure e virou um item aqui.
//
// Duas regras nesta lista:
// 1. Ordem por destaque -- o(s) diferencial(is) exclusivo(s) DESTE serviço
//    (o que nenhum outro card oferece) vem(êm) primeiro; mecânicas
//    compartilhadas com outros serviços (modalidade, fila) vêm depois.
// 2. Texto padronizado -- um item que aparece em mais de um card usa
//    exatamente a mesma frase em todos eles (ex.: "Modalidade Solo..." usa a
//    versão mais descritiva, a mesma do elo_boost, em vez de variar a
//    redação por serviço).
const MODALIDADE_FEATURE = 'Modalidade Solo (o booster joga) ou Duo (você joga junto)'
const FILA_FEATURE = 'Fila Solo/Duo ou Flex'

const SERVICES: { type: ServiceType; name: string; desc: string; features: string[]; icon: React.ElementType; badge?: string }[] = [
  {
    type: 'elo_boost',
    name: 'Elo Boost',
    desc: 'Suba do seu rank atual para a divisão desejada — solo ou duo.',
    features: [
      'Escolha o rank alvo — a subida é calculada na hora',
      MODALIDADE_FEATURE,
      FILA_FEATURE,
      'Riot ID com detecção automática do seu rank atual',
    ],
    icon: TrendingUp,
    badge: 'Mais Popular',
  },
  {
    type: 'win_boost',
    name: 'Win Boost',
    desc: 'Compre vitórias avulsas ou, se ainda não jogou o posicionamento, ative a garantia MD5 automaticamente.',
    features: [
      'Detecta Vitórias ou MD5 automaticamente pelo seu Riot ID',
      'Selecione de 1 a 5 vitórias (ou partidas de posicionamento na MD5)',
      MODALIDADE_FEATURE,
      FILA_FEATURE,
    ],
    icon: Zap,
    badge: 'Rápido',
  },
  {
    type: 'clash',
    name: 'Clash',
    desc: 'Solo ou Duo Clash no sábado ou domingo — o booster monta o time dentro do jogo.',
    features: [
      'Escolha o dia: sábado ou domingo',
      'Tier detectado automaticamente pelo seu rank na fila Solo/Duo',
      MODALIDADE_FEATURE,
    ],
    icon: Swords,
  },
  {
    type: 'coaching',
    name: 'Coaching',
    desc: 'Sessões individuais com coaches de alto ELO para evolução real.',
    features: [
      'Escolha um pacote de sessões com o coach',
      'Atendimento individual, focado no seu jogo',
    ],
    icon: Users,
  },
]

export function StepService({ fullWidth }: { fullWidth?: boolean }) {
  const { serviceType, setService, reset, preferredBoosterId, preferredBoosterName, setPreferredBooster } = useOrderBuilderStore()

  const handleSelectService = (type: ServiceType) => {
    if (serviceType && serviceType !== type) {
      reset()
      // reset() zera preferredBoosterId/Name junto com o resto -- mas o
      // vínculo com um booster específico só deve sair pelo x do banner
      // (OrderBuilder.tsx clearPreferredBooster), nunca por trocar de
      // serviço. Reaplica depois do reset.
      if (preferredBoosterId && preferredBoosterName) setPreferredBooster(preferredBoosterId, preferredBoosterName)
    }
    setService(type, type)
  }

  return (
    <div>
      <h2 className="text-lg font-bold text-ink mb-1">Selecionar Serviço</h2>
      <p className="text-sm text-ink-secondary mb-6">Com o que você precisa de ajuda?</p>

      {/* Antes de escolher um serviço (step 1), este é o único widget na
          tela (a aside de valores só existe a partir do step 2, ver
          showSummary em OrderBuilder.tsx) -- continua 2x2 (não vira 4
          colunas). O "widgetzão" vem principalmente da lista de features
          abaixo (só aparece com fullWidth), não de inflar fonte/ícone --
          um padding levemente maior já basta pra não ficar enxuto. */}
      <div className="grid sm:grid-cols-2 gap-4">
        {SERVICES.map(({ type, name, desc, features, icon: Icon, badge }) => (
          <button
            key={type}
            onClick={() => handleSelectService(type)}
            className={cn(
              'relative flex flex-col items-start gap-3 rounded-2xl border-2 text-left transition-all duration-150',
              fullWidth ? 'p-6' : 'p-5',
              serviceType === type
                ? 'border-brand bg-brand/10 shadow-brand'
                : 'border-border-subtle bg-bg-card hover:border-brand/40 hover:bg-bg-elevated cursor-pointer'
            )}
          >
            {serviceType === type ? (
              <CheckCircle2 className="absolute top-3 right-3 h-4 w-4 text-brand" />
            ) : badge ? (
              <span className="absolute top-3 right-3 text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand text-white">
                {badge}
              </span>
            ) : null}
            <div className={cn('rounded-xl flex items-center justify-center shrink-0', fullWidth ? 'h-11 w-11' : 'h-10 w-10', serviceType === type ? 'bg-brand text-white' : 'bg-bg-elevated text-ink-secondary')}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className={cn('text-sm font-semibold', serviceType === type ? 'text-brand' : 'text-ink')}>{name}</p>
              <p className="text-xs text-ink-secondary mt-1 leading-relaxed">{desc}</p>
              {fullWidth && (
                <ul className="mt-3 space-y-1.5">
                  {features.map((feature) => (
                    <li key={feature} className="flex items-start gap-1.5 text-xs text-ink-secondary leading-relaxed">
                      <Check className="h-3 w-3 text-brand shrink-0 mt-0.5" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
