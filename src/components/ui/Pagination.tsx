import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './Button'

interface PaginationProps {
  page: number
  hasNextPage: boolean
  onPrev: () => void
  onNext: () => void
}

// Sempre passa pra frente no tempo -- "Próxima" mostra os pedidos mais
// antigos (a lista é ordenada por data), nunca itens novos entrando no meio
// da paginação.
export function Pagination({ page, hasNextPage, onPrev, onNext }: PaginationProps) {
  if (page === 1 && !hasNextPage) return null

  return (
    <div className="flex items-center justify-center gap-3 pt-2">
      <Button type="button" variant="outline" size="sm" onClick={onPrev} disabled={page === 1}>
        <ChevronLeft className="h-4 w-4" />
        Anterior
      </Button>
      <span className="text-xs text-ink-muted">Página {page}</span>
      <Button type="button" variant="outline" size="sm" onClick={onNext} disabled={!hasNextPage}>
        Próxima
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}
