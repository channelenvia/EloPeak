import { ArrowRight } from 'lucide-react'
import { Badge, RankBadge } from '@/components/ui'
import { OrderFact, OrderFacts } from './OrderFact'
import { RankProgressionRail } from '@/components/rank/RankProgressionRail'
import { ServiceTagPills } from '@/components/service/ServiceTagPills'
import { useBoosterServiceDetails } from '@/api/coaching'
import { formatRank, sortOrderExtras } from '@/lib/utils'
import { getLaneDisplayItems } from '@/lib/lolTaxonomy'
import { CLASH_DAY_LABEL, CLASH_TIER_BOUNDARY_RANKS, CLASH_TIER_LABEL, getClashDateParts } from '@/lib/clashDomain'
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

  const hasFacts = !!order.riot_id || laneItems.length > 0
    || (order.service_type === 'clash' && !!order.clash_day)
    || (order.service_type === 'coaching' && (order.sessions_purchased != null || !!coachPackage?.tempo))

  return (
    <div className="flex flex-col gap-4">
      {/* Mutuamente exclusivos, mesma prioridade de OrderProgress.tsx:
          win_boost/MD5 preenche current_rank+target_rank também (o alvo
          Grão-Mestre/Challenger do master_plus), mas o progresso real é por
          vitórias -- sem o !hasWinProgress aqui, a trilha de elo e o bloco de
          vitórias renderizavam juntos (linha/barra/ícone duplicados). */}
      {currentRank && targetRank && !hasWinProgress && (
        <div>
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
            centerLabel={
              <p className="flex flex-wrap items-center justify-center gap-x-1.5 text-sm font-semibold leading-tight text-ink" data-tabular>
                <span>{formatRank(currentRank.tier, currentRank.division)}</span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
                <span className="text-brand">{formatRank(targetRank.tier, targetRank.division)}</span>
              </p>
            }
          />
        </div>
      )}

      {order.service_type === 'coaching' && coachPackage && (
        <div className="space-y-2">
          {coachPackage.description && (
            <p className="text-sm text-ink-secondary leading-relaxed line-clamp-2">{coachPackage.description}</p>
          )}
          <ServiceTagPills lanes={coachPackage.lanes} champions={coachPackage.champions} specialties={coachPackage.specialties} compact />
        </div>
      )}

      {hasWinProgress && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            {currentRank && <RankBadge tier={currentRank.tier} division={currentRank.division} size="xs" showLabel={false} />}
            <span className="min-w-0 flex-1 text-center text-sm text-ink-secondary">
              <span className="font-bold text-ink" data-tabular>{order.wins_purchased}</span> vitória{order.wins_purchased === 1 ? '' : 's'} contratada{order.wins_purchased === 1 ? '' : 's'}
            </span>
            <span className="shrink-0 text-xs font-semibold text-ink-muted" data-tabular>{order.wins_played}/{order.wins_purchased}</span>
          </div>
          {/* Barra de progresso preview -- mesma linguagem visual da trilha
              de rank acima, só que linear (não há "tier" numa compra de
              vitórias avulsas). */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-interactive">
            <div className="h-full rounded-full bg-gradient-brand" style={{ width: `${winsPct}%` }} />
          </div>
        </div>
      )}

      {order.service_type === 'clash' && order.clash_tier && (
        <div className="flex items-center gap-3 text-sm text-ink-secondary">
          <RankBadge tier={CLASH_TIER_BOUNDARY_RANKS[order.clash_tier].high} division={null} size="xs" showLabel={false} />
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
          <span className="font-semibold text-ink">Clash {CLASH_TIER_LABEL[order.clash_tier]}</span>
        </div>
      )}

      {hasFacts && (
        <OrderFacts>
          {order.service_type === 'clash' && order.clash_day && (() => {
            const { day, month } = getClashDateParts(order.created_at, order.clash_day)
            return <OrderFact label="Data">{day}/{month} · {CLASH_DAY_LABEL[order.clash_day]}</OrderFact>
          })()}
          {order.service_type === 'coaching' && order.sessions_purchased != null && (
            <OrderFact label="Sessões">{order.sessions_purchased} {order.sessions_purchased === 1 ? 'sessão' : 'sessões'}</OrderFact>
          )}
          {order.service_type === 'coaching' && coachPackage?.tempo && (
            <OrderFact label="Duração">{coachPackage.tempo}</OrderFact>
          )}
          {order.riot_id && <OrderFact label="Riot ID" wide><span className="block truncate">{order.riot_id}</span></OrderFact>}
          {laneItems.map((item) => (
            <OrderFact key={item.label} label={item.label} wide>
              <ServiceTagPills lanes={item.lanes} allLabel={item.allLabel} compact emptyFallback="---" />
            </OrderFact>
          ))}
        </OrderFacts>
      )}

      {order.extras.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {sortOrderExtras(order.extras).map((extra) => (
            <Badge key={extra.extra_id} size="tag">{extra.name}</Badge>
          ))}
        </div>
      )}
    </div>
  )
}
