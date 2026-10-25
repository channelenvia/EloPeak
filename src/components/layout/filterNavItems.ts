import type { SidebarNavItem } from './AppSidebar'

const stripAccents = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Itens cujo rótulo contém todas as palavras da busca (sem acento, sem caixa). Busca vazia devolve tudo. */
export function filterNavItems(items: readonly SidebarNavItem[], query: string): SidebarNavItem[] {
  const terms = stripAccents(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return [...items]
  return items.filter((item) => {
    const label = stripAccents(item.label)
    return terms.every((term) => label.includes(term))
  })
}
