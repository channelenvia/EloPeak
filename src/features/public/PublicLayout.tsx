import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Menu, X } from 'lucide-react'
import { Button, ThemeToggle, LogoMark } from '@/components/ui'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'

function LiveIndicator() {
  const { t } = useTranslation()
  const [count, setCount] = useState(11)
  useEffect(() => {
    const timer = setInterval(() => {
      setCount(c => c + (Math.random() > 0.5 ? 1 : -1) * (Math.random() > 0.7 ? 1 : 0))
    }, 4000)
    return () => clearInterval(timer)
  }, [])
  return (
    <div className="hidden lg:flex items-center gap-2 text-xs font-semibold text-success bg-success/10 border border-success/20 px-3 py-1.5 rounded-full">
      <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
      {t('nav.boostersOnline', { count })}
    </div>
  )
}

export function PublicLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { isAuthenticated, profile } = useAuthStore()
  const { t } = useTranslation()

  const dashboardLink =
    profile?.role === 'admin' || profile?.role === 'support' ? '/admin'
    : profile?.role === 'booster' ? '/booster'
    : '/dashboard'

  function handleBoostClick() {
    if (isAuthenticated()) navigate(dashboardLink)
    else navigate('/orders/new')
  }

  function handleServicesClick() {
    if (pathname === '/') {
      document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' })
    } else {
      navigate('/')
      setTimeout(() => {
        document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' })
      }, 150)
    }
    setMobileOpen(false)
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Discount bar */}
      <div className="bg-gradient-brand py-2 text-center text-xs font-semibold text-white/95 tracking-wide">
        {t('nav.announcement')}
      </div>

      {/* Navbar */}
      <header className="sticky top-0 z-50 border-b border-bg-elevated/60 bg-bg-base/90 backdrop-blur-xl">
        <div className="max-w-screen-xl mx-auto px-5 sm:px-8 flex h-[68px] items-center gap-6">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2.5 shrink-0">
            <LogoMark className="h-9 w-9" />
            <span className="text-lg font-extrabold tracking-tight text-ink">
              Elo<span className="text-brand">Peak</span>
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-1 flex-1">
            {/* Serviços — click only, scrolls to services section */}
            <button
              onClick={handleServicesClick}
              className="px-3 py-2 rounded-lg text-sm font-medium text-ink-secondary hover:text-ink hover:bg-bg-elevated transition-colors"
            >
              {t('nav.services')}
            </button>

            {[
              { href: '/pricing',   label: t('nav.pricing')   },
              { href: '/security',  label: t('nav.security')  },
              { href: '/faq',       label: t('nav.faq')       },
              { href: '/boosters',  label: t('nav.boosters')  },
            ].map(({ href, label }) => (
              <Link key={href} to={href}
                className={cn('px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  pathname === href ? 'text-ink bg-bg-elevated' : 'text-ink-secondary hover:text-ink hover:bg-bg-elevated/60'
                )}
              >
                {label}
              </Link>
            ))}
          </nav>

          {/* Right side */}
          <div className="hidden lg:flex items-center gap-3 ml-auto">
            <LiveIndicator />
            <ThemeToggle />
            {isAuthenticated() ? (
              <Button asChild size="sm">
                <Link to={dashboardLink}>{t('nav.dashboard')}</Link>
              </Button>
            ) : (
              <Button asChild size="sm">
                <Link to="/login">{t('nav.signIn')}</Link>
              </Button>
            )}
          </div>

          {/* Mobile toggle */}
          <button
            className="lg:hidden ml-auto p-2 rounded-lg text-ink-secondary hover:bg-bg-elevated"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="lg:hidden border-t border-bg-elevated bg-bg-surface px-5 py-5 space-y-1 animate-slide-down">
            <button
              onClick={handleServicesClick}
              className="w-full text-left block px-3 py-2.5 rounded-xl text-sm text-ink-secondary hover:text-ink hover:bg-bg-elevated"
            >
              {t('nav.services')}
            </button>
            {[
              { href: '/pricing',   label: t('nav.pricing')       },
              { href: '/security',  label: t('nav.security')      },
              { href: '/faq',       label: t('nav.faq')           },
              { href: '/boosters',  label: t('nav.boosters')      },
              { href: '/apply',     label: t('nav.applyBooster')  },
            ].map(({ href, label }) => (
              <Link key={href} to={href} onClick={() => setMobileOpen(false)}
                className="block px-3 py-2.5 rounded-xl text-sm text-ink-secondary hover:text-ink hover:bg-bg-elevated"
              >
                {label}
              </Link>
            ))}
            <div className="pt-3 flex gap-2">
              <ThemeToggle />
              <Button asChild size="sm" className="flex-1">
                <Link to="/login">{t('nav.signIn')}</Link>
              </Button>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t border-bg-elevated bg-bg-surface">
        <div className="max-w-screen-xl mx-auto px-5 sm:px-8 py-14">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
            <div className="col-span-2 md:col-span-2">
              <Link to="/" className="flex items-center gap-2 mb-4">
                <LogoMark className="h-8 w-8" />
                <span className="font-extrabold text-ink">Elo<span className="text-brand">Peak</span></span>
              </Link>
              <p className="text-sm text-ink-secondary max-w-xs leading-relaxed mb-4">
                {t('footer.tagline')}
              </p>
              <div className="flex items-center gap-2 text-xs font-semibold text-success bg-success/10 border border-success/20 px-3 py-1.5 rounded-full w-fit">
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                {t('footer.available247')}
              </div>
            </div>

            {[
              { title: t('footer.services'), links: [
                { href: '/orders/new?service=elo_boost',          label: t('footer.eloBoost') },
                { href: '/orders/new?service=win_boost',          label: t('footer.winBoost') },
                { href: '/orders/new?service=placement_matches',  label: t('footer.md5')      },
                { href: '/orders/new?service=coaching',           label: t('footer.coaching') },
              ]},
              { title: t('footer.company'), links: [
                { href: '/pricing',   label: t('footer.pricing')  },
                { href: '/security',  label: t('footer.security') },
                { href: '/faq',       label: t('footer.faq')      },
                { href: '/boosters',  label: t('nav.boosters')    },
              ]},
            ].map(({ title, links }) => (
              <div key={title}>
                <p className="section-label mb-4">{title}</p>
                <ul className="space-y-2.5">
                  {links.map(({ href, label }) => (
                    <li key={href}>
                      <Link to={href} className="text-sm text-ink-secondary hover:text-ink transition-colors">{label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-12 pt-6 border-t border-bg-elevated flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-xs text-ink-muted">{t('footer.copyright', { year: new Date().getFullYear() })}</p>
            <div className="flex items-center gap-5">
              <Link to="/privacy" className="text-xs text-ink-muted hover:text-ink-secondary">{t('footer.privacy')}</Link>
              <Link to="/terms"   className="text-xs text-ink-muted hover:text-ink-secondary">{t('footer.terms')}</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
