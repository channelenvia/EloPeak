import { useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui'
import { NotificationBell } from '@/components/NotificationBell'
import { RoleRedirectNotice } from '@/components/RoleRedirectNotice'
import { UserProfilePanel } from '@/components/UserProfilePanel'
import { useAuthStore } from '@/stores/authStore'
import { AppSidebar, type SidebarNavItem, type SidebarNavSection } from './AppSidebar'

interface AppShellProps {
  scope: 'customer' | 'booster' | 'admin'
  homeHref: string
  sections: SidebarNavSection[]
  roleBadge?: { label: string; className: string }
  /** 'tabs' = barra inferior (cliente/booster); 'scroll' = barra superior rolável (admin, muitos itens). */
  mobileNav?: 'tabs' | 'scroll'
  /** Itens da navegação mobile; por padrão, todos os itens das seções. */
  mobileItems?: SidebarNavItem[]
  navLabel?: string
}

// Casca única dos painéis de cliente, booster e admin: sidebar + área
// principal com a mesma largura máxima + navegação mobile + painel de perfil.
export function AppShell({ scope, homeHref, sections, roleBadge, mobileNav = 'tabs', mobileItems, navLabel }: AppShellProps) {
  const { pathname } = useLocation()
  const { profile } = useAuthStore()
  const [panelOpen, setPanelOpen] = useState(false)
  const items = mobileItems ?? sections.flatMap((s) => s.items)
  const isActive = (item: SidebarNavItem) =>
    item.isActive ? item.isActive(pathname) : pathname === item.href || (item.href !== homeHref && pathname.startsWith(`${item.href}/`))

  return (
    <div className="h-screen overflow-hidden flex">
      <AppSidebar scope={scope} homeHref={homeHref} sections={sections} roleBadge={roleBadge} breakpoint={mobileNav === 'scroll' ? 'lg' : 'md'} />

      <div className="flex-1 flex flex-col min-w-0">
        <RoleRedirectNotice />
        {mobileNav === 'scroll' && (
          <nav className="lg:hidden flex items-center gap-2 border-b border-border-subtle bg-bg-surface/90 backdrop-blur-xl shrink-0 px-3 py-2" aria-label={navLabel}>
            <div className="flex-1 overflow-x-auto">
              <div className="flex min-w-max gap-1">
                {items.map((item) => (
                  <Link
                    key={item.href}
                    to={item.href}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium',
                      isActive(item) ? 'bg-brand/15 text-brand' : 'text-ink-secondary hover:bg-bg-raised hover:text-ink',
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <NotificationBell />
              <button type="button" onClick={() => setPanelOpen(true)} aria-label="Perfil" className="rounded-full hover:ring-2 hover:ring-brand/40 transition-all">
                <Avatar src={profile?.avatar_url} name={profile?.username} size="sm" />
              </button>
            </div>
          </nav>
        )}

        {/* Largura padronizada: toda página do painel herda a mesma régua. */}
        <main className="flex-1 overflow-auto p-6 lg:p-9">
          <div className="mx-auto w-full max-w-[1600px]">
            <Outlet />
          </div>
        </main>

        {mobileNav === 'tabs' && (
          <nav className="md:hidden border-t border-border-subtle bg-bg-surface/90 backdrop-blur-xl flex shrink-0" aria-label={navLabel}>
            {items.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  'flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-3 text-2xs font-semibold transition-colors',
                  isActive(item) ? 'text-brand' : 'text-ink-muted',
                )}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                <span className="w-full truncate text-center">{item.label}</span>
              </Link>
            ))}
            <div className="flex min-w-0 flex-1 items-center justify-center">
              <NotificationBell />
            </div>
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              className="flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-3 text-2xs font-semibold text-ink-muted"
            >
              <Avatar src={profile?.avatar_url} name={profile?.username} size="xs" />
              <span className="w-full truncate text-center">Perfil</span>
            </button>
          </nav>
        )}
      </div>

      <UserProfilePanel open={panelOpen} onClose={() => setPanelOpen(false)} />
    </div>
  )
}
