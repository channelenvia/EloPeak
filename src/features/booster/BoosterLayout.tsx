import { Link } from 'react-router-dom'
import { LayoutDashboard, Briefcase, ClipboardList, Wrench, Landmark, Wallet } from 'lucide-react'
import { LogoMark, PageLoader } from '@/components/ui'
import { UserAccountBadge } from '@/components/UserAccountBadge'
import { useAuthStore } from '@/stores/authStore'
import { AppShell } from '@/components/layout/AppShell'
import type { SidebarNavItem } from '@/components/layout/AppSidebar'
import { useBoosterStatus, useBoosterHeartbeat } from '@/api/boosters'
import { PendingScreen, RejectedScreen, SuspendedScreen, RemovedScreen, NoApplicationScreen, BoosterStatusErrorScreen } from '@/features/booster/components/BoosterStatusScreens'
import { useNewOrderSound } from '@/features/booster/hooks/useNewOrderSound'
import { useChatMentionSound } from '@/hooks/useChatMentionSound'

const NAV_ITEMS: SidebarNavItem[] = [
  { href: '/booster',          icon: LayoutDashboard, label: 'Painel'     },
  { href: '/booster/jobs',     icon: Briefcase,       label: 'Jobs'       },
  { href: '/booster/orders',   icon: ClipboardList,   label: 'Pedidos'    },
  { href: '/booster/payments', icon: Wallet,          label: 'Pagamentos' },
  { href: '/booster/services', icon: Wrench,          label: 'Serviços'   },
  { href: '/booster/accounts', icon: Landmark,        label: 'Contas'     },
]

function ApprovedBoosterPanel() {
  useNewOrderSound()
  useChatMentionSound()
  useBoosterHeartbeat(true)

  return (
    <AppShell
      scope="booster"
      homeHref="/booster"
      sections={[{ items: NAV_ITEMS }]}
      roleBadge={{ label: 'Booster', className: 'bg-success/15 text-success border-success/25' }}
      navLabel="Navegação do booster"
    />
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
        <Link to="/" className="flex items-center gap-3">
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
