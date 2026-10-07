import { SearchInput } from '@/components/ui'
import { OrderStatusFilterDropdown } from './OrderStatusFilterDropdown'
import { ServiceFilterBar } from './ServiceFilterBar'
import type { useOrderStatusFilter } from './useOrderStatusFilter'
import type { useServiceFilters } from './useServiceFilters'

type StatusFilter = ReturnType<typeof useOrderStatusFilter>
type ServiceFilters = ReturnType<typeof useServiceFilters>

interface OrderListToolbarProps {
  search: string
  onSearchChange: (value: string) => void
  serviceFilters: ServiceFilters
  /** Sem statusFilter (ex.: pool de jobs do booster) a barra mostra só busca + serviço. */
  statusFilter?: StatusFilter
  tabCounts?: React.ComponentProps<typeof OrderStatusFilterDropdown>['counts']
  subCounts?: { dropped: number; overdue: number }
  placeholder?: string
}

// Toolbar única das listas de pedido (cliente, booster, admin): busca + status
// à esquerda, tipo de serviço à direita.
export function OrderListToolbar({
  search, onSearchChange, serviceFilters, statusFilter, tabCounts, subCounts,
  placeholder = 'Buscar por ID do pedido…',
}: OrderListToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          wrapperClassName="w-full sm:w-64 shrink-0"
          placeholder={placeholder}
          aria-label={placeholder.replace(/[.…]+$/, '')}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {statusFilter && subCounts && (
          <OrderStatusFilterDropdown
            tab={statusFilter.tab}
            onTabChange={statusFilter.setTab}
            counts={tabCounts}
            dropped={statusFilter.dropped}
            onDroppedChange={statusFilter.setDropped}
            droppedCount={subCounts.dropped}
            overdue={statusFilter.overdue}
            onOverdueChange={statusFilter.setOverdue}
            overdueCount={subCounts.overdue}
            includeCanceled={statusFilter.includeCanceled}
            onIncludeCanceledChange={statusFilter.setIncludeCanceled}
          />
        )}
      </div>
      <ServiceFilterBar
        category={serviceFilters.category}
        onCategoryChange={serviceFilters.setCategory}
        counts={serviceFilters.counts}
        queue={serviceFilters.queue}
        onQueueChange={serviceFilters.setQueue}
        queueCounts={serviceFilters.queueCounts}
        mode={serviceFilters.mode}
        onModeChange={serviceFilters.setMode}
        modeCounts={serviceFilters.modeCounts}
        clashTier={serviceFilters.clashTier}
        onClashTierChange={serviceFilters.setClashTier}
        clashTierCounts={serviceFilters.clashTierCounts}
        clashDay={serviceFilters.clashDay}
        onClashDayChange={serviceFilters.setClashDay}
        clashDayCounts={serviceFilters.clashDayCounts}
      />
    </div>
  )
}
