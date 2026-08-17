import { ChevronRight } from 'lucide-react'
import { RankBadge } from '@/components/ui/RankBadge'
import { cn, formatRank } from '@/lib/utils'
import type { Division, RankTier } from '@/types'

export interface OrderRankRowProps {
  currentTier?: RankTier
  currentDivision?: Division | null
  targetTier?: RankTier | null
  targetDivision?: Division | null
  /** Coluna central entre os dois badges (pontos atuais, status "Aguardando
   * início"/"Sincronizando…" etc.) -- cada consumidor decide o conteúdo, o
   * layout (linha + seta) é sempre o mesmo. */
  centerContent?: React.ReactNode
  /** MD5 usa "rank da última temporada" em vez de "Rank Atual" -- mesmo
   * badge, rótulo diferente (a conta está em colocação, sem rank atual de
   * verdade nesta fila). Ignorado quando currentSlot é usado. */
  currentLabel?: string
  /** Substitui o lado esquerdo (badge + rótulo) por um conteúdo customizado
   * -- Clash não tem rank+divisão exato, só uma faixa de tiers, então o
   * "rank atual" vira os ícones do tier mínimo/máximo sobrepostos (ver
   * ClashDetailsBlock) em vez de um RankBadge único. */
  currentSlot?: React.ReactNode
  /** Substitui o badge de rank alvo (seta + bloco à direita) por um
   * conteúdo customizado -- win_boost/md5 não tem rank alvo de verdade, mas
   * o badge de "vitórias restantes" ocupa exatamente essa posição/estrutura
   * (como se fosse o rank alvo de um elo_boost), não fica solto perto do
   * ícone de rank atual. */
  targetSlot?: React.ReactNode
}

// Linha "rank atual ↔ pontos ↔ rank alvo" -- markup puro, sem buscar dado
// nenhum. Extraído de OrderRankSummary (pedido já existe, busca
// verificação/estimativa real) pra ser reaproveitado também pelo resumo do
// order-builder (StepReview, pedido ainda nem existe -- só o que o cliente
// configurou). Os dois PRECISAM ficar visualmente idênticos: o cliente vê o
// resumo antes de pagar e depois na página do pedido em andamento, então
// qualquer diferença de layout ali soa como "mudou o pedido".
export function OrderRankRow({ currentTier, currentDivision = null, currentSlot, targetTier, targetDivision, centerContent, currentLabel = 'Rank Atual', targetSlot }: OrderRankRowProps) {
  const hasTarget = !!targetTier
  const showTargetArea = hasTarget || !!targetSlot

  return (
    <div className="mb-8 flex justify-center">
      <div className={cn('flex items-center', showTargetArea ? 'gap-6 sm:gap-10' : 'gap-3')}>
        {currentSlot ?? (
          <div className="flex items-center gap-3 min-w-0 shrink-0">
            <RankBadge tier={currentTier!} division={currentDivision} size="lg" showLabel={false} />
            <div className="min-w-0">
              <p className="text-[10px] text-ink-muted uppercase tracking-wide">{currentLabel}</p>
              <p className="text-base font-bold text-ink truncate">{formatRank(currentTier!, currentDivision)}</p>
            </div>
          </div>
        )}

        {showTargetArea && (
          <>
            {/* Coluna central: conteúdo do consumidor empilhado sobre a
                seta -- largura fixa (não flex-1) pra não espalhar os ranks
                até as bordas de um card largo; eles ficam ancorados perto
                do meio da seção, separados só por essa coluna. */}
            <div className="w-24 sm:w-28 shrink-0 flex flex-col items-center gap-1.5">
              {centerContent}
              <div className="w-full flex items-center gap-1.5 text-border-subtle">
                <span className="h-px flex-1 bg-border-subtle" />
                <ChevronRight className="h-4 w-4 shrink-0 text-ink-muted" />
              </div>
            </div>

            {hasTarget ? (
              <div className="flex items-center gap-2.5 min-w-0 shrink-0">
                <RankBadge tier={targetTier!} division={targetDivision ?? null} size="lg" showLabel={false} />
                <div className="min-w-0">
                  <p className="text-[10px] text-ink-muted uppercase tracking-wide">Rank Alvo</p>
                  <p className="text-base font-bold text-ink truncate">{formatRank(targetTier!, targetDivision ?? null)}</p>
                </div>
              </div>
            ) : (
              <div className="shrink-0">{targetSlot}</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
