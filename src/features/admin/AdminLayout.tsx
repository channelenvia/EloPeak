import {
  LayoutDashboard, ShoppingBag, Users, DollarSign, Shield,
  RefreshCw, AlertTriangle, Landmark, Banknote, History, Star,
} from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import type { SidebarNavSection } from '@/components/layout/AppSidebar'
import { useChatMentionSound } from '@/hooks/useChatMentionSound'

const NAV_SECTIONS: SidebarNavSection[] = [
  {
    label: 'Operações',
    items: [
      { href: '/admin',              icon: LayoutDashboard, label: 'Visão Geral' },
      { href: '/admin/orders',       icon: ShoppingBag,     label: 'Pedidos'     },
      { href: '/admin/boosters',     icon: Shield,          label: 'Boosters'    },
      { href: '/admin/customers',    icon: Users,           label: 'Clientes'    },
      { href: '/admin/drops',        icon: AlertTriangle,   label: 'Drops'       },
      { href: '/admin/duo-accounts', icon: Landmark,        label: 'Contas Duo'  },
      { href: '/admin/reviews',      icon: Star,            label: 'Avaliações'  },
      { href: '/admin/audit',        icon: History,         label: 'Auditoria'   },
    ],
  },
  {
    label: 'Finanças',
    items: [
      { href: '/admin/payments', icon: DollarSign, label: 'Pagamentos' },
      { href: '/admin/payouts',  icon: Banknote,   label: 'Saques' },
      { href: '/admin/refunds',  icon: RefreshCw,  label: 'A reembolsar' },
    ],
  },
]

export function AdminLayout() {
  useChatMentionSound()
  useChatMentionSound('order_pending_review')
  return <AppShell scope="admin" homeHref="/admin" sections={NAV_SECTIONS} mobileNav="scroll" navLabel="Navegação administrativa" />
}
