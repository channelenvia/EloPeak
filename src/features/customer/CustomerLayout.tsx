import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, ShoppingBag, Plus, HeadphonesIcon,
  User, LogOut, Bell, ChevronDown,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { signOut } from '@/lib/supabase'
import { Avatar, LogoMark, ThemeToggle } from '@/components/ui'
import { useState } from 'react'

export function CustomerLayout() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const { t } = useTranslation()
  const [profileOpen, setProfileOpen] = useState(false)

  const NAV_ITEMS = [
    { href: '/dashboard',  icon: LayoutDashboard, label: t('customer.nav.dashboard') },
    { href: '/orders/new', icon: Plus,            label: t('customer.nav.newOrder')   },
    { href: '/orders',     icon: ShoppingBag,     label: t('customer.nav.myOrders')   },
    { href: '/support',    icon: HeadphonesIcon,  label: t('customer.nav.support')    },
    { href: '/profile',    icon: User,            label: t('customer.nav.profile')    },
  ]

  async function handleSignOut() {
    await signOut()
    navigate('/')
  }

  return (
    <div className="min-h-screen flex bg-bg-base">
      {/* ── Sidebar ────────────────────────────────────────────────── */}
      <aside className="hidden md:flex w-64 flex-col border-r border-bg-elevated bg-bg-surface shrink-0">
        {/* Logo */}
        <div className="h-[68px] flex items-center px-6 border-b border-bg-elevated shrink-0">
          <Link to="/" className="flex items-center gap-2.5">
            <LogoMark className="h-8 w-8" />
            <span className="font-bold text-ink">
              Elo<span className="text-brand">Peak</span>
            </span>
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-4 py-5 space-y-1">
          {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
            const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href) && !pathname.startsWith('/orders/new'))
            return (
              <Link
                key={href}
                to={href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150',
                  active
                    ? 'bg-brand/15 text-brand border border-brand/20'
                    : 'text-ink-secondary hover:text-ink hover:bg-bg-elevated border border-transparent'
                )}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" />
                {label}
              </Link>
            )
          })}
        </nav>

        {/* User profile */}
        <div className="border-t border-bg-elevated p-4">
          <button
            onClick={() => setProfileOpen(!profileOpen)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-bg-elevated transition-colors"
          >
            <Avatar name={profile?.username} size="sm" />
            <div className="flex-1 text-left min-w-0">
              <p className="text-sm font-semibold text-ink truncate">{profile?.username}</p>
              <p className="text-[11px] text-ink-muted">{t('customer.nav.role')}</p>
            </div>
            <ChevronDown className="h-4 w-4 text-ink-muted shrink-0" />
          </button>
          {profileOpen && (
            <div className="mt-1.5 card p-1 space-y-0.5 animate-scale-in">
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-danger hover:bg-danger/10 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                {t('customer.nav.signOut')}
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ── Main area ──────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-[68px] flex items-center justify-between px-6 border-b border-bg-elevated bg-bg-surface shrink-0">
          {/* Mobile logo */}
          <Link to="/" className="md:hidden flex items-center gap-2">
            <LogoMark className="h-7 w-7" />
            <span className="font-bold text-ink text-sm">Elo<span className="text-brand">Peak</span></span>
          </Link>
          <div className="hidden md:block" />
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <button className="relative p-2.5 rounded-xl text-ink-secondary hover:text-ink hover:bg-bg-elevated transition-colors">
              <Bell className="h-[18px] w-[18px]" />
            </button>
            <Avatar name={profile?.username} size="sm" />
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-6 lg:p-8">
          <Outlet />
        </main>

        {/* Mobile bottom nav */}
        <nav className="md:hidden border-t border-bg-elevated bg-bg-surface flex shrink-0">
          {NAV_ITEMS.filter(i => i.href !== '/orders/new').map(({ href, icon: Icon, label }) => {
            const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href) && !pathname.startsWith('/orders/new'))
            return (
              <Link
                key={href}
                to={href}
                className={cn(
                  'flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-semibold transition-colors',
                  active ? 'text-brand' : 'text-ink-muted'
                )}
              >
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
