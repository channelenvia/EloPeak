import { useState } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, ShoppingBag, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { Avatar } from '@/components/ui'
import { UserProfilePanel } from '@/components/UserProfilePanel'
import { AppSidebar, type SidebarNavSection } from '@/components/layout/AppSidebar'

export function CustomerLayout() {
  const { pathname } = useLocation()
  const { profile } = useAuthStore()
  const { t } = useTranslation()
  const [panelOpen, setPanelOpen] = useState(false)

  const NAV_ITEMS = [
    { href: '/dashboard',  icon: LayoutDashboard, label: t('customer.nav.dashboard') },
    { href: '/orders/new', icon: Plus,            label: t('customer.nav.newOrder')   },
    {
      href: '/orders', icon: ShoppingBag, label: t('customer.nav.myOrders'),
      isActive: (p: string) => p === '/orders' || (p.startsWith('/orders/') && !p.startsWith('/orders/new')),
    },
  ]
  const sections: SidebarNavSection[] = [{ items: NAV_ITEMS }]

  return (
    <div className="h-screen overflow-hidden flex">
      <AppSidebar scope="customer" homeHref="/dashboard" sections={sections} />

      {/* ── Main area ──────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Largura padronizada pra toda página do painel do cliente herdar
            exatamente o mesmo tamanho, em vez de cada página escolher o
            próprio max-w. Com a sidebar recolhida, o teto cresce junto --
            sem isso, o espaço liberado pelo recolhimento virava só margem
            em branco dos dois lados em vez de ser aproveitado pelo conteúdo. */}
        <main className="flex-1 overflow-auto p-6 lg:p-9">
          <div className="mx-auto w-full max-w-[1600px]">
            <Outlet />
          </div>
        </main>

        {/* Mobile bottom nav */}
        <nav className="md:hidden border-t border-bg-elevated bg-bg-surface/90 backdrop-blur-xl flex shrink-0">
          {NAV_ITEMS.filter(i => i.href !== '/orders/new').map(({ href, icon: Icon, label, isActive }) => {
            const active = isActive ? isActive(pathname) : (pathname === href || (href !== '/dashboard' && pathname.startsWith(href)))
            return (
              <Link
                key={href}
                to={href}
                className={cn(
                  'flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-semibold transition-colors',
                  active ? 'text-brand' : 'text-ink-muted',
                )}
              >
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            )
          })}
          {/* Profile icon in mobile nav */}
          <button
            onClick={() => setPanelOpen(true)}
            className="flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-semibold text-ink-muted"
          >
            <Avatar src={profile?.avatar_url} name={profile?.username} size="xs" />
            Perfil
          </button>
        </nav>
      </div>

      <UserProfilePanel open={panelOpen} onClose={() => setPanelOpen(false)} />
    </div>
  )
}
