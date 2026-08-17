import { useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Pin, PinOff, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { useSidebarStore } from '@/stores/sidebarStore'
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
 * "Precision Rail" -- sidebar única reaproveitada pelos painéis de cliente,
 * booster e admin. Antes cada layout duplicava essa estrutura inteira;
 * unificar evita que o bloco de conta (avatar/username/notificações) ficasse
 * dessincronizado entre os três painéis.
 *
 * Sempre ocupa só a largura do rail (ícones) no fluxo da página -- a coluna
 * de conteúdo principal nunca varia de largura. Expande por 3 caminhos
 * independentes, cada um resolvendo uma lacuna real do modelo anterior
 * (hover-only):
 *  1. hover (mouse) -- comportamento original, inalterado pra quem usa mouse;
 *  2. foco de teclado (Tab) -- expande via onFocus/onBlur no <aside> inteiro
 *     (equivalente a :focus-within), senão navegar só de teclado nunca
 *     revelava os rótulos;
 *  3. pin (clique/toque) -- estado persistido (useSidebarStore), único
 *     caminho realista em tablet/touch, que não tem hover.
 */
export function AppSidebar({ scope: _scope, sections, homeHref, roleBadge, breakpoint = 'md' }: AppSidebarProps) {
  const { pathname } = useLocation()
  const { profile } = useAuthStore()
  const { pinned, togglePinned } = useSidebarStore()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const asideRef = useRef<HTMLElement>(null)
  const expanded = pinned || hovered || focused

  return (
    <aside
      ref={asideRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!asideRef.current?.contains(e.relatedTarget as Node | null)) setFocused(false)
      }}
      className={cn('hidden shrink-0', breakpoint === 'lg' ? 'lg:block' : 'md:block')}
    >
      {/* Rail -- sempre no fluxo normal, nunca muda de largura. */}
      <div className="w-[76px] h-full" />

      <div className={cn(
        'flex flex-col border-r border-border-subtle bg-bg-surface/95 backdrop-blur-md',
        'fixed inset-y-0 z-40 transition-all duration-panel ease-out overflow-hidden',
        expanded ? 'w-64' : 'w-[76px]',
      )}>
        {/* Topo: logo (+ badge de papel + pin só quando expandido). */}
        <div className={cn(
          'h-[68px] flex items-center border-b border-border-subtle shrink-0',
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
          {expanded && (
            <div className="flex items-center gap-1.5 shrink-0">
              {roleBadge && (
                <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-md border', roleBadge.className)}>
                  {roleBadge.label}
                </span>
              )}
              <button
                type="button"
                onClick={togglePinned}
                title={pinned ? 'Desafixar menu' : 'Fixar menu expandido'}
                className="focus-ring p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-bg-interactive transition-colors"
              >
                {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
              </button>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-5 space-y-6 overflow-y-auto">
          {sections.map((section, idx) => (
            <div key={section.label ?? idx} className={cn(idx > 0 && expanded && 'pt-5 border-t border-border-subtle')}>
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
                        'focus-ring relative flex items-center gap-3 py-2.5 rounded-xl text-sm font-medium transition-colors duration-fast',
                        expanded ? 'px-3' : 'justify-center px-2',
                        active ? 'text-brand' : 'text-ink-secondary hover:text-ink hover:bg-bg-interactive',
                      )}
                    >
                      {/* Indicador de ativo -- traço verde na borda, nunca
                          preenchimento cheio (disciplina de glow: restrito). */}
                      {active && (
                        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-brand" />
                      )}
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
        <div className="border-t border-border-subtle shrink-0 p-3">
          {expanded ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPanelOpen(true)}
                className="focus-ring flex items-center gap-2 flex-1 min-w-0 rounded-xl px-2 py-1.5 hover:bg-bg-interactive transition-colors text-left"
              >
                <Avatar src={profile?.avatar_url} name={profile?.username} size="sm" />
                <span className="text-sm font-medium text-ink truncate">{profile?.username ?? 'Usuário'}</span>
              </button>
              <NotificationBell />
            </div>
          ) : (
            <button
              onClick={() => setPanelOpen(true)}
              className="focus-ring flex w-full items-center justify-center rounded-full hover:ring-2 hover:ring-brand/40 transition-all"
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
