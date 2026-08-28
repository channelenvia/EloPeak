import { useQuery } from '@tanstack/react-query'
import { RankProgressionRail } from '@/components/rank/RankProgressionRail'
import { useLatestVerification, computeEffectivePoints } from './useOrderRankProgress'
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction'
import { cn } from '@/lib/utils'
import { rankStep } from '@/lib/pricing'
import type { Order, OrderStatus, RankTier, Division } from '@/types'

// "Travado" (progresso ainda não começou a contar) é decidido pelo STATUS do
// pedido, não pela presença de match_sync_started_at -- esse campo pode ficar
// null mesmo num pedido concluído (ex.: admin força status='completed'
// direto, sem passar pelo fluxo normal do booster), e nesse caso a barra
// continua devendo aparecer com o progresso real, nunca voltando a mostrar
// "o progresso ainda não começou". Uma vez iniciado (ou concluído), a barra
// fica visível pra sempre.
const PROGRESS_STARTED_STATUSES: OrderStatus[] = ['in_progress', 'paused', 'awaiting_customer', 'completed', 'disputed']
function isProgressLocked(order: Order): boolean {
  return !PROGRESS_STARTED_STATUSES.includes(order.status)
}

function ProgressBar({ percent, tone = 'brand', locked = false }: { percent: number; tone?: 'brand' | 'success'; locked?: boolean }) {
  const clamped = Math.max(0, Math.min(100, percent))
  return (
    <div className="relative">
      <div className={cn('h-2 w-full rounded-full bg-bg-elevated overflow-hidden', locked && 'blur-[3px] opacity-60')}>
        <div
          className={`h-full rounded-full transition-all ${tone === 'success' ? 'bg-success' : 'bg-brand'}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  )
}

function WinBoostProgress({ order }: { order: Order }) {
  const locked = isProgressLocked(order)
  const purchased = order.wins_purchased ?? 0
  // win_boost: garantia de saldo líquido -- toda derrota é compensada com
  // uma vitória extra, então o progresso real é (vitórias - derrotas), não
  // vitórias cruas (ver orderCompletionGate.ts, mesmo cálculo usado pra
  // liberar "Finalizar pedido"). md5 é garantia de win rate (80%+), cálculo
  // diferente -- continua olhando só vitórias cruas.
  const netWins = order.service_type === 'win_boost'
    ? order.wins_played - order.losses_played
    : order.wins_played
  const completed = Math.min(Math.max(0, netWins), purchased)
  const remaining = Math.max(0, purchased - netWins)
  const percent = purchased > 0 ? (completed / purchased) * 100 : 0
  const done = remaining === 0
  const compensating = order.service_type === 'win_boost' && order.losses_played > 0 && !done

  return (
    <div className="mb-4 pb-4 border-b border-border-subtle">
      {!locked && (
        <div className="flex items-center justify-end mb-2">
          <span className="font-semibold text-ink text-sm" data-tabular>{percent.toFixed(0)}%</span>
        </div>
      )}
      <ProgressBar percent={locked ? 0 : percent} tone={done ? 'success' : 'brand'} locked={locked} />
      <p className="text-xs text-ink-muted mt-2">
        {locked
          ? 'O progresso começa a contar assim que o booster iniciar o pedido.'
          : done
            ? 'Objetivo de vitórias atingido!'
            : compensating
              ? `Progresso atualizado pelas partidas sincronizadas -- ${order.losses_played} derrota(s) sendo compensada(s) com vitórias extras.`
              : 'Progresso atualizado pelas partidas sincronizadas.'}
      </p>
    </div>
  )
}

// Corte atual (PDL do último colocado) das ligas GM/Challenger na Riot --
// mesma fonte cacheada (riot_league_cutoffs) e mesmo padrão de busca de
// StepConfigure.tsx, aqui usado pra manter a trilha de progresso do pedido
// em andamento com o corte ao vivo, não só o alvo fixo mostrado na hora da
// compra.
function useLiveCutoff(queueType: Order['queue_type'], targetTier: RankTier | null, enabled: boolean) {
  const isMasterPlusTarget = targetTier === 'grandmaster' || targetTier === 'challenger'
  const { data } = useQuery({
    queryKey: ['riot-league-cutoffs', queueType],
    queryFn: () => invokeEdgeFunction<{ grandmaster_cutoff: number | null; challenger_cutoff: number | null }>('riot-league-cutoffs', {
      body: { queue: queueType },
      requireAuth: true,
    }),
    enabled: enabled && isMasterPlusTarget,
    staleTime: 5 * 60 * 1000,
  })
  if (!isMasterPlusTarget || !data) return null
  return targetTier === 'challenger' ? data.challenger_cutoff : data.grandmaster_cutoff
}

function EloBoostProgress({ order, hideRankBadges = false }: { order: Order; hideRankBadges?: boolean }) {
  const locked = isProgressLocked(order)
  const { data: latest } = useLatestVerification(order.id, !locked)

  const initial = order.current_rank as { tier: RankTier; division: Division | null } | null
  const target = order.target_rank as { tier: RankTier; division: Division | null } | null
  const liveCutoffLp = useLiveCutoff(order.queue_type, target?.tier ?? null, !locked)
  if (!initial || !target) return null

  const current = latest?.fetched_tier
    ? { tier: latest.fetched_tier, division: latest.fetched_division }
    : initial

  // Progresso RELATIVO a este pedido (0% = rank em que ele começou, 100% =
  // rank alvo) -- nunca a posição absoluta na escada inteira. Sem isso, um
  // pedido que já começa em Platina nasceria com a barra ~60% cheia mesmo
  // sem nenhuma partida jogada ainda.
  const startStep = rankStep(initial.tier, initial.division)
  const targetStep = rankStep(target.tier, target.division)
  const span = targetStep - startStep

  // Sem verificação real ainda (só acontece na tentativa de conclusão), a
  // barra ficava travada em 0% a partida inteira -- rank_verifications só
  // existe perto do fim. Enquanto isso, estima o progresso a partir das
  // partidas já sincronizadas (wins_played/losses_played) e do PDL médio
  // ganho/perdido informado no pedido -- mesma estimativa já usada no
  // histórico de partidas (OrderMatchHistory pdlEstimate), só que acumulada
  // aqui pra mover a barra a cada sincronização em vez de só no final. Cada
  // rankStep equivale a uma divisão inteira (ver shared/pricing.ts), por
  // isso *100 abaixo -- mesma régua usada pelo restante do produto pra LP.
  let currentStep: number
  let usedEstimate = false
  if (latest?.fetched_tier) {
    currentStep = rankStep(current.tier, current.division)
  } else if (span > 0) {
    const estimatedLp = order.wins_played * (order.avg_pdl_gain ?? 0) - order.losses_played * (order.avg_pdl_loss ?? 0)
    currentStep = startStep + Math.max(0, estimatedLp) / 100
    usedEstimate = estimatedLp > 0
  } else {
    currentStep = startStep
  }
  const relativePct = locked || span <= 0 ? 0 : Math.max(0, Math.min(100, ((currentStep - startStep) / span) * 100))
  // PDL/LP atual mostrado sempre, mesmo com a barra ainda bloqueada -- cai no
  // valor capturado na compra (current_pdl / current_rank.lp) enquanto não
  // há verificação nem partida sincronizada. Só a barra em si (locked prop
  // abaixo) continua desfocada até o booster iniciar o pedido.
  const { points: currentPoints } = computeEffectivePoints(order, latest)

  return (
    <div className="mb-4 pb-4 border-b border-border-subtle">
      <RankProgressionRail
        currentTier={current.tier}
        currentDivision={current.division}
        currentLp={currentPoints}
        targetTier={target.tier}
        targetDivision={target.division}
        liveCutoffLp={locked ? null : liveCutoffLp}
        locked={locked}
        showBadges={!hideRankBadges}
        fillPercentOverride={relativePct}
      />
      <p className="text-xs text-ink-muted mt-3">
        {locked
          ? 'O progresso começa a contar assim que o booster iniciar o pedido.'
          : latest?.fetched_tier
          ? 'Verificado automaticamente via Riot API na última tentativa de conclusão.'
          : usedEstimate
          ? 'Progresso estimado com base nas partidas sincronizadas — a Riot não expõe o LP ganho por partida.'
          : 'Ainda sem partidas sincronizadas para este pedido.'}
      </p>
    </div>
  )
}

// Renderiza inline dentro do card de "Detalhes do Pedido" de cada papel
// (booster/cliente/admin) -- progresso e detalhes viram uma única badge só,
// não dois cards separados. Retorna null quando o tipo de serviço não tem
// barra de progresso aplicável (ex.: coaching). Master+ (pdl_bracket
// preenchido) também tem progresso -- a trilha mostra o corte ao vivo em vez
// de um rank alvo fixo, então não é mais excluído aqui.
export function OrderProgress({ order, hideRankBadges = false }: { order: Order; hideRankBadges?: boolean }) {
  if (order.wins_purchased != null) return <WinBoostProgress order={order} />
  if (order.target_rank && order.current_rank) return <EloBoostProgress order={order} hideRankBadges={hideRankBadges} />
  return null
}
