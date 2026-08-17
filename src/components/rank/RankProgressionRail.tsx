import { rankStep } from '@/lib/pricing'
import { cn } from '@/lib/utils'
import type { Division, RankTier } from '@/types'
import { RankBadge } from '@/components/ui/RankBadge'

const MAX_STEP = 30 // Challenger — ver shared/pricing.ts::rankStep

export interface RankProgressionRailProps {
  currentTier: RankTier
  currentDivision: Division | null
  currentLp?: number | null
  targetTier?: RankTier | null
  targetDivision?: Division | null
  /** Corte ao vivo GM/Challenger (LP do último colocado), quando aplicável. */
  liveCutoffLp?: number | null
  size?: 'compact' | 'full'
  className?: string
  /** Pedido ainda não pago: os badges de rank continuam nítidos, só a barra
   * fica desfocada com um X -- não existe progresso real pra mostrar ainda. */
  locked?: boolean
  /** Pedido ainda sendo configurado (configurador, nem existe ainda) --
   * mostra só os badges de rank atual/alvo, sem barra nem corte ao vivo,
   * já que não há progresso real nenhum pra medir. */
  showBar?: boolean
  /** Oculta os badges quando o consumidor renderiza o mesmo resumo de ranks
   * em um bloco próprio logo abaixo da barra. */
  showBadges?: boolean
  /** Esconde o texto (tier/divisão) embaixo do emblema, deixando só o ícone
   * -- usado em contexto denso (cards de lista) onde o nome já aparece em
   * outro lugar do card. */
  showBadgeLabels?: boolean
  /** Preenchimento em % relativo ao PROGRESSO DESTE PEDIDO (0 = rank em que
   * o pedido começou, 100 = rank alvo), em vez da posição absoluta na
   * escada inteira (rankStep/MAX_STEP). Sem isso, um pedido que começa em
   * Platina já nasceria com a barra ~60% cheia mesmo sem nenhuma partida
   * jogada. Quando informado, o marcador de meta some (a barra inteira já
   * representa 0→alvo, um marcador no fim seria redundante). */
  fillPercentOverride?: number | null
}

// Componente-assinatura do produto: a "trilha de ascensão" -- usada no hero
// da home, no simulador de preço, no configurador de pedido, nos cards de
// pedido e no dashboard de pedido ativo. Nunca decorativa: a posição do
// preenchimento é sempre derivada do rank real (rankStep), nunca estética.
//
// No vocabulário da família de componentes de rank (RankIcon < RankLabel <
// RankCompact < RankBadge, em ui/RankBadge.tsx), este componente já É o que
// seria chamado de RankProgress/RankJourney -- badges atual/alvo + trilha +
// corte ao vivo. Não foi renomeado/duplicado: já tem um único consumidor
// (OrderProgress.tsx), nome descritivo e comportamento correto -- criar um
// "RankJourney" paralelo só geraria confusão sem ganho real.
export function RankProgressionRail({
  currentTier, currentDivision, currentLp, targetTier, targetDivision, liveCutoffLp,
  size = 'full', className, locked = false, showBar = true, showBadges = true, showBadgeLabels = true, fillPercentOverride = null,
}: RankProgressionRailProps) {
  const currentPct = fillPercentOverride != null
    ? Math.max(0, Math.min(100, fillPercentOverride))
    : Math.min(100, (rankStep(currentTier, currentDivision) / MAX_STEP) * 100)
  const targetPct = fillPercentOverride != null
    ? null
    : targetTier != null
    ? Math.min(100, (rankStep(targetTier, targetDivision ?? null) / MAX_STEP) * 100)
    : null

  const railHeight = size === 'compact' ? 'h-1.5' : 'h-2.5'
  const badgeSize = size === 'compact' ? 'xs' : 'md'

  return (
    <div className={cn('w-full', className)}>
      {showBadges && (
        <div className={cn('flex items-end', targetTier != null ? 'justify-between' : 'justify-start')}>
          <div className="flex flex-col items-center gap-1.5">
            <RankBadge tier={currentTier} division={currentDivision} size={badgeSize} showLabel={showBadgeLabels} />
            {currentLp != null && (
              <span className="text-xs font-semibold text-brand tabular-figures" data-tabular>
                {currentLp} PDL
              </span>
            )}
          </div>
          {targetTier != null && (
            <div className="flex flex-col items-center gap-1.5">
            <RankBadge tier={targetTier} division={targetDivision ?? null} size={badgeSize} showLabel={showBadgeLabels} />
            </div>
          )}
        </div>
      )}

      {showBar && (
        <>
          <div className="relative">
            <div
              className={cn(
                'relative w-full rounded-full bg-bg-interactive overflow-hidden',
                showBadges && 'mt-3',
                railHeight,
                locked && 'blur-[3px] opacity-60',
              )}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(currentPct)}
              aria-label={`Progresso de ${currentTier} até ${targetTier ?? 'o topo do ranqueado'}`}
            >
              {/* Trilha de fundo -- gradiente sutil que percorre todos os tiers,
                  sempre visível como referência do caminho inteiro. */}
              <div className="absolute inset-0 bg-gradient-rail opacity-20" />

              {/* Preenchimento até a posição atual -- verde (marca, progresso ao vivo). */}
              <div
                className="absolute inset-y-0 left-0 origin-left rounded-full bg-gradient-brand shadow-brand motion-safe:animate-rail-fill"
                style={{ width: `${currentPct}%` }}
              />

              {/* Marcador da meta -- dourado (acento, conquista). */}
              {targetPct != null && (
                <div
                  className="absolute inset-y-0 w-0.5 bg-accent shadow-accent"
                  style={{ left: `${targetPct}%` }}
                />
              )}
            </div>
          </div>

          {liveCutoffLp != null && (
            <p className="mt-2 text-xs text-ink-muted">
              Corte ao vivo: <span className="font-semibold text-ink-secondary tabular-figures" data-tabular>{liveCutoffLp} LP</span>
            </p>
          )}
        </>
      )}
    </div>
  )
}
