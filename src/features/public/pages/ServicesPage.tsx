import { Link } from 'react-router-dom'
import { TrendingUp, Zap, Users, Trophy, CheckCircle2, ChevronRight } from 'lucide-react'
import { Button, RankBadge } from '@/components/ui'
import { RANK_TIER_ORDER, RANK_TIER_LABEL, RANK_TIER_COLOR } from '@/lib/utils'
import type { RankTier } from '@/types'

const SERVICES = [
  {
    icon: TrendingUp,
    slug: 'elo_boost',
    title: 'Solo Boost / Duo Boost',
    tagline: 'Suba divisão por divisão até o rank desejado.',
    description:
      'Nossos boosters jogam na sua conta (Solo Boost) ou ao seu lado em duo queue (Duo Boost) e sobem do seu rank atual até o rank desejado. Você escolhe o tipo de fila, preferências de campeão e extras.',
    rankRange: ['iron', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond'] as RankTier[],
    highlights: [
      'Solo boost ou duo boost — você escolhe',
      'Qualquer rank — do Ferro ao Desafiante',
      'Seleção de mesma divisão (ex: Bronze IV → Bronze I)',
      'Proteção VPN + conta offline em cada partida',
      'Começa em até 30 minutos',
    ],
    color: 'text-brand',
    bgColor: 'bg-brand/10',
    cta: '/orders/new?service=elo_boost',
  },
  {
    icon: Zap,
    slug: 'win_boost',
    title: 'Vitórias',
    tagline: 'Compre um número fixo de vitórias rapidamente.',
    description:
      'Perfeito para ganhar LP rápido, completar missões ou subir antes de uma virada de temporada. Escolha quantas vitórias precisa e nossos boosters cuidam do resto.',
    rankRange: ['iron', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond'] as RankTier[],
    highlights: [
      'Escolha de 3 a 50 vitórias',
      'Solo queue ou flex',
      'Começa em até 30 minutos',
      'Melhor custo-benefício por LP ganho',
    ],
    color: 'text-accent',
    bgColor: 'bg-accent/10',
    cta: '/orders/new?service=win_boost',
  },
  {
    icon: Users,
    slug: 'coaching',
    title: 'Coaching',
    tagline: 'Aprenda com os melhores e melhore de verdade.',
    description:
      'Sessões 1-a-1 ao vivo com coaches de alto ELO. Revisão de VOD, coaching em jogo, fundamentos de campeão, estratégia macro e gestão mental — tudo coberto.',
    rankRange: ['iron', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond'] as RankTier[],
    highlights: [
      'Opções de sessão de 1h ou 2h',
      'Revisão de VOD inclusa',
      'Coach combinado com sua função principal',
      'Plano de melhoria personalizado',
    ],
    color: 'text-success',
    bgColor: 'bg-success/10',
    cta: '/orders/new?service=coaching',
  },
  {
    icon: Trophy,
    slug: 'placement_matches',
    title: 'MD5',
    tagline: 'Comece a temporada no rank que você merece.',
    description:
      'Nossos profissionais jogam suas 5 partidas de posicionamento para garantir que você comece a temporada no rank mais alto possível. Inclui otimização de MMR.',
    rankRange: ['iron', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond'] as RankTier[],
    highlights: [
      '5 partidas de placement completas',
      'Pré-boost de MMR disponível',
      'Especialistas em início de temporada',
      'Pool de campeões discutido com você',
    ],
    color: 'text-rank-grandmaster',
    bgColor: 'bg-rank-grandmaster/10',
    cta: '/orders/new?service=placement_matches',
  },
]

const EXTRAS = [
  { name: 'Apenas Solo',               desc: 'O booster joga exclusivamente em solo queue, sem duo com outros jogadores.' },
  { name: 'Processamento Prioritário', desc: 'Atribuição imediata ao booster mais bem avaliado. Seu pedido vai direto para frente da fila.' },
  { name: 'Campeão Único',             desc: 'Seu campeão favorito em cada partida. Especifique nas observações do pedido.' },
  { name: 'Transmissão ao Vivo',       desc: 'Assista seu booster jogar em tempo real via link de stream privado.' },
]

export function ServicesPage() {
  return (
    <div className="py-16">
      <div className="container-app space-y-20">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto">
          <p className="section-label mb-3">League of Legends</p>
          <h1 className="text-4xl font-extrabold text-ink mb-4">Todos os Serviços</h1>
          <p className="text-lg text-ink-secondary">
            Cada serviço usa boosters verificados, segurança total da conta e garantia de conclusão.
          </p>
        </div>

        {/* Services */}
        <div className="space-y-8">
          {SERVICES.map(({ icon: Icon, title, tagline, description, rankRange, highlights, color, bgColor, cta }) => (
            <div key={title} className="card p-8 flex flex-col md:flex-row gap-8">
              <div className="md:w-2/5 space-y-4">
                <div className={`h-12 w-12 rounded-2xl ${bgColor} flex items-center justify-center`}>
                  <Icon className={`h-6 w-6 ${color}`} />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-ink">{title}</h2>
                  <p className={`text-sm font-semibold mt-1 ${color}`}>{tagline}</p>
                </div>
                <p className="text-ink-secondary leading-relaxed">{description}</p>

                {/* Rank range badges */}
                <div>
                  <p className="text-[10px] font-bold text-ink-muted uppercase tracking-widest mb-2">Disponível para</p>
                  <div className="flex flex-wrap gap-2">
                    {rankRange.map(tier => (
                      <RankBadge key={tier} tier={tier} size="xs" showDivision={false} showLabel={false} />
                    ))}
                  </div>
                </div>

                <Button asChild>
                  <Link to={cta}>
                    Pedir {title} <ChevronRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
              <div className="md:w-3/5">
                <p className="section-label mb-3">O que está incluso</p>
                <ul className="space-y-2.5">
                  {highlights.map((h) => (
                    <li key={h} className="flex items-start gap-2.5">
                      <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />
                      <span className="text-sm text-ink-secondary">{h}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>

        {/* Premium extras */}
        <div>
          <div className="text-center mb-8">
            <p className="section-label mb-2">Upgrades</p>
            <h2 className="text-2xl font-bold text-ink">Extras Premium</h2>
            <p className="text-ink-secondary mt-2">Adicione a qualquer pedido durante o checkout.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {EXTRAS.map(({ name, desc }) => (
              <div key={name} className="card p-4 space-y-2">
                <p className="text-sm font-semibold text-ink">{name}</p>
                <p className="text-xs text-ink-secondary leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* All ranks visual */}
        <div className="card p-8 text-center">
          <p className="section-label mb-2">Cobertura completa</p>
          <h2 className="text-xl font-bold text-ink mb-6">Disponível em todos os ranks</h2>
          <div className="flex flex-wrap justify-center gap-3">
            {RANK_TIER_ORDER.map(tier => (
              <div key={tier} className="flex flex-col items-center gap-1">
                <RankBadge tier={tier} size="md" showDivision={false} showLabel={false} />
                <span className={`text-[10px] font-bold ${RANK_TIER_COLOR[tier]}`}>{RANK_TIER_LABEL[tier]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
