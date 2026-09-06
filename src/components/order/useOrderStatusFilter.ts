import { useState } from 'react'
import { isOrderOverdue } from '@/lib/utils'
import type { Order } from '@/types'
import type { OrderListTab } from '@/api/orders'

// Estado do filtro de status compartilhado pelas 3 telas de "meus pedidos"
// (cliente, booster, admin) -- ver OrderStatusFilterDropdown. "Dropado" e
// "Atrasado" são sub-filtros de "Em andamento" (drop_count/prazo estourado
// não são status do banco, só refinam client-side o que já veio da aba
// in_progress); "Cancelados" é sub-filtro de "Concluídos", mas diferente dos
// outros dois -- 'canceled' não é buscado por padrão nessa aba, então marcar
// o checkbox muda o que é pedido ao servidor (ver includeCanceled), não só
// refina client-side. Trocar de aba limpa os sub-filtros da aba anterior --
// mesmo padrão de useServiceFilters ao trocar categoria.
export function useOrderStatusFilter(defaultTab: OrderListTab = 'in_progress') {
  const [tab, setTabRaw] = useState<OrderListTab>(defaultTab)
  const [dropped, setDropped] = useState(false)
  const [overdue, setOverdue] = useState(false)
  const [includeCanceled, setIncludeCanceledRaw] = useState(false)

  function setTab(next: OrderListTab) {
    setTabRaw(next)
    if (next !== 'in_progress') {
      setDropped(false)
      setOverdue(false)
    }
    if (next !== 'completed') setIncludeCanceledRaw(false)
  }

  // Passa por setTab (não setTabRaw) pra herdar o reset de sub-filtro da aba
  // que está sendo deixada -- senão marcar "Dropado" vindo de completed com
  // "Cancelados" ativo deixava includeCanceled=true grudado, sem efeito
  // nenhum na aba in_progress, só como contador fantasma no dropdown.
  function setDroppedFilter(value: boolean) {
    setTab('in_progress')
    setDropped(value)
  }

  function setOverdueFilter(value: boolean) {
    setTab('in_progress')
    setOverdue(value)
  }

  function setIncludeCanceled(value: boolean) {
    setTab('completed')
    setIncludeCanceledRaw(value)
  }

  // Só dropado/atrasado -- "Cancelados" já muda a query em si (includeCanceled),
  // não precisa de um filtro client-side adicional.
  function applySubFilters(orders: Order[]): Order[] {
    if (tab !== 'in_progress' || (!dropped && !overdue)) return orders
    return orders.filter((o) => (!dropped || o.drop_count > 0) && (!overdue || isOrderOverdue(o)))
  }

  // Contagem dos 2 sub-filtros dentro do conjunto já em "Em andamento" (antes
  // de aplicar os próprios dropped/overdue) -- mesmo recorte que os contadores
  // de categoria de serviço já usam: conta antes do próprio filtro daquele
  // campo, depois dos outros filtros já aplicados (aqui, tipo de serviço).
  function subFilterCounts(orders: Order[]): { dropped: number; overdue: number } {
    return {
      dropped: orders.filter((o) => o.drop_count > 0).length,
      overdue: orders.filter((o) => isOrderOverdue(o)).length,
    }
  }

  return {
    tab, setTab,
    dropped, setDropped: setDroppedFilter,
    overdue, setOverdue: setOverdueFilter,
    includeCanceled, setIncludeCanceled,
    applySubFilters,
    subFilterCounts,
  }
}
