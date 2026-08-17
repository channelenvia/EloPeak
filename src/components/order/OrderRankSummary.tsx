import { OrderRankRow } from './OrderRankRow'
import { useLatestVerification, computeEffectivePoints } from './useOrderRankProgress'
import type { Order } from '@/types'

// Badge cinza do mesmo tamanho do ícone de rank (RankBadge lg sem label) --
// ocupa a posição de "rank alvo" (ver targetSlot em OrderRankRow): número
// grande sozinho dentro do badge (equivalente ao ícone do tier, sem label
// próprio -- o total de vitórias contratadas já não aparece mais como item
// separado no grid de informações, só aqui) e o label fora, ao lado, no
// mesmo esquema de "Rank Alvo" (label pequeno em cima, valor em negrito
// embaixo). Exportado (não só local) porque StepReview precisa do mesmo
// badge antes do pedido existir (0 partidas jogadas, restante = comprado),
// onde este componente não pode ser usado direto (ele depende de
// wins_played de um pedido real).
export function WinsRemainingBadge({ purchased, remaining }: { purchased: number; remaining: number }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0 shrink-0">
      <div className="flex items-center justify-center bg-bg-elevated border border-border-subtle shrink-0 w-20 h-20 rounded-2xl p-2.5">
        <span className="text-2xl font-extrabold text-ink-muted leading-none" data-tabular>{purchased}</span>
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-ink-muted uppercase tracking-wide">Vitórias Contratadas</p>
        <p className="text-base font-bold text-ink truncate">{remaining} {remaining === 1 ? 'vitória restante' : 'vitórias restantes'}</p>
      </div>
    </div>
  )
}

// Resumo "rank atual ↔ pontos ↔ rank alvo" numa única linha -- os pontos
// (PDL pro fluxo Master+, LP pro fluxo padrão) ficam sempre centralizados
// entre os dois badges, nunca embaixo/solto em outra célula. Extraído do
// que já existia só no OrderDetail.tsx do cliente -- agora compartilhado
// com o JobDetail.tsx do booster, que antes tinha um layout próprio (pior)
// com badges e PDL espalhados em células de grid separadas.
export function OrderRankSummary({ order }: { order: Order }) {
  const currentRank = order.current_rank
  const targetRank = order.target_rank
  const progressLocked = !order.match_sync_started_at
  // Mesmo cálculo usado pela barra (OrderProgress/useOrderRankProgress) --
  // verificação real quando existe, senão estimado por partidas
  // sincronizadas x PDL médio do pedido. Sem isso, a barra andava mas o
  // número de LP ao lado ficava parado no valor inicial do pedido.
  // Chamado incondicionalmente (regra dos hooks) mesmo antes do early
  // return abaixo -- enabled cobre o caso de currentRank ainda não existir.
  const { data: latest } = useLatestVerification(order.id, !!currentRank && !progressLocked)
  if (!currentRank) return null

  const { points: currentPoints, isEstimate } = computeEffectivePoints(order, latest)
  const pointsLabel = order.pdl_bracket ? 'PDL' : 'LP'

  const hasTarget = order.service_type === 'elo_boost' && !!targetRank

  // win_boost/md5 "compram N vitórias" -- não tem rank alvo nem faixa de
  // LP/PDL, o que importa é quantas ainda faltam. wins_played já vem ao vivo
  // do sync-order-matches (mesmo fetch que atualiza o histórico de
  // partidas), então isso regride sozinho a cada sincronização, sem
  // precisar de nenhum estado extra aqui.
  const isWinsBased = order.service_type === 'win_boost' || order.service_type === 'md5'
  const winsRemaining = isWinsBased && order.wins_purchased != null
    ? Math.max(0, order.wins_purchased - order.wins_played)
    : null

  // Badge cinza do mesmo tamanho do ícone de rank (RankBadge lg sem label) --
  // ocupa a posição de "rank alvo" (ver targetSlot em OrderRankRow), com o
  // número grande no lugar do ícone e "vitórias restantes" embaixo, no lugar
  // do nome do tier -- como se fosse o rank alvo de um elo_boost.
  const winsTargetSlot = isWinsBased && winsRemaining != null
    ? <WinsRemainingBadge purchased={order.wins_purchased ?? 0} remaining={winsRemaining} />
    : null

  const centerContent = isWinsBased ? null : order.status === 'completed' ? (
    <span className="text-sm font-bold text-success whitespace-nowrap">Rank alvo atingido!</span>
  ) : currentPoints != null ? (
    <span className="text-sm font-bold text-brand whitespace-nowrap" data-tabular title={isEstimate ? 'Estimativa com base nas partidas sincronizadas' : undefined}>
      {isEstimate ? '~' : ''}{currentPoints} {pointsLabel}
    </span>
  ) : progressLocked ? (
    <span className="text-[11px] font-medium text-ink-muted whitespace-nowrap">Aguardando início</span>
  ) : (
    <span className="text-[11px] font-medium text-ink-muted whitespace-nowrap">Sincronizando…</span>
  )

  return (
    <OrderRankRow
      currentTier={currentRank.tier}
      currentDivision={currentRank.division}
      targetTier={hasTarget ? targetRank!.tier : null}
      targetDivision={hasTarget ? targetRank!.division : null}
      centerContent={centerContent}
      targetSlot={winsTargetSlot}
      currentLabel={order.service_type === 'md5' ? 'Rank na Temporada Passada' : 'Rank Atual'}
    />
  )
}
