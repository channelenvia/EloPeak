import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, ShoppingBag, Users, DollarSign,
  HeadphonesIcon, Settings, Shield, Star,
  LogOut, ChevronDown, Bell, RefreshCw, Eye, AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { signOut } from '@/lib/supabase'
import { Avatar, LogoMark, ThemeToggle } from '@/components/ui'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export function AdminLayout() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const [profileOpen, setProfileOpen] = useState(false)
  const { t } = useTranslation()

  const NAV_SECTIONS = [
    {
      label: t('admin.nav.operations'),
      items: [
        { href: '/admin',           icon: LayoutDashboard, label: t('admin.nav.overview')   },
        { href: '/admin/orders',    icon: ShoppingBag,     label: t('admin.nav.orders')     },
        { href: '/admin/boosters',  icon: Shield,          label: t('admin.nav.boosters')   },
        { href: '/admin/customers', icon: Users,           label: t('admin.nav.customers')  },
        { href: '/admin/drops',     icon: AlertTriangle,   label: 'Drops'                   },
      ],
    },
    {
      label: t('admin.nav.finance'),
      items: [
        { href: '/admin/payments', icon: DollarSign, label: t('admin.nav.payments') },
        { href: '/admin/refunds',  icon: RefreshCw,  label: t('admin.nav.refunds')  },
      ],
    },
    {
      label: t('admin.nav.support'),
      items: [
        { href: '/admin/tickets', icon: HeadphonesIcon, label: t('admin.nav.tickets') },
        { href: '/admin/reviews', icon: Star,           label: t('admin.nav.reviews') },
      ],
    },
    {
      label: t('admin.nav.system'),
      items: [
        { href: '/admin/services', icon: Settings, label: t('admin.nav.services')  },
        { href: '/admin/audit',    icon: Eye,      label: t('admin.nav.audit') },
      ],
    },
  ]

  async function handleSignOut() {
    await signOut()
    navigate('/')
  }

  return (
    <div className="min-h-screen flex bg-bg-base">
      {/* ── Sidebar ────────────────────────────────────────────────── */}
      <aside className="hidden lg:flex w-64 flex-col border-r border-bg-elevated bg-bg-surface shrink-0">
        {/* Logo */}
        <div className="h-[68px] flex items-center px-6 border-b border-bg-elevated gap-3 shrink-0">
          <Link to="/" className="flex items-center gap-2.5 flex-1 min-w-0">
            <LogoMark className="h-8 w-8 shrink-0" />
            <span className="font-bold text-ink truncate">
              Elo<span className="text-brand">Peak</span>
            </span>
          </Link>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-danger/15 text-danger border border-danger/25 shrink-0 uppercase tracking-wide">
            {t('admin.nav.role')}
          </span>
        </div>

        {/* Nav sections */}
        <nav className="flex-1 px-4 py-5 space-y-6 overflow-y-auto">
          {NAV_SECTIONS.map(({ label, items }) => (
            <div key={label}>
              <p className="section-label px-3 mb-2">{label}</p>
              <div className="space-y-0.5">
                {items.map(({ href, icon: Icon, label: itemLabel }) => {
                  const active = pathname === href
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
                      {itemLabel}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* User */}
        <div className="border-t border-bg-elevated p-4">
          <button
            onClick={() => setProfileOpen(!profileOpen)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-bg-elevated transition-colors"
          >
            <Avatar name={profile?.username} size="sm" />
            <div className="flex-1 text-left min-w-0">
              <p className="text-sm font-semibold text-ink truncate">{profile?.username}</p>
              <p className="text-[11px] text-ink-muted capitalize">{profile?.role}</p>
            </div>
            <ChevronDown className="h-4 w-4 text-ink-muted shrink-0" />
          </button>
          {profileOpen && (
            <div className="mt-1.5 card p-1 animate-scale-in">
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-danger hover:bg-danger/10 transition-colors"
              >
                <LogOut className="h-4 w-4" /> {t('admin.nav.signOut')}
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ── Main area ──────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-[68px] flex items-center justify-between px-6 border-b border-bg-elevated bg-bg-surface shrink-0">
          <p className="text-sm text-ink-muted font-medium">{t('admin.nav.panel')}</p>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button className="p-2.5 rounded-xl text-ink-secondary hover:text-ink hover:bg-bg-elevated transition-colors">
              <Bell className="h-[18px] w-[18px]" />
            </button>
            <Avatar name={profile?.username} size="sm" />
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
