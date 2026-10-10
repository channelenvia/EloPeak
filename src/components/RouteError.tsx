import { useEffect } from 'react'
import { isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { Button } from '@/components/ui/Button'

const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i
const RELOAD_FLAG = 'route-error-reloaded'

// errorElement das rotas: antes qualquer erro (inclusive chunk lazy inexistente depois de um deploy) mostrava a
// tela padrao do React Router. Erro de chunk recarrega a pagina uma vez; o resto mostra uma tela amigavel.
export function RouteError() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : String(error)
  const isChunkError = CHUNK_ERROR.test(message)

  useEffect(() => {
    if (!isChunkError) return
    try {
      if (sessionStorage.getItem(RELOAD_FLAG)) return
      sessionStorage.setItem(RELOAD_FLAG, '1')
    } catch {
      return
    }
    window.location.reload()
  }, [isChunkError])

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-xl font-bold text-ink">Algo deu errado ao carregar esta página</h1>
        <p className="text-sm text-ink-secondary">
          {isChunkError
            ? 'Uma nova versão do site foi publicada. Recarregue para continuar.'
            : 'Tente recarregar. Se continuar, fale com o suporte.'}
        </p>
        <Button onClick={() => window.location.reload()}>Recarregar</Button>
      </div>
    </div>
  )
}
