import { describe, expect, it } from 'vitest'
import type { SidebarNavItem } from './AppSidebar'
import { filterNavItems } from './filterNavItems'

const icon = (() => null) as unknown as SidebarNavItem['icon']
const items: SidebarNavItem[] = [
  { href: '/admin/orders', icon, label: 'Pedidos' },
  { href: '/admin/payments', icon, label: 'Pagamentos' },
  { href: '/admin/refunds', icon, label: 'Reembolsos' },
]

describe('filterNavItems', () => {
  it('devolve todos os itens com busca vazia', () => {
    expect(filterNavItems(items, '  ')).toHaveLength(3)
  })
  it('ignora acento e caixa', () => {
    expect(filterNavItems(items, 'PEDIDOS').map((i) => i.href)).toEqual(['/admin/orders'])
    expect(filterNavItems(items, 'reembolsó').map((i) => i.href)).toEqual(['/admin/refunds'])
    expect(filterNavItems(items, 'reembolso').map((i) => i.href)).toEqual(['/admin/refunds'])
  })
  it('exige todas as palavras', () => {
    expect(filterNavItems(items, 'pa ga')).toHaveLength(1)
    expect(filterNavItems(items, 'pa xx')).toHaveLength(0)
  })
})
