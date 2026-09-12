import { ArrowRight, CalendarDays, Hash, Route } from 'lucide-react'
import { RankBadge } from '@/components/ui'
import { RankProgressionRail } from '@/components/rank/RankProgressionRail'
import { ServiceTagPills } from '@/components/service/ServiceTagPills'
import { useBoosterServiceDetails } from '@/api/coaching'
import { sortOrderExtras } from '@/lib/utils'
import { getLaneDisplayItems } from '@/lib/lolTaxonomy'
import { CLASH_DAY_LABEL, CLASH_TIER_BOUNDARY_RANKS, getClashDateParts } from '@/lib/clashDomain'
import { rankStep } from '@/lib/pricing'
import type { Division, Order, RankTier } from '@/types'

interface OrderCardDetailsProps {
  order: Order
  viewerRole: 'customer' | 'booster' | 'admin'
}

// Bloco de detalhes reaproveitado por todo card-resumo de pedido (cliente,
// booster, jobs disponíveis): rank atual → objetivo (com histórico de drop se
// houver), vitórias restantes, dia/tier do Clash, Riot ID e extras. Fonte
// única pra esses campos ficarem sempre em sincronia visual entre os papéis.
export function OrderCardDetails({ order, viewerRole }: OrderCardDetailsProps) {
  const laneItems = getLaneDisplayItems(order, viewerRole)
  const currentRank = order.current_rank as { tier: RankTier; division: Division | null } | null
  const targetRank = order.target_rank as { tier: RankTier; division: Division | null } | null
  const hasWinProgress = order.wins_purchased != null
  // Mesmo pacote (descrição, rotas/campeões/especialidades, duração) exibido
  // na aba "Pegar" do booster (AvailableJobs.tsx) -- pra um pedido de
  // coaching ficar com a mesma cara bonitinha em toda lista de pedidos
  // (cliente, booster, admin), não só na hora de aceitar.
  const { data: coachPackage } = useBoosterServiceDetails(
    order.service_type === 'coaching' ? (order.booster_service_id ?? undefined) : undefined,
  )
  // Drop não muda o conteúdo do card -- só um badge "Dropado" ao lado do
  // código do pedido (ver CustomerOrderCard/CompletedOrderCard).
  const winsPct = hasWinProgress && order.wins_purchased
    ? Math.max(0, Math.min(100, (order.wins_played / order.wins_purchased) * 100))
    : 0

  // Progresso RELATIVO a este pedido (0% = rank em que começou, 100% = rank
  // alvo) -- mesma estimativa de EloBoostProgress (OrderProgress.tsx) a
  // partir de wins_played/losses_played e do PDL médio ganho/perdido, sem
  // custar um fetch extra de verificação por card. Sem isso, a trilha caía
  // no fallback de RankProgressionRail (posição absoluta na escada inteira),
  // que nasce com um preenchimento não-zero pra qualquer rank inicial acima
  // de Ferro e nunca se move -- parecia "começar com uma % e travar no meio".
  let eloFillPercentOverride: number | null = null
  if (currentRank && targetRank && !hasWinProgress) {
    const startStep = rankStep(currentRank.tier, currentRank.division)
    const targetStep = rankStep(targetRank.tier, targetRank.division)
    const span = targetStep - startStep
    if (span > 0) {
      const estimatedLp = order.wins_played * (order.avg_pdl_gain ?? 0) - order.losses_played * (order.avg_pdl_loss ?? 0)
      const currentStep = startStep + Math.max(0, estimatedLp) / 100
      eloFillPercentOverride = Math.max(0, Math.min(100, ((currentStep - startStep) / span) * 100))
    } else {
      eloFillPercentOverride = 0
    }
  }

  return (
    <>
      {/* Mutuamente exclusivos, mesma prioridade de OrderProgress.tsx:
          win_boost/MD5 preenche current_rank+target_rank também (o alvo
          Grão-Mestre/Challenger do master_plus), mas o progresso real é por
          vitórias -- sem o !hasWinProgress aqui, a trilha de elo e o bloco de
          vitórias renderizavam juntos (linha/barra/ícone duplicados). */}
      {currentRank && targetRank && !hasWinProgress && (
        <div className="mb-3">
          {/* RankJourney-lite -- mesma trilha de progressão da tela de
              detalhe (RankProgressionRail), sem live-verification (custaria
              1 fetch extra por card numa lista de até 12); a posição usa a
              mesma estimativa de wins/PDL de EloBoostProgress em vez da
              posição absoluta na escada. */}
          <RankProgressionRail
            currentTier={currentRank.tier}
            currentDivision={currentRank.division}
            targetTier={targetRank.tier}
            targetDivision={targetRank.division}
            size="compact"
            showBadgeLabels={false}
            fillPercentOverride={eloFillPercentOverride}
          />
        </div>
      )}

      {order.service_type === 'coaching' && (
        <div className="mb-3 space-y-2">
          {coachPackage?.description && (
            <p className="text-xs text-ink-secondary leading-relaxed line-clamp-2">{coachPackage.description}</p>
          )}
          {coachPackage && (
            <ServiceTagPills lanes={coachPackage.lanes} champions={coachPackage.champions} specialties={coachPackage.specialties} compact />
          )}
          {order.sessions_purchased != null && (
            <div className="flex items-center gap-1.5 text-xs text-ink-secondary">
              <CalendarDays className="h-3 w-3 shrink-0 text-ink-muted" />
              <span><span className="font-bold text-ink" data-tabular>{order.sessions_purchased}</span> sessão{order.sessions_purchased === 1 ? '' : 'ões'} de coaching</span>
            </div>
          )}
          {coachPackage?.tempo && (
            <p className="text-[10px] text-ink-muted">Duração por sessão: <span className="font-semibold text-ink">{coachPackage.tempo}</span></p>
          )}
        </div>
      )}

      {hasWinProgress && (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-1.5">
            {currentRank && <RankBadge tier={currentRank.tier} division={currentRank.division} size="xs" showLabel={false} />}
            <ArrowRight className="h-3.5 w-3.5 text-ink-muted shrink-0" />
            <span className="text-xs text-ink-secondary">
              <span className="font-bold text-ink" data-tabular>{order.wins_purchased}</span> vitória{order.wins_purchased === 1 ? '' : 's'} contratada{order.wins_purchased === 1 ? '' : 's'}
            </span>
          </div>
          {/* Barra de progresso preview -- mesma linguagem visual da trilha
              de rank acima, só que linear (não há "tier" numa compra de
              vitórias avulsas). */}
          <div className="h-1.5 w-full rounded-full bg-bg-interactive overflow-hidden">
            <div className="h-full rounded-full bg-gradient-brand" style={{ width: `${winsPct}%` }} />
          </div>
        </div>
      )}

      {order.service_type === 'clash' && order.clash_tier && (
        <div className="flex items-center gap-2 mb-3 text-xs text-ink-secondary">
          <RankBadge tier={CLASH_TIER_BOUNDARY_RANKS[order.clash_tier].high} division={null} size="xs" showLabel={false} />
          <ArrowRight className="h-3.5 w-3.5 text-ink-muted shrink-0" />
          {order.clash_day && (() => {
            const { day, month } = getClashDateParts(order.created_at, order.clash_day)
            return (
              <span className="font-medium text-ink" data-tabular>
                {day}/{month} · {CLASH_DAY_LABEL[order.clash_day]}
              </span>
            )
          })()}
        </div>
      )}

      {order.riot_id && (
        <div className="flex items-center gap-1.5 mb-3 text-xs text-ink-secondary">
          <Hash className="h-3 w-3 shrink-0 text-ink-muted" />
          <span>Riot ID: <span className="font-medium text-ink">{order.riot_id}</span></span>
        </div>
      )}

      {laneItems.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5 mb-3 text-xs text-ink-secondary">
          <Route className="h-3 w-3 shrink-0 text-ink-muted" />
          <span>{item.label}:</span>
          <ServiceTagPills lanes={item.lanes} compact emptyFallback="---" />
        </div>
      ))}

      {order.extras.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {sortOrderExtras(order.extras).map((extra) => (
            <span key={extra.extra_id} className="text-[10px] font-bold bg-bg-raised text-ink-secondary px-2 py-0.5 rounded-lg uppercase tracking-wide">
              {extra.name}
            </span>
          ))}
        </div>
      )}
    </>
  )
}
