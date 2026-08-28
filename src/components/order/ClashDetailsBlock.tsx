// src/components/order/ClashDetailsBlock.tsx
// Bloco de detalhes do Clash, reaproveitado nas 4 telas que exibem um
// pedido de Clash (cliente/booster/admin OrderDetail + StepReview) -- as 4
// PRECISAM ficar idênticas, mesma regra de OrderRankRow. Segue o mesmo
// padrão do eloboost: lado "atual" (Tier), seta central, lado "alvo" (dia)
// no esquema de badge de vitórias-restantes. Campos fora do rank (modo,
// Riot ID, horário, total) ficam na OrderInfoGrid de cada tela.
import { CLASH_DAY_LABEL, CLASH_TIER_BOUNDARY_RANKS, CLASH_TIER_LABEL, getClashDateParts } from '@/lib/clashDomain'
import { RankBadge } from '@/components/ui/RankBadge'
import { OrderRankRow } from './OrderRankRow'
import type { BoostMode, ClashDay, ClashTier } from '@/types'

// Ícones do tier mínimo e máximo da faixa sobrepostos -- o máximo por cima,
// sobrescrevendo a borda do mínimo (ex.: Diamante atrás, Desafiante na
// frente, pro Tier 1) -- em vez de rank+divisão exato, que o Clash não tem
// (só a faixa). Mesmo truque visual que ClashConfigPicker já usa (tier
// detectado automaticamente), agora padronizado aqui em tamanho "lg" pra
// bater com o resto do OrderRankRow.
function ClashTierIcons({ clashTier }: { clashTier: ClashTier }) {
  const { low, high } = CLASH_TIER_BOUNDARY_RANKS[clashTier]
  return (
    <div className="flex items-center shrink-0">
      <RankBadge tier={low} size="lg" showLabel={false} />
      {high !== low && <RankBadge tier={high} size="lg" showLabel={false} className="-ml-8" />}
    </div>
  )
}

function ClashTierSlot({ clashTier }: { clashTier: ClashTier }) {
  return (
    <div className="flex items-center gap-3 min-w-0 shrink-0">
      <ClashTierIcons clashTier={clashTier} />
      <div className="min-w-0">
        <p className="text-[10px] text-ink-muted uppercase tracking-wide">Tier de Clash</p>
        <p className="text-base font-bold text-ink truncate">{CLASH_TIER_LABEL[clashTier]}</p>
      </div>
    </div>
  )
}

// Mesma estrutura do lado "Tier de Clash": badge (aqui, só a data) + rótulo
// e valor ao lado -- em vez de tudo empilhado dentro de uma única caixa,
// pra ficar simétrico com o outro lado da linha.
export function ClashDayBadge({ createdAt, clashDay }: { createdAt: string; clashDay: ClashDay | null }) {
  if (!clashDay) return null
  const { day, month } = getClashDateParts(createdAt, clashDay)
  return (
    <div className="flex items-center gap-3 min-w-0 shrink-0">
      <div className="flex items-center justify-center bg-bg-elevated border border-border-subtle shrink-0 w-20 h-20 rounded-2xl p-2">
        <span className="text-lg font-extrabold text-ink leading-none" data-tabular>{day}/{month}</span>
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-ink-muted uppercase tracking-wide">Dia do Clash</p>
        <p className="text-base font-bold text-ink truncate">{CLASH_DAY_LABEL[clashDay]}</p>
      </div>
    </div>
  )
}

export interface ClashDetailsBlockProps {
  viewerRole: 'customer' | 'booster' | 'admin'
  boostMode: BoostMode
  clashTier: ClashTier
  clashDay: ClashDay | null
  createdAt: string
}

export function ClashDetailsBlock({ viewerRole, boostMode, clashTier, clashDay, createdAt }: ClashDetailsBlockProps) {
  return (
    <div className="mb-4 pb-4 border-b border-border-subtle">
      <OrderRankRow
        currentSlot={<ClashTierSlot clashTier={clashTier} />}
        targetSlot={<ClashDayBadge createdAt={createdAt} clashDay={clashDay} />}
      />
      {viewerRole === 'booster' && (
        <p className="text-xs font-semibold text-brand text-center -mt-4">
          A montagem do time é sua responsabilidade — organize dentro do League of Legends.
          {boostMode === 'duo' && ' Use o Riot ID do cliente (abaixo) para convidá-lo para o time.'}
        </p>
      )}
    </div>
  )
}
