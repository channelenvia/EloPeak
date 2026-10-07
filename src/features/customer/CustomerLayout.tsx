import { LayoutDashboard, ShoppingBag, Plus } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import type { SidebarNavItem } from '@/components/layout/AppSidebar'
import { useChatMentionSound } from '@/hooks/useChatMentionSound'

const NEW_ORDER_ITEM: SidebarNavItem = { href: '/orders/new', icon: Plus, label: 'Novo Pedido' }
const NAV_ITEMS: SidebarNavItem[] = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Painel' },
  NEW_ORDER_ITEM,
  {
    href: '/orders', icon: ShoppingBag, label: 'Meus Pedidos',
    isActive: (p) => p === '/orders' || (p.startsWith('/orders/') && !p.startsWith('/orders/new')),
  },
]
// "Novo Pedido" só existe na sidebar; a barra mobile não tem esse atalho.
const MOBILE_ITEMS = NAV_ITEMS.filter((i) => i !== NEW_ORDER_ITEM)

export function CustomerLayout() {
  useChatMentionSound()
  return <AppShell scope="customer" homeHref="/dashboard" sections={[{ items: NAV_ITEMS }]} mobileItems={MOBILE_ITEMS} />
}
