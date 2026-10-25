import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { lookupDuoAccountRiotRank } from '@/api/duoAccounts'
import { RIOT_ID_FORMAT } from '@/lib/boostDomain'

export type RiotRankResult = Awaited<ReturnType<typeof lookupDuoAccountRiotRank>>

interface Args {
  getRiotId: () => string
  applyRank: (result: RiotRankResult) => void
}

export function useDuoRiotLookup({ getRiotId, applyRank }: Args) {
  const [riotVerified, setRiotVerified] = useState(false)
  const [riotLookupError, setRiotLookupError] = useState<string | null>(null)
  const [riotLookupMessage, setRiotLookupMessage] = useState<string | null>(null)

  const lookupRiot = useMutation({
    meta: { silentError: true }, // erro mostrado inline pela própria tela
    mutationFn: async () => {
      const trimmed = getRiotId().trim()
      if (!RIOT_ID_FORMAT.test(trimmed)) throw new Error('Riot ID inválido. Use o formato Nome#TAG (ex.: Fulano#BR1).')
      return lookupDuoAccountRiotRank(trimmed)
    },
    onSuccess: (result) => {
      setRiotLookupError(null)
      if (!result.found || !result.ranked || !result.tier) {
        setRiotLookupMessage(null)
        setRiotLookupError(!result.found ? 'Conta Riot não encontrada.' : 'Conta sem rank nesta fila — contas Duo precisam de um rank definido.')
        return
      }
      applyRank(result)
      setRiotLookupMessage(result.message ?? 'Rank preenchido automaticamente a partir da Riot.')
      setRiotVerified(true)
    },
    onError: (err) => {
      setRiotVerified(false)
      setRiotLookupMessage(null)
      setRiotLookupError(err instanceof Error ? err.message : 'Não foi possível consultar a Riot agora.')
    },
  })

  function resetLookup(verified: boolean) {
    setRiotVerified(verified)
    setRiotLookupError(null)
    setRiotLookupMessage(null)
  }

  return { lookupRiot, riotVerified, riotLookupError, riotLookupMessage, resetLookup }
}
