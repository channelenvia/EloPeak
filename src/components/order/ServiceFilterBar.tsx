import { useRef, useState } from 'react'
import { Briefcase, SlidersHorizontal, Swords, TrendingUp, Users, Zap } from 'lucide-react'
import { Popover } from '@/components/ui'
import { CLASH_TIERS, CLASH_DAYS, type ServiceCategory } from './useServiceFilters'
import { CLASH_TIER_LABEL, CLASH_DAY_LABEL } from '@/lib/clashDomain'
import type { BoostMode, ClashDay, ClashTier, QueueType } from '@/types'

const SERVICE_CATEGORIES: { value: ServiceCategory; label: string; icon: React.ElementType }[] = [
  { value: 'all', label: 'Todos', icon: Briefcase },
  { value: 'elo_boost', label: 'Elo Boost', icon: TrendingUp },
  { value: 'win_boost', label: 'Wins', icon: Zap },
  { value: 'clash', label: 'Clash', icon: Swords },
  { value: 'coaching', label: 'Coaching', icon: Users },
]

const PILL = 'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors'
const pillCls = (active: boolean) => `${PILL} ${active ? 'bg-brand text-white' : 'text-ink-secondary hover:text-ink'}`

interface ServiceFilterBarProps {
  category: ServiceCategory
  onCategoryChange: (c: ServiceCategory) => void
  counts: Record<ServiceCategory, number>
  queue: QueueType | 'all'
  onQueueChange: (q: QueueType | 'all') => void
  mode: BoostMode | 'all'
  onModeChange: (m: BoostMode | 'all') => void
  clashTier: ClashTier | 'all'
  onClashTierChange: (t: ClashTier | 'all') => void
  clashDay: ClashDay | 'all'
  onClashDayChange: (d: ClashDay | 'all') => void
}

function FilterGroup({ label, children, nowrap }: { label: string; children: React.ReactNode; nowrap?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted mb-1.5">{label}</p>
      <div className={`flex gap-1 bg-bg-elevated rounded-lg p-1 ${nowrap ? 'flex-nowrap' : 'flex-wrap'}`}>{children}</div>
    </div>
  )
}

// Categoria de serviço fica sempre visível (pill normal, mesma linha da
// busca/status). Fila/modo (Elo/Vitórias) e tier+dia (Clash) só existem
// quando a categoria escolhida tem esses subtipos -- ficam dentro de um
// widget "Subfiltros" que expande num popover ao clicar, mesmo padrão dos
// widgets de "Conta do pedido"/"Histórico do Pedido" na página de detalhe,
// em vez de mais uma linha de pills sempre visível.
export function ServiceFilterBar({
  category, onCategoryChange, counts, queue, onQueueChange, mode, onModeChange, clashTier, onClashTierChange, clashDay, onClashDayChange,
}: ServiceFilterBarProps) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const hasQueueMode = category === 'elo_boost' || category === 'win_boost'
  const hasClash = category === 'clash'
  const activeCount = (queue !== 'all' ? 1 : 0) + (mode !== 'all' ? 1 : 0) + (clashTier !== 'all' ? 1 : 0) + (clashDay !== 'all' ? 1 : 0)

  return (
    // Um wrapper só -- sem isso, os dois filhos (pills de categoria +
    // widget de Subfiltros) contam como 2 itens separados no flex do pai
    // (justify-between), e o item do meio (categoria) pula pro centro assim
    // que o Subfiltros aparece. Com o wrapper, ServiceFilterBar sempre conta
    // como 1 item só, ancorado por inteiro à direita.
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex gap-1 bg-bg-surface/80 backdrop-blur-sm border border-border-subtle rounded-xl p-1 flex-wrap">
        {SERVICE_CATEGORIES.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            onClick={() => onCategoryChange(value)}
            className={`flex items-center gap-1.5 ${pillCls(category === value)}`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            <span className={`text-[10px] ${category === value ? 'text-white/80' : 'text-ink-muted'}`}>
              {counts[value]}
            </span>
          </button>
        ))}
      </div>

      {(hasQueueMode || hasClash) && (
        <div className="bg-bg-surface/80 backdrop-blur-sm border border-border-subtle rounded-xl p-1 w-fit">
          <button
            ref={anchorRef}
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={`flex items-center gap-1.5 ${pillCls(open || activeCount > 0)}`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Subfiltros
            {activeCount > 0 && (
              <span className={`text-[10px] ${open || activeCount > 0 ? 'text-white/80' : 'text-ink-muted'}`}>
                {activeCount}
              </span>
            )}
          </button>

          <Popover
            open={open}
            onClose={() => setOpen(false)}
            anchorRef={anchorRef}
            align="start"
            className={`${hasClash ? 'w-[min(92vw,350px)]' : 'w-[min(90vw,320px)]'} p-4 space-y-3`}
          >
            {hasQueueMode && (
              <>
                <FilterGroup label="Fila">
                  {([
                    { label: 'Todas', value: 'all' as const },
                    { label: 'Solo/Duo', value: 'solo_duo' as const },
                    { label: 'Flex', value: 'flex' as const },
                  ]).map(({ label, value }) => (
                    <button key={value} onClick={() => onQueueChange(value)} className={pillCls(queue === value)}>{label}</button>
                  ))}
                </FilterGroup>
                <FilterGroup label="Modo">
                  {([
                    { label: 'Todos', value: 'all' as const },
                    { label: 'Solo', value: 'solo' as const },
                    { label: 'Duo', value: 'duo' as const },
                  ]).map(({ label, value }) => (
                    <button key={value} onClick={() => onModeChange(value)} className={pillCls(mode === value)}>{label}</button>
                  ))}
                </FilterGroup>
              </>
            )}

            {hasClash && (
              <>
                <FilterGroup label="Tier" nowrap>
                  <button onClick={() => onClashTierChange('all')} className={pillCls(clashTier === 'all')}>Todos</button>
                  {CLASH_TIERS.map((tier) => (
                    <button key={tier} onClick={() => onClashTierChange(tier)} className={pillCls(clashTier === tier)}>{CLASH_TIER_LABEL[tier]}</button>
                  ))}
                </FilterGroup>
                <FilterGroup label="Dia">
                  <button onClick={() => onClashDayChange('all')} className={pillCls(clashDay === 'all')}>Todos</button>
                  {CLASH_DAYS.map((day) => (
                    <button key={day} onClick={() => onClashDayChange(day)} className={pillCls(clashDay === day)}>{CLASH_DAY_LABEL[day]}</button>
                  ))}
                </FilterGroup>
              </>
            )}
          </Popover>
        </div>
      )}
    </div>
  )
}
