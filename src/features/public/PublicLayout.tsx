import { Outlet, Link, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Menu, MessageCircle, X } from 'lucide-react'
import { Button, LogoMark } from '@/components/ui'
import { AmbientBackground } from '@/components/AmbientBackground'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'

const DISCORD_SUPPORT_URL = import.meta.env.VITE_DISCORD_TICKET_URL as string | undefined

export function PublicLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { pathname } = useLocation()
  const { isAuthenticated, profile } = useAuthStore()
  const { t } = useTranslation()

  const dashboardLink =
    profile?.role === 'admin' ? '/admin'
    : profile?.role === 'booster' ? '/booster'
    : '/dashboard'

  return (
    <AmbientBackground>
    <div className="min-h-screen flex flex-col">
      {/* Navbar */}
      <header className="sticky top-0 z-50 border-b border-border-subtle/60 bg-bg-base/90 backdrop-blur-xl">
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
            {[
              { href: '/services',  label: t('nav.services')  },
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
          <div className="lg:hidden border-t border-border-subtle bg-bg-surface/90 backdrop-blur-xl px-5 py-5 space-y-1 animate-slide-down">
            {[
              { href: '/services',  label: t('nav.services')      },
              { href: '/pricing',   label: t('nav.pricing')       },
              { href: '/security',  label: t('nav.security')      },
              { href: '/faq',       label: t('nav.faq')           },
              { href: '/boosters',  label: t('nav.boosters')      },
              { href: '/apply?booster=1', label: t('nav.applyBooster')  },
            ].map(({ href, label }) => (
              <Link key={href} to={href} onClick={() => setMobileOpen(false)}
                className="block px-3 py-2.5 rounded-xl text-sm text-ink-secondary hover:text-ink hover:bg-bg-elevated"
              >
                {label}
              </Link>
            ))}
            <div className="pt-3 flex gap-2">
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
      <footer className="border-t border-border-subtle bg-bg-surface/80 backdrop-blur-md">
        <div className="max-w-screen-xl mx-auto px-5 sm:px-8 py-8">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
            <div className="col-span-2 md:col-span-2">
              <Link to="/" className="flex items-center gap-2 mb-2.5">
                <LogoMark className="h-8 w-8" />
                <span className="font-extrabold text-ink">Elo<span className="text-brand">Peak</span></span>
              </Link>
              <p className="text-sm text-ink-secondary max-w-xs leading-relaxed mb-2.5">
                {t('footer.tagline')}
              </p>
            </div>

            {[
              { title: t('footer.services'), links: [
                { href: '/services#elo-boost', label: t('footer.eloBoost') },
                { href: '/services#win-boost', label: t('footer.winBoost') },
                { href: '/services#coaching',  label: t('footer.coaching') },
                { href: '/services#clash',     label: t('footer.clash')    },
              ]},
              { title: t('footer.company'), links: [
                { href: '/pricing',   label: t('footer.pricing')  },
                { href: '/security',  label: t('footer.security') },
                { href: '/faq',       label: t('footer.faq')      },
                { href: '/boosters',  label: t('nav.boosters')    },
              ]},
            ].map(({ title, links }) => (
              <div key={title}>
                <p className="section-label mb-2.5">{title}</p>
                <ul className="space-y-2">
                  {links.map(({ href, label }) => (
                    <li key={href}>
                      <Link to={href} className="text-sm text-ink-secondary hover:text-ink transition-colors">{label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <div className="col-span-2 md:col-span-1">
              <p className="section-label mb-2.5">{t('footer.needHelp')}</p>
              <p className="text-sm text-ink-secondary leading-relaxed mb-3">
                {t('footer.supportDescription')}
              </p>
              {DISCORD_SUPPORT_URL && (
                <a
                  href={DISCORD_SUPPORT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:text-brand/80 transition-colors"
                >
                  <MessageCircle className="h-4 w-4 shrink-0" />
                  {t('footer.joinDiscord')}
                </a>
              )}
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-border-subtle flex flex-col md:flex-row items-center justify-between gap-3">
            <p className="text-xs text-ink-muted">{t('footer.copyright', { year: new Date().getFullYear() })}</p>
            <div className="flex items-center gap-5">
              <Link to="/privacy" className="text-xs text-ink-muted hover:text-ink-secondary">{t('footer.privacy')}</Link>
              <Link to="/terms"   className="text-xs text-ink-muted hover:text-ink-secondary">{t('footer.terms')}</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
    </AmbientBackground>
  )
}
