import { Outlet, Link, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { Menu, MessageCircle, X } from 'lucide-react'
import { Button, LogoMark } from '@/components/ui'
import { AmbientBackground } from '@/components/AmbientBackground'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { DISCORD_SUPPORT_URL } from '@/lib/discordSupport'

export function PublicLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { pathname } = useLocation()
  const { isAuthenticated, profile } = useAuthStore()

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
              { href: '/services',  label: 'Serviços' },
              { href: '/pricing',   label: 'Preços'   },
              { href: '/security',  label: 'Segurança' },
              { href: '/faq',       label: 'FAQ'       },
              { href: '/boosters',  label: 'Boosters'  },
            ].map(({ href, label }) => (
              <Link key={href} to={href}
                aria-current={pathname === href ? 'page' : undefined}
                className={cn('px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  pathname === href ? 'text-ink bg-bg-raised' : 'text-ink-secondary hover:text-ink hover:bg-bg-raised/60'
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
                <Link to={dashboardLink}>Painel</Link>
              </Button>
            ) : (
              <Button asChild size="sm">
                <Link to="/login">Entrar</Link>
              </Button>
            )}
          </div>

          {/* Mobile toggle */}
          <button
            className="lg:hidden ml-auto p-2 rounded-lg text-ink-secondary hover:bg-bg-raised"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Menu"
            aria-expanded={mobileOpen}
            aria-controls="public-mobile-nav"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div id="public-mobile-nav" className="lg:hidden border-t border-border-subtle bg-bg-surface/90 backdrop-blur-xl px-5 py-5 space-y-1 animate-slide-down">
            {[
              { href: '/services',  label: 'Serviços' },
              { href: '/pricing',   label: 'Preços'    },
              { href: '/security',  label: 'Segurança' },
              { href: '/faq',       label: 'FAQ'       },
              { href: '/boosters',  label: 'Boosters'  },
              { href: '/apply?booster=1', label: 'Seja um Booster' },
            ].map(({ href, label }) => (
              <Link key={href} to={href} onClick={() => setMobileOpen(false)}
                aria-current={pathname === href ? 'page' : undefined}
                className="block px-3 py-2.5 rounded-xl text-sm text-ink-secondary hover:text-ink hover:bg-bg-raised"
              >
                {label}
              </Link>
            ))}
            <div className="pt-3 flex gap-2">
              <Button asChild size="sm" className="flex-1">
                <Link to="/login">Entrar</Link>
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
                Serviços de gaming profissionais. Seguro, rápido e garantido.
              </p>
            </div>

            {[
              { title: 'Serviços', links: [
                { href: '/services#elo-boost', label: 'Elo Boost' },
                { href: '/services#win-boost', label: 'Win Boost' },
                { href: '/services#coaching',  label: 'Coaching' },
                { href: '/services#clash',     label: 'Clash'    },
              ]},
              { title: 'Empresa', links: [
                { href: '/pricing',   label: 'Preços'    },
                { href: '/security',  label: 'Segurança' },
                { href: '/faq',       label: 'FAQ'       },
                { href: '/boosters',  label: 'Boosters'  },
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
              <p className="section-label mb-2.5">Precisa de ajuda?</p>
              <p className="text-sm text-ink-secondary leading-relaxed mb-3">
                Nossa equipe de suporte está disponível 24 horas por dia para ajudar com qualquer dúvida ou problema.
              </p>
              {DISCORD_SUPPORT_URL && (
                <a
                  href={DISCORD_SUPPORT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:text-brand/80 transition-colors"
                >
                  <MessageCircle className="h-4 w-4 shrink-0" />
                  Entrar no Discord
                </a>
              )}
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-border-subtle flex flex-col md:flex-row items-center justify-between gap-3">
            <p className="text-xs text-ink-muted">© {new Date().getFullYear()} EloPeak. Todos os direitos reservados.</p>
            <div className="flex items-center gap-5">
              <Link to="/privacy" className="text-xs text-ink-muted hover:text-ink-secondary">Privacidade</Link>
              <Link to="/terms"   className="text-xs text-ink-muted hover:text-ink-secondary">Termos</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
    </AmbientBackground>
  )
}
