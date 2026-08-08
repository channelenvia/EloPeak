import { useState } from 'react'
import { Avatar } from '@/components/ui'
import { NotificationBell } from '@/components/NotificationBell'
import { UserProfilePanel } from '@/components/UserProfilePanel'
import { useAuthStore } from '@/stores/authStore'

interface UserAccountBadgeProps {
  /** Esconde o sino de notificações — usado nas telas restritas (pendente/rejeitado/erro). */
  showNotifications?: boolean
  avatarSize?: 'sm' | 'md'
}

/**
 * Bloco de controles do topo (notificações + avatar) que abre o popover
 * de conta pessoal. Reaproveitado por BoosterLayout, CustomerLayout e
 * AdminLayout — antes duplicado em cada um.
 */
export function UserAccountBadge({ showNotifications = true, avatarSize = 'sm' }: UserAccountBadgeProps) {
  const { profile } = useAuthStore()
  const [panelOpen, setPanelOpen] = useState(false)

  return (
    <div className="flex items-center gap-2">
      {showNotifications && <NotificationBell />}
      <button
        onClick={() => setPanelOpen(true)}
        className="rounded-full hover:ring-2 hover:ring-brand/40 transition-all"
      >
        <Avatar src={profile?.avatar_url} name={profile?.username} size={avatarSize} />
      </button>
      <UserProfilePanel open={panelOpen} onClose={() => setPanelOpen(false)} />
    </div>
  )
}
