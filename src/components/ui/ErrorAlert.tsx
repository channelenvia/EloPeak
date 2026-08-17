import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

// Substitui o padrão ad-hoc de `<p className="text-xs text-danger">{msg}</p>`
// espalhado pelas telas — um único componente pra toda mensagem de erro
// exibida ao usuário, com ícone e estilo consistentes.
export function ErrorAlert({ message, className }: { message: string; className?: string }) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger',
        className,
      )}
    >
      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  )
}
