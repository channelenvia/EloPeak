import { useQuery } from '@tanstack/react-query'
import { listOrderRankVerifications } from '@/api/orders'
import { queryKeys } from '@/api/core/queryKeys'
import type { Order } from '@/types'

export function useLatestVerification(orderId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.orders.latestRankVerification(orderId),
    queryFn: async () => (await listOrderRankVerifications(orderId, 1))[0] ?? null,
    enabled,
  })
}

export interface EffectivePoints {
  points: number | null
  isEstimate: boolean
}

// Pontos "efetivos" do pedido: LP verificado de verdade (via Riot API, ver
// order_rank_verifications) quando existe; senão, estimado a partir das
// partidas já sincronizadas (wins_played/losses_played) x PDL médio
// ganho/perdido informado no pedido. Compartilhado entre OrderRankSummary
// (número de LP) e OrderProgress (barra) -- os dois precisam concordar,
// senão a barra anda mas o número ao lado dela fica parado.
export function computeEffectivePoints(
  order: Order,
  latest: { fetched_lp?: number | null } | null | undefined,
): EffectivePoints {
  // Antes do booster iniciar o pedido (match_sync_started_at null) ainda não
  // existe verificação nem partida sincronizada -- os ramos abaixo caem
  // naturalmente no PDL/LP capturado na compra (order.current_pdl /
  // order.current_rank.lp), que é exatamente o "PDL atual" que o cliente
  // quer ver sempre, mesmo com a barra de progresso ainda bloqueada.
  if (latest?.fetched_lp != null) return { points: latest.fetched_lp, isEstimate: false }

  if (order.pdl_bracket) {
    // Master+ não estima por PDL médio -- current_pdl vem de fonte própria
    // (corte ao vivo da liga), atualizado por outro caminho.
    return { points: order.current_pdl, isEstimate: false }
  }

  const startingLp = order.current_rank?.lp ?? null
  if (startingLp == null) return { points: null, isEstimate: false }

  const estimatedDelta = order.wins_played * (order.avg_pdl_gain ?? 0) - order.losses_played * (order.avg_pdl_loss ?? 0)
  if (estimatedDelta <= 0) return { points: startingLp, isEstimate: false }

  // Clampado 0-100 (LP dentro da divisão atual) -- a barra de progresso é
  // quem representa corretamente o avanço entre divisões (via rankStep); o
  // número aqui é só o LP estimado dentro da divisão em que o pedido começou.
  return { points: Math.max(0, Math.min(100, Math.round(startingLp + estimatedDelta))), isEstimate: true }
}
