import { useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Popover } from '@/components/ui'
import { cn } from '@/lib/utils'
import { FILTER_CHEVRON_CLASS, filterOptionRowClass, filterTriggerClass } from './filterDropdownStyles'
import { ORDER_LIST_TABS, type OrderListTab, type OrderListTabCounts } from '@/api/orders'

const TAB_LABEL: Record<OrderListTab, string> = {
  in_progress: 'Em andamento',
  em_analise: 'Em análise',
  completed: 'Concluídos',
  all: 'Todos',
}

interface OrderStatusFilterDropdownProps {
  tab: OrderListTab
  onTabChange: (tab: OrderListTab) => void
  /** Total por aba (ver useXOrderTabCounts) -- undefined enquanto ainda carrega, aí some o número em vez de piscar 0. */
  counts?: OrderListTabCounts
  dropped: boolean
  onDroppedChange: (value: boolean) => void
  droppedCount: number
  overdue: boolean
  onOverdueChange: (value: boolean) => void
  overdueCount: number
  includeCanceled: boolean
  onIncludeCanceledChange: (value: boolean) => void
}

function SubFilterCheckbox({ label, checked, count, onChange }: { label: string; checked: boolean; count?: number; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 pl-6 pr-3 py-1 text-[11px] text-ink-secondary hover:bg-bg-raised cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-brand h-3 w-3" />
      <span className="flex-1">{label}</span>
      {count !== undefined && <span className="text-[10px] text-ink-muted">{count}</span>}
    </label>
  )
}

// Label + setinha, mesma mecânica do seletor de tipo de fila do configurador
// (ver InlineFieldSelect) -- só que com N opções (não binário) e reaproveitando
// o Popover (fecha ao clicar fora/Esc) em vez de um div absoluto solto.
export function OrderStatusFilterDropdown({
  tab, onTabChange, counts,
  dropped, onDroppedChange, droppedCount,
  overdue, onOverdueChange, overdueCount,
  includeCanceled, onIncludeCanceledChange,
}: OrderStatusFilterDropdownProps) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const subActiveCount = (dropped ? 1 : 0) + (overdue ? 1 : 0) + (includeCanceled ? 1 : 0)

  return (
    <div className="w-fit shrink-0">
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={filterTriggerClass(open)}
        aria-label={open ? 'Fechar filtro de status' : 'Trocar filtro de status'}
      >
        {TAB_LABEL[tab]}
        {subActiveCount > 0 && <span className="text-[10px] text-brand/70">{subActiveCount}</span>}
        <ChevronDown className={cn(FILTER_CHEVRON_CLASS, open && 'rotate-180')} />
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} align="start" className="min-w-[220px] py-1">
        {ORDER_LIST_TABS.map((value) => (
          <div key={value}>
            <button type="button" aria-pressed={tab === value} onClick={() => { onTabChange(value); setOpen(false) }} className={filterOptionRowClass(tab === value)}>
              <span className="flex-1">{TAB_LABEL[value]}</span>
              {counts && <span className="text-[10px] text-ink-muted">{counts[value]}</span>}
            </button>
            {value === 'in_progress' && (
              <div className="pb-1">
                <SubFilterCheckbox label="Dropado" checked={dropped} count={droppedCount} onChange={onDroppedChange} />
                <SubFilterCheckbox label="Atrasado" checked={overdue} count={overdueCount} onChange={onOverdueChange} />
              </div>
            )}
            {value === 'completed' && (
              <div className="pb-1">
                <SubFilterCheckbox label="Cancelados" checked={includeCanceled} count={counts?.canceled} onChange={onIncludeCanceledChange} />
              </div>
            )}
          </div>
        ))}
      </Popover>
    </div>
  )
}
