import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { Avatar, LogoMark } from '@/components/ui'
import { NotificationBell } from '@/components/NotificationBell'
import { UserProfilePanel } from '@/components/UserProfilePanel'

export interface SidebarNavItem {
  href: string
  icon: LucideIcon
  label: string
  /** Sobrescreve a detecção padrão de rota ativa (ex.: evitar colisão entre "/orders" e "/orders/new"). */
  isActive?: (pathname: string) => boolean
}

export interface SidebarNavSection {
  label?: string
  items: SidebarNavItem[]
}

interface AppSidebarProps {
  /** Escopo usado pelo useSidebarCollapse — mantém a preferência de recolher independente por painel. */
  scope: 'customer' | 'booster' | 'admin'
  sections: SidebarNavSection[]
  /** Rota do dashboard/raiz do painel — evita que o item de início fique ativo em toda sub-rota. */
  homeHref: string
  roleBadge?: { label: string; className: string }
  breakpoint?: 'md' | 'lg'
}

function defaultIsActive(pathname: string, href: string, homeHref: string): boolean {
  if (pathname === href) return true
  if (href === homeHref) return false
  return pathname.startsWith(`${href}/`)
}

/**
 * Sidebar única reaproveitada pelos painéis de cliente, booster e admin.
 * Antes cada layout duplicava essa estrutura inteira; unificar evita que o
 * bloco de conta (avatar/username/notificações) ficasse dessincronizado
 * entre os três painéis.
 *
 * Sempre ocupa só a largura do rail (ícones) no fluxo da página -- a coluna
 * de conteúdo principal nunca varia de largura. Passar o mouse abre um
 * overlay `fixed` por cima do conteúdo com o menu completo (rótulos,
 * conta, notificações); tirar o mouse fecha sozinho. Sem preferência
 * persistida pra lembrar -- é sempre hover, nunca um estado "fixado".
 */
export function AppSidebar({ scope: _scope, sections, homeHref, roleBadge, breakpoint = 'md' }: AppSidebarProps) {
  const { pathname } = useLocation()
  const { profile } = useAuthStore()
  const [expanded, setExpanded] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)

  return (
    <aside
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      className={cn('hidden shrink-0', breakpoint === 'lg' ? 'lg:block' : 'md:block')}
    >
      {/* Rail -- sempre no fluxo normal, nunca muda de largura. */}
      <div className="w-[76px] h-full" />

      <div className={cn(
        'flex flex-col border-r border-bg-elevated bg-bg-surface/95 backdrop-blur-md',
        'fixed inset-y-0 z-40 transition-all duration-200 overflow-hidden',
        expanded ? 'w-64' : 'w-[76px]',
      )}>
        {/* Topo: logo (+ badge de papel só quando expandido). */}
        <div className={cn(
          'h-[68px] flex items-center border-b border-bg-elevated shrink-0',
          expanded ? 'justify-between px-4' : 'justify-center px-2',
        )}>
          <Link to="/" className="flex items-center gap-2 min-w-0" title="EloPeak">
            <LogoMark className={cn('shrink-0', expanded ? 'h-8 w-8' : 'h-7 w-7')} />
            {expanded && (
              <span className="font-bold text-ink truncate">
                Elo<span className="text-brand">Peak</span>
              </span>
            )}
          </Link>
          {expanded && roleBadge && (
            <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-md border shrink-0', roleBadge.className)}>
              {roleBadge.label}
            </span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-5 space-y-6 overflow-y-auto">
          {sections.map((section, idx) => (
            <div key={section.label ?? idx}>
              {expanded && section.label && <p className="section-label px-3 mb-2">{section.label}</p>}
              <div className="space-y-0.5">
                {section.items.map(({ href, icon: Icon, label, isActive }) => {
                  const active = isActive ? isActive(pathname) : defaultIsActive(pathname, href, homeHref)
                  return (
                    <Link
                      key={href}
                      to={href}
                      title={expanded ? undefined : label}
                      className={cn(
                        'flex items-center gap-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150',
                        expanded ? 'px-3' : 'justify-center px-2',
                        active
                          ? 'bg-brand/15 text-brand border border-brand/20'
                          : 'text-ink-secondary hover:text-ink hover:bg-bg-elevated border border-transparent',
                      )}
                    >
                      <Icon className="h-[18px] w-[18px] shrink-0" />
                      {expanded && <span className="truncate">{label}</span>}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Rodapé: avatar sempre visível (mesmo no rail recolhido, como o
            resto dos ícones de navegação) -- username e notificações só
            aparecem junto no overlay expandido. */}
        <div className="border-t border-bg-elevated shrink-0 p-3">
          {expanded ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPanelOpen(true)}
                className="flex items-center gap-2 flex-1 min-w-0 rounded-xl px-2 py-1.5 hover:bg-bg-elevated transition-colors text-left"
              >
                <Avatar src={profile?.avatar_url} name={profile?.username} size="sm" />
                <span className="text-sm font-medium text-ink truncate">{profile?.username ?? 'Usuário'}</span>
              </button>
              <NotificationBell />
            </div>
          ) : (
            <button
              onClick={() => setPanelOpen(true)}
              className="flex w-full items-center justify-center rounded-full hover:ring-2 hover:ring-brand/40 transition-all"
              title={profile?.username ?? 'Perfil'}
            >
              <Avatar src={profile?.avatar_url} name={profile?.username} size="sm" />
            </button>
          )}
        </div>
      </div>

      <UserProfilePanel open={panelOpen} onClose={() => setPanelOpen(false)} />
    </aside>
  )
}
