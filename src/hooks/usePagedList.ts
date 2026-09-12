import { useEffect, useState } from 'react'

// Pagina uma lista já carregada no cliente (nada de servidor) -- usado pelas
// telas admin/booster que viraram grids de cards (Boosters, Customers,
// Payments, Payouts, Refunds, Drops, DuoAccounts etc.) pra limitar a página a
// ~4-5 linhas em vez de empilhar todas as instâncias de uma vez. `resetKey`
// é opcional: passe o valor de um filtro pra voltar à página 1 quando ele mudar.
export function usePagedList<T>(items: T[], pageSize = 20, resetKey?: unknown) {
  const [page, setPage] = useState(1)
  useEffect(() => { setPage(1) }, [resetKey])

  const pageItems = items.slice((page - 1) * pageSize, page * pageSize)
  const hasNextPage = page * pageSize < items.length

  return {
    page,
    pageItems,
    hasNextPage,
    onPrev: () => setPage((p) => p - 1),
    onNext: () => setPage((p) => p + 1),
  }
}
