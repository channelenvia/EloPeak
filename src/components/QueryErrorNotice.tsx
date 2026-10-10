import { Button, ErrorAlert } from '@/components/ui'

interface QueryErrorNoticeProps {
  isError: boolean
  error: unknown
  onRetry: () => unknown
}

// Antes, varias telas so tratavam isLoading: uma falha de rede/permissao virava uma lista vazia e o usuario achava que
// nao havia dados. Mostra o erro e deixa tentar de novo (nada quando a consulta esta ok).
export function QueryErrorNotice({ isError, error, onRetry }: QueryErrorNoticeProps) {
  if (!isError) return null
  return (
    <div className="space-y-2" role="alert">
      <ErrorAlert message={error instanceof Error ? error.message : 'Não foi possível carregar os dados.'} />
      <Button variant="secondary" size="sm" onClick={() => void onRetry()}>Tentar de novo</Button>
    </div>
  )
}
