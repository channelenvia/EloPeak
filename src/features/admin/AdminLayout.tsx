import { useState } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, ShoppingBag, Users, DollarSign,
  Shield,
  RefreshCw, AlertTriangle, Landmark, Banknote,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/authStore'
import { NotificationBell } from '@/components/NotificationBell'
import { RoleRedirectNotice } from '@/components/RoleRedirectNotice'
import { UserProfilePanel } from '@/components/UserProfilePanel'
import { AppSidebar, type SidebarNavSection } from '@/components/layout/AppSidebar'

export function AdminLayout() {
  const { pathname } = useLocation()
  const { t } = useTranslation()
  const { profile } = useAuthStore()
  const [panelOpen, setPanelOpen] = useState(false)

  const NAV_SECTIONS: SidebarNavSection[] = [
    {
      label: t('admin.nav.operations'),
      items: [
        { href: '/admin',           icon: LayoutDashboard, label: t('admin.nav.overview')   },
        { href: '/admin/orders',    icon: ShoppingBag,     label: t('admin.nav.orders')     },
        { href: '/admin/boosters',  icon: Shield,          label: t('admin.nav.boosters')   },
        { href: '/admin/customers', icon: Users,           label: t('admin.nav.customers')  },
        { href: '/admin/drops',     icon: AlertTriangle,   label: 'Drops'                   },
        { href: '/admin/duo-accounts', icon: Landmark,     label: 'Contas Duo'              },
      ],
    },
    {
      label: t('admin.nav.finance'),
      items: [
        { href: '/admin/payments', icon: DollarSign, label: t('admin.nav.payments') },
        { href: '/admin/payouts',  icon: Banknote,    label: 'Saques' },
        { href: '/admin/refunds',  icon: RefreshCw,  label: t('admin.nav.refunds')  },
      ],
    },
  ]
  const navItems = NAV_SECTIONS.flatMap(section => section.items)
  const isActive = (href: string) => pathname === href || (href !== '/admin' && pathname.startsWith(`${href}/`))

  return (
    <div className="h-screen overflow-hidden flex">
      <AppSidebar scope="admin" homeHref="/admin" sections={NAV_SECTIONS} breakpoint="lg" />

      {/* ── Main area ──────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        <RoleRedirectNotice />
        <nav className="lg:hidden flex items-center gap-2 border-b border-border-subtle bg-bg-surface/90 backdrop-blur-xl shrink-0 px-3 py-2" aria-label="Navegação administrativa">
          <div className="flex-1 overflow-x-auto">
            <div className="flex min-w-max gap-1">
              {navItems.map(({ href, icon: Icon, label }) => (
                <Link
                  key={href}
                  to={href}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium',
                    isActive(href) ? 'bg-brand/15 text-brand' : 'text-ink-secondary hover:bg-bg-elevated hover:text-ink',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {label}
                </Link>
              ))}
            </div>
          </div>
          {/* Perfil/notificações no mobile -- antes vinham do header, removido. */}
          <div className="flex items-center gap-1 shrink-0">
            <NotificationBell />
            <button
              onClick={() => setPanelOpen(true)}
              className="rounded-full hover:ring-2 hover:ring-brand/40 transition-all"
            >
              <Avatar src={profile?.avatar_url} name={profile?.username} size="sm" />
            </button>
          </div>
        </nav>

        {/* Largura padronizada — mesma régua do painel de cliente e booster. */}
        <main className="flex-1 overflow-auto p-6 lg:p-9">
          <div className="mx-auto w-full max-w-[1600px]">
            <Outlet />
          </div>
        </main>
      </div>

      <UserProfilePanel open={panelOpen} onClose={() => setPanelOpen(false)} />
    </div>
  )
}
