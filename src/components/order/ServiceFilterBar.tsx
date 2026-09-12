import { useRef, useState } from 'react'
import { Briefcase, ChevronDown, SlidersHorizontal, Swords, TrendingUp, Users, Zap } from 'lucide-react'
import { FilterTabs, Popover } from '@/components/ui'
import { CLASH_TIERS, CLASH_DAYS, type ServiceCategory } from './useServiceFilters'
import { CLASH_TIER_LABEL, CLASH_DAY_LABEL } from '@/lib/clashDomain'
import { cn } from '@/lib/utils'
import { FILTER_CHEVRON_CLASS, filterOptionRowClass, filterTriggerClass } from './filterDropdownStyles'
import type { BoostMode, ClashDay, ClashTier, QueueType } from '@/types'

// Elo Boost como principal (primeira opção, mesmo padrão de "Em andamento"
// no filtro de status), "Todos" por último em vez de primeiro.
const SERVICE_CATEGORIES: { value: ServiceCategory; label: string; icon: React.ElementType }[] = [
  { value: 'elo_boost', label: 'Elo Boost', icon: TrendingUp },
  { value: 'win_boost', label: 'Wins', icon: Zap },
  { value: 'clash', label: 'Clash', icon: Swords },
  { value: 'coaching', label: 'Coaching', icon: Users },
  { value: 'all', label: 'Todos', icon: Briefcase },
]

interface ServiceFilterBarProps {
  category: ServiceCategory
  onCategoryChange: (c: ServiceCategory) => void
  counts: Record<ServiceCategory, number>
  queue: QueueType | 'all'
  onQueueChange: (q: QueueType | 'all') => void
  queueCounts: Record<QueueType | 'all', number>
  mode: BoostMode | 'all'
  onModeChange: (m: BoostMode | 'all') => void
  modeCounts: Record<BoostMode | 'all', number>
  clashTier: ClashTier | 'all'
  onClashTierChange: (t: ClashTier | 'all') => void
  clashTierCounts: Record<ClashTier | 'all', number>
  clashDay: ClashDay | 'all'
  onClashDayChange: (d: ClashDay | 'all') => void
  clashDayCounts: Record<ClashDay | 'all', number>
}

// Categoria de serviço agora é um label+setinha (mesma mecânica do filtro de
// status -- ver OrderStatusFilterDropdown -- e do seletor de tipo de fila do
// configurador), não mais uma linha de pills sempre visível. Fila/modo (Elo/
// Vitórias) e tier+dia (Clash) continuam exatamente como antes: só existem
// quando a categoria escolhida tem esses subtipos, num widget "Subfiltros"
// à direita que expande num popover ao clicar.
export function ServiceFilterBar({
  category, onCategoryChange, counts,
  queue, onQueueChange, queueCounts,
  mode, onModeChange, modeCounts,
  clashTier, onClashTierChange, clashTierCounts,
  clashDay, onClashDayChange, clashDayCounts,
}: ServiceFilterBarProps) {
  const [categoryOpen, setCategoryOpen] = useState(false)
  const categoryAnchorRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const hasQueueMode = category === 'elo_boost' || category === 'win_boost'
  const hasClash = category === 'clash'
  const activeCount = (queue !== 'all' ? 1 : 0) + (mode !== 'all' ? 1 : 0) + (clashTier !== 'all' ? 1 : 0) + (clashDay !== 'all' ? 1 : 0)
  const currentCategory = SERVICE_CATEGORIES.find((c) => c.value === category)!

  return (
    // Um wrapper só -- sem isso, os dois filhos (dropdown de categoria +
    // widget de Subfiltros) contam como 2 itens separados no flex do pai
    // (justify-between), e o item do meio (categoria) pula pro centro assim
    // que o Subfiltros aparece. Com o wrapper, ServiceFilterBar sempre conta
    // como 1 item só, ancorado por inteiro à direita.
    <div className="flex items-center gap-2 flex-wrap">
      <div className="w-fit shrink-0">
        <button
          ref={categoryAnchorRef}
          type="button"
          onClick={() => setCategoryOpen((v) => !v)}
          className={filterTriggerClass(categoryOpen)}
          aria-label={categoryOpen ? 'Fechar filtro de categoria' : 'Trocar filtro de categoria'}
        >
          <currentCategory.icon className="h-3.5 w-3.5" />
          {currentCategory.label}
          <ChevronDown className={cn(FILTER_CHEVRON_CLASS, categoryOpen && 'rotate-180')} />
        </button>

        <Popover open={categoryOpen} onClose={() => setCategoryOpen(false)} anchorRef={categoryAnchorRef} align="start" className="min-w-[180px] py-1">
          {SERVICE_CATEGORIES.map(({ value, label, icon: Icon }) => (
            <button key={value} type="button" aria-pressed={category === value} onClick={() => { onCategoryChange(value); setCategoryOpen(false) }} className={filterOptionRowClass(category === value)}>
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">{label}</span>
              <span className="text-[10px] text-ink-muted">{counts[value]}</span>
            </button>
          ))}
        </Popover>
      </div>

      {(hasQueueMode || hasClash) && (
        <div className="w-fit shrink-0">
          <button
            ref={anchorRef}
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={filterTriggerClass(open)}
            aria-label={open ? 'Fechar subfiltros' : 'Abrir subfiltros'}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Subfiltros
            {activeCount > 0 && <span className="text-[10px] text-brand/70">{activeCount}</span>}
            <ChevronDown className={cn(FILTER_CHEVRON_CLASS, open && 'rotate-180')} />
          </button>

          <Popover
            open={open}
            onClose={() => setOpen(false)}
            anchorRef={anchorRef}
            align="start"
            // Com contador dinâmico em cada pill (ver CountPill), as 5 opções
            // de Tier (nowrap, uma linha só) não cabiam mais em 350px --
            // alargado pra caber confortavelmente mesmo com números de 2+
            // dígitos.
            className={`${hasClash ? 'w-[min(94vw,410px)]' : 'w-[min(92vw,310px)]'} p-4 space-y-3`}
          >
            {hasQueueMode && (
              <>
                <FilterTabs
                  label="Fila"
                  value={queue}
                  onChange={onQueueChange}
                  options={[
                    { value: 'all', label: 'Todas', count: queueCounts.all },
                    { value: 'solo_duo', label: 'Solo/Duo', count: queueCounts.solo_duo },
                    { value: 'flex', label: 'Flex', count: queueCounts.flex },
                  ]}
                />
                <FilterTabs
                  label="Modo"
                  value={mode}
                  onChange={onModeChange}
                  options={[
                    { value: 'all', label: 'Todos', count: modeCounts.all },
                    { value: 'solo', label: 'Solo', count: modeCounts.solo },
                    { value: 'duo', label: 'Duo', count: modeCounts.duo },
                  ]}
                />
              </>
            )}

            {hasClash && (
              <>
                <FilterTabs
                  label="Tier"
                  nowrap
                  value={clashTier}
                  onChange={onClashTierChange}
                  options={[
                    { value: 'all', label: 'Todos', count: clashTierCounts.all },
                    ...CLASH_TIERS.map((tier) => ({ value: tier, label: CLASH_TIER_LABEL[tier], count: clashTierCounts[tier] })),
                  ]}
                />
                <FilterTabs
                  label="Dia"
                  value={clashDay}
                  onChange={onClashDayChange}
                  options={[
                    { value: 'all', label: 'Todos', count: clashDayCounts.all },
                    ...CLASH_DAYS.map((day) => ({ value: day, label: CLASH_DAY_LABEL[day], count: clashDayCounts[day] })),
                  ]}
                />
              </>
            )}
          </Popover>
        </div>
      )}
    </div>
  )
}
