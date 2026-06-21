import { Outlet, Link, useLocation, useNavigate, Navigate } from 'react-router-dom'
import {
  LayoutDashboard, Briefcase, DollarSign,
  User, LogOut, Bell, ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { signOut, supabase } from '@/lib/supabase'
import { Avatar, LogoMark, ThemeToggle } from '@/components/ui'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

export function BoosterLayout() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const [profileOpen, setProfileOpen] = useState(false)
  const { t } = useTranslation()

  const NAV_ITEMS = [
    { href: '/booster',           icon: LayoutDashboard, label: t('booster.nav.dashboard')  },
    { href: '/booster/jobs',      icon: Briefcase,       label: t('booster.nav.jobs')        },
    { href: '/booster/earnings',  icon: DollarSign,      label: t('booster.nav.earnings')    },
    { href: '/booster/profile',   icon: User,            label: t('booster.nav.profile')     },
  ]

  // Check if booster has completed onboarding
  const { data: boosterProfile, isLoading } = useQuery({
    queryKey: ['booster-profile', profile?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('booster_profiles')
        .select('status, display_name')
        .eq('user_id', profile!.id)
        .maybeSingle()
      return data
    },
    enabled: !!profile?.id,
  })

  async function handleSignOut() {
    await signOut()
    navigate('/')
  }

  // Redirect to onboarding if profile not created yet
  if (!isLoading && !boosterProfile && pathname !== '/booster/onboarding') {
    return <Navigate to="/booster/onboarding" replace />
  }

  const isPending = boosterProfile?.status === 'pending' || boosterProfile?.status === 'under_review'

  return (
    <div className="min-h-screen flex bg-bg-base">
      {/* ── Sidebar ────────────────────────────────────────────────── */}
      <aside className="hidden md:flex w-64 flex-col border-r border-bg-elevated bg-bg-surface shrink-0">
        {/* Logo + badge */}
        <div className="h-[68px] flex items-center px-6 border-b border-bg-elevated gap-3 shrink-0">
          <Link to="/" className="flex items-center gap-2.5 flex-1 min-w-0">
            <LogoMark className="h-8 w-8 shrink-0" />
            <span className="font-bold text-ink truncate">
              Elo<span className="text-brand">Peak</span>
            </span>
          </Link>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-success/15 text-success border border-success/25 shrink-0">
            {t('booster.nav.role')}
          </span>
        </div>

        {/* Pending banner */}
        {isPending && (
          <div className="mx-4 mt-4 p-3 rounded-xl bg-warning/10 border border-warning/25">
            <p className="text-xs font-semibold text-warning">{t('booster.nav.pendingBanner')}</p>
            <p className="text-[11px] text-ink-muted mt-0.5">{t('booster.nav.pendingBannerDesc')}</p>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 px-4 py-5 space-y-1">
          {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
            const active = pathname === href || (href !== '/booster' && pathname.startsWith(href))
            return (
              <Link
                key={label}
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

        {/* User */}
        <div className="border-t border-bg-elevated p-4">
          <button
            onClick={() => setProfileOpen(!profileOpen)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-bg-elevated transition-colors"
          >
            <Avatar name={profile?.username} size="sm" online />
            <div className="flex-1 text-left min-w-0">
              <p className="text-sm font-semibold text-ink truncate">{profile?.username}</p>
              <p className="text-[11px] text-ink-muted capitalize">{boosterProfile?.status ?? 'pending'}</p>
            </div>
            <ChevronDown className="h-4 w-4 text-ink-muted shrink-0" />
          </button>
          {profileOpen && (
            <div className="mt-1.5 card p-1 animate-scale-in">
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-danger hover:bg-danger/10 transition-colors"
              >
                <LogOut className="h-4 w-4" /> {t('booster.nav.signOut')}
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ── Main area ──────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-[68px] flex items-center justify-between px-6 border-b border-bg-elevated bg-bg-surface shrink-0">
          <div className="md:hidden font-bold text-ink">Elo<span className="text-brand">Peak</span></div>
          <div className="hidden md:block" />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button className="p-2.5 rounded-xl text-ink-secondary hover:text-ink hover:bg-bg-elevated transition-colors">
              <Bell className="h-[18px] w-[18px]" />
            </button>
            <Avatar name={profile?.username} size="sm" online />
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
