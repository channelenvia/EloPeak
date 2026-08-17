import { useState } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, Briefcase, ClipboardList, Wrench, Landmark, Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LogoMark, PageLoader, Avatar } from '@/components/ui'
import { useTranslation } from 'react-i18next'
import { UserAccountBadge } from '@/components/UserAccountBadge'
import { UserProfilePanel } from '@/components/UserProfilePanel'
import { NotificationBell } from '@/components/NotificationBell'
import { RoleRedirectNotice } from '@/components/RoleRedirectNotice'
import { useAuthStore } from '@/stores/authStore'
import { AppSidebar, type SidebarNavSection } from '@/components/layout/AppSidebar'
import { useBoosterStatus, useBoosterHeartbeat } from '@/api/boosters'
import { PendingScreen, RejectedScreen, SuspendedScreen, RemovedScreen, NoApplicationScreen, BoosterStatusErrorScreen } from '@/features/booster/components/BoosterStatusScreens'
import { useNewOrderSound } from '@/features/booster/hooks/useNewOrderSound'

function ApprovedBoosterPanel() {
  const { pathname } = useLocation()
  const { profile } = useAuthStore()
  const { t } = useTranslation()
  const [panelOpen, setPanelOpen] = useState(false)
  useNewOrderSound()
  useBoosterHeartbeat(true)

  const navItems = [
    { href: '/booster',          icon: LayoutDashboard, label: t('booster.nav.dashboard') },
    { href: '/booster/jobs',     icon: Briefcase,        label: t('booster.nav.jobs')      },
    { href: '/booster/orders',   icon: ClipboardList,    label: t('booster.nav.orders')    },
    { href: '/booster/payments', icon: Wallet,           label: t('booster.nav.payments')  },
    { href: '/booster/services', icon: Wrench,           label: t('booster.nav.services')  },
    { href: '/booster/accounts', icon: Landmark,         label: t('booster.nav.accounts')  },
  ]
  const sections: SidebarNavSection[] = [{ items: navItems }]

  return (
    <div className="h-screen overflow-hidden flex">
      <AppSidebar
        scope="booster"
        homeHref="/booster"
        sections={sections}
        roleBadge={{ label: t('booster.nav.role'), className: 'bg-success/15 text-success border-success/25' }}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <RoleRedirectNotice />
        {/* Largura padronizada — mesma régua do painel de cliente e admin. */}
        <main className="flex-1 overflow-auto p-6 lg:p-9">
          <div className="mx-auto w-full max-w-[1600px]">
            <Outlet />
          </div>
        </main>

        <nav className="md:hidden border-t border-border-subtle bg-bg-surface/90 backdrop-blur-xl flex shrink-0" aria-label="Navegação do booster">
          {navItems.map(({ href, icon: Icon, label }) => {
            const active = pathname === href || (href !== '/booster' && pathname.startsWith(href))
            return (
              <Link
                key={href}
                to={href}
                className={cn(
                  'flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-3 text-[10px] font-semibold',
                  active ? 'text-brand' : 'text-ink-muted',
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="w-full truncate text-center">{label}</span>
              </Link>
            )
          })}
          {/* Notificações -- antes o sino não tinha nenhum caminho no mobile. */}
          <div className="flex min-w-0 flex-1 items-center justify-center">
            <NotificationBell />
          </div>
          {/* Perfil/notificações no mobile -- antes vinham do header, removido. */}
          <button
            onClick={() => setPanelOpen(true)}
            className="flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-3 text-[10px] font-semibold text-ink-muted"
          >
            <Avatar src={profile?.avatar_url} name={profile?.username} size="xs" />
            <span className="w-full truncate text-center">Perfil</span>
          </button>
        </nav>
      </div>

      <UserProfilePanel open={panelOpen} onClose={() => setPanelOpen(false)} />
    </div>
  )
}

// Ordem fixa exigida pelo produto: Painel, Jobs, Pedidos, Serviços, Contas, Pagamentos.
// Não existe item de "Meu Perfil" — dados pessoais ficam só no popover do
// UserAccountBadge, dados profissionais ficam em Serviços.
export function BoosterLayout() {
  const { profile } = useAuthStore()
  const { data: access, isLoading } = useBoosterStatus(profile?.id)

  // Still loading — wait
  if (isLoading || !access) return <PageLoader />
  const state = access.state

  // Telas de status de candidatura (pendente/rejeitado/etc.) não têm sidebar
  // de navegação -- não são o painel principal, então mantêm um cabeçalho
  // mínimo próprio só pra dar acesso a perfil/notificações/logout.
  const shell = (content: React.ReactNode) => (
    <div className="min-h-screen flex flex-col">
      <header className="h-[68px] flex items-center justify-between px-6 border-b border-border-subtle bg-bg-surface/80 backdrop-blur-md shrink-0">
        <Link to="/" className="flex items-center gap-2.5">
          <LogoMark className="h-8 w-8 shrink-0" />
          <span className="font-bold text-ink">Elo<span className="text-brand">Peak</span></span>
        </Link>
        <UserAccountBadge showNotifications={false} />
      </header>
      <main className="flex-1 flex items-center justify-center p-6">{content}</main>
    </div>
  )

  if (state === 'no_application') return shell(<NoApplicationScreen />)
  if (state === 'pending') return shell(<PendingScreen />)
  if (state === 'rejected') return shell(<RejectedScreen />)
  if (state === 'suspended') return shell(<SuspendedScreen suspendedUntil={access.suspendedUntil} />)
  if (state === 'removed') return shell(<RemovedScreen />)
  if (state === 'error') return shell(<BoosterStatusErrorScreen />)

  return <ApprovedBoosterPanel />
}
