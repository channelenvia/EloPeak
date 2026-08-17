import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ShieldAlert, X } from 'lucide-react'

// RequireAuth (routeGuards.tsx) redireciona silenciosamente quando o papel
// do usuário não bate com a rota -- sem isso, um leitor de tela não anuncia
// nada, só "a página mudou". Lê o motivo via location.state e anuncia via
// role="status" (não precisa de foco, só entra na fila de anúncios).
export function RoleRedirectNotice() {
  const location = useLocation()
  const [dismissed, setDismissed] = useState(false)
  const reason = (location.state as { accessDeniedReason?: string } | null)?.accessDeniedReason

  if (!reason || dismissed) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 bg-warning/10 border-b border-warning/20 text-warning text-xs font-medium px-4 py-2"
    >
      <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">{reason}</span>
      <button
        type="button"
        aria-label="Dispensar aviso"
        onClick={() => setDismissed(true)}
        className="focus-ring rounded p-0.5 hover:text-warning/80"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
