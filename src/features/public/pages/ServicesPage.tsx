import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { TrendingUp, Zap, Users, Swords, CheckCircle2 } from 'lucide-react'
import { RankBadge } from '@/components/ui'
import { RANK_TIER_ORDER, RANK_TIER_LABEL, RANK_TIER_COLOR } from '@/lib/utils'

const SERVICES = [
  {
    icon: TrendingUp,
    slug: 'elo_boost',
    title: 'Solo Boost / Duo Boost',
    tagline: 'Suba divisão por divisão até o rank desejado.',
    description:
      'Nossos boosters jogam na sua conta (Solo Boost) ou ao seu lado em duo queue (Duo Boost) e sobem do seu rank atual até o rank desejado. Você escolhe o tipo de fila, preferências de campeão e extras.',
    rankRange: RANK_TIER_ORDER,
    highlights: [
      'Solo boost ou duo boost — você escolhe',
      'Qualquer rank — do Ferro ao Grão-Mestre',
      'Seleção de mesma divisão (ex: Bronze IV → Bronze I)',
      'Proteção VPN + conta offline em cada partida',
      'Começa em até 30 minutos',
    ],
    color: 'text-success',
    bgColor: 'bg-brand/10',
    cta: '/orders/new?service=elo_boost',
  },
  {
    icon: Zap,
    slug: 'win_boost',
    title: 'Vitórias / MD5',
    tagline: 'Compre vitórias avulsas ou ative a garantia MD5.',
    description:
      'Perfeito para ganhar LP rápido, completar missões ou subir antes de uma virada de temporada. Escolha quantas vitórias precisa — e se ainda não jogou o posicionamento, ative a garantia MD5 automaticamente no mesmo fluxo.',
    rankRange: RANK_TIER_ORDER,
    highlights: [
      'Escolha entre 1 a 5 vitórias',
      'Garantia MD5 automática para quem ainda não fez o posicionamento',
      'Solo queue ou flex',
      'Começa em até 30 minutos',
    ],
    color: 'text-success',
    bgColor: 'bg-accent/10',
    cta: '/orders/new?service=win_boost',
  },
  {
    icon: Swords,
    slug: 'clash',
    title: 'Clash',
    tagline: 'Solo Clash ou Duo Clash, sempre no fim de semana.',
    description:
      'Participe do torneio Clash com um booster no seu time (Solo Clash, jogando na sua conta) ou ao seu lado (Duo Clash). Preço fixo por tier, agendado sempre para sábado ou domingo — o booster monta o restante do time dentro do jogo.',
    rankRange: RANK_TIER_ORDER,
    highlights: [
      'Solo Clash ou Duo Clash — você escolhe',
      '4 tiers fixos, do Ferro ao Desafiante',
      'Agendado sempre para sábado ou domingo',
      'Booster monta o time necessário dentro do jogo',
      'Preço fixo, sem surpresa na hora de pagar',
    ],
    color: 'text-success',
    bgColor: 'bg-warning/10',
    cta: '/orders/new?service=clash',
  },
  {
    icon: Users,
    slug: 'coaching',
    title: 'Coaching',
    tagline: 'Aprenda com os melhores e melhore de verdade.',
    description:
      'Sessões 1-a-1 ao vivo com coaches de alto ELO. Revisão de VOD, coaching em jogo, fundamentos de campeão, estratégia macro e gestão mental — tudo coberto.',
    rankRange: RANK_TIER_ORDER,
    highlights: [
      'Opções de sessão de horário predefinido',
      'Aula estruturada para evolução do jogador',
      'Coach combinado com sua função principal',
      'Aula com foco em otimização da performance',
      'Plano de melhoria personalizado',
    ],
    color: 'text-success',
    bgColor: 'bg-success/10',
    cta: '/orders/new?service=coaching',
  },
]

export function ServicesPage() {
  const { hash } = useLocation()

  // Deep-link do footer (ex: /services#elo-boost) — sem isso a navegação
  // troca a URL mas fica no topo da página, já que essa rota não usa scroll
  // automático de hash como o botão "Serviços" da home usa.
  useEffect(() => {
    if (!hash) return
    const frame = requestAnimationFrame(() => {
      document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => cancelAnimationFrame(frame)
  }, [hash])

  return (
    <div className="py-16">
      <div className="container-wide space-y-20">
        {/* Header */}
        <div className="text-center max-w-2xl xl:max-w-none mx-auto">
          <p className="section-label mb-3">League of Legends</p>
          <h1 className="text-4xl font-extrabold text-ink mb-4">Todos os Serviços</h1>
          <p className="text-lg text-ink-secondary xl:whitespace-nowrap">
            Cada serviço usa boosters verificados, segurança total da conta e garantia de conclusão.
          </p>
        </div>

        {/* Services */}
        <div className="space-y-8">
          {SERVICES.map(({ icon: Icon, slug, title, tagline, description, rankRange, highlights, color, bgColor }) => (
            <div key={title} id={slug.replace(/_/g, '-')} className="card p-8 flex flex-col md:flex-row md:items-center gap-12 xl:gap-16 scroll-mt-24">
              <div className="md:w-2/5 space-y-4">
                <div className={`h-12 w-12 rounded-2xl ${bgColor} flex items-center justify-center`}>
                  <Icon className={`h-6 w-6 ${color}`} />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-ink">{title}</h2>
                  <p className={`text-sm font-semibold mt-1 ${color}`}>{tagline}</p>
                </div>
                <p className="text-ink-secondary leading-relaxed">{description}</p>
              </div>
              <div className="md:w-3/5 md:ml-auto space-y-6">
                {/* Rank range badges */}
                <div>
                  <p className="text-[10px] font-bold text-ink-muted uppercase tracking-widest mb-2">Disponível para</p>
                  <div className="flex flex-wrap gap-2">
                    {rankRange.map(tier => (
                      <RankBadge key={tier} tier={tier} size="xs" showDivision={false} showLabel={false} />
                    ))}
                  </div>
                </div>

                <div>
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
            </div>
          ))}
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
