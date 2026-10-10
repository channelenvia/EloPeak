import { useState } from 'react'
import { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction'
import { isMasterPlusCurrentTier, RIOT_ID_FORMAT } from '@/lib/boostDomain'
import type { Division, QueueType, RankTier } from '@/types'

type RiotRankResponse = {
  found?: boolean
  ranked?: boolean
  tier?: RankTier
  division?: Division | null
  league_points?: number
  avg_lp_gain?: number | null
  avg_lp_loss?: number | null
  md5_eligible?: boolean
  matches_remaining?: number
  message?: string
}

function fetchRiotRank(riotId: string, queue: QueueType) {
  return invokeEdgeFunction<RiotRankResponse>('riot-account-rank', {
    body: { riot_id: riotId, queue },
    requireAuth: true,
  })
}

// Consulta do rank na Riot (elo_boost e win_boost/md5) + mensagens de
// retorno + migração de elo_boost unranked para MD5.
export function useRiotLookup() {
  const {
    riotId, riotLookupLoading, queueType,
    setService, setCurrentRank, setCurrentLp, setAvgLpGain, setAvgLpLoss,
    setCurrentPdl, setAvgPdlGain, setAvgPdlLoss,
    setIsMd5, setMd5MatchesRemainingFromApi, setMd5Blocked,
    setRiotAutoFilled, setRiotVerified, clearRiotLookup, setRiotLookupLoading, setRankDeclared,
  } = useOrderBuilderStore()

  const [riotLookupMessage, setRiotLookupMessage] = useState<string | null>(null)
  const [riotLookupError, setRiotLookupError] = useState<string | null>(null)
  const [md5Message, setMd5Message] = useState<string | null>(null)
  // Oferta de migração pra MD5 quando o eloboost dá unranked na fila — guarda
  // as partidas restantes detectadas pela Riot; null quando não há oferta.
  const [unrankedOffer, setUnrankedOffer] = useState<{ matchesRemaining: number } | null>(null)
  // A Riot nao tem rank nesta conta/fila: o cliente pode informar o elo manualmente (pedido vai marcado para o admin conferir).
  const [manualRankOffer, setManualRankOffer] = useState(false)

  function resetLookupMessages() {
    setRiotLookupMessage(null)
    setRiotLookupError(null)
    setMd5Message(null)
    setUnrankedOffer(null)
    setManualRankOffer(false)
  }

  // Preâmbulo comum às duas consultas (valida o Riot ID, zera o resultado
  // anterior, chama a Riot e traduz erro/"não encontrada"); null = já tratado.
  async function runLookup(): Promise<RiotRankResponse | null> {
    if (riotLookupLoading) return null
    const trimmed = riotId.trim()
    resetLookupMessages()
    if (!RIOT_ID_FORMAT.test(trimmed)) {
      setRiotLookupError('Riot ID inválido. Use o formato Nome#TAG (ex.: Fulano#BR1).')
      return null
    }
    // Zera qualquer resultado da conta consultada antes — o rank novo (ou a
    // ausência dele, se unranked) substitui totalmente o anterior.
    clearRiotLookup()

    let result: RiotRankResponse
    setRiotLookupLoading(true)
    try {
      result = await fetchRiotRank(trimmed, queueType)
    } catch (error) {
      setRiotLookupError(error instanceof Error ? error.message : 'Não foi possível consultar a Riot agora.')
      return null
    } finally {
      setRiotLookupLoading(false)
    }

    if (!result?.found) {
      setRiotLookupError('Conta Riot não encontrada.')
      return null
    }
    return result
  }

  async function lookupRiotRank() {
    const result = await runLookup()
    if (!result) return
    if (!result.ranked || !result.tier) {
      // Sem rank nesta fila — em vez de barrar, oferecemos migrar pra uma MD5
      // da MESMA fila (mesmo endpoint já devolve md5_eligible/matches_remaining).
      // O form segue travado (riotVerified false) até o usuário decidir.
      const remaining = result.matches_remaining ?? 5
      setManualRankOffer(true)
      if (remaining >= 1) setUnrankedOffer({ matchesRemaining: remaining })
      // Sem partidas de posicionamento restantes a MD5 nao existe, mas o cliente ainda pode informar o elo manualmente.
      setRiotLookupMessage('A Riot não encontrou rank nesta fila.')
      return
    }

    setCurrentRank({ tier: result.tier, division: result.division ?? null })
    if (isMasterPlusCurrentTier(result.tier)) {
      setCurrentPdl(Math.max(0, Math.min(9999, result.league_points ?? 0)))
      // Master+ nunca usa a média real vinda da Riot -- progressão comercial
      // sempre fixa em 30 PDL/partida (mesma regra do backend em orderPricing.ts).
      setAvgPdlGain(30)
      setAvgPdlLoss(30)
    } else {
      setCurrentLp(Math.max(0, Math.min(99, result.league_points ?? 0)))
      if (typeof result.avg_lp_gain === 'number') setAvgLpGain(Math.max(1, Math.min(50, result.avg_lp_gain)))
      if (typeof result.avg_lp_loss === 'number') setAvgLpLoss(Math.max(1, Math.min(50, result.avg_lp_loss)))
    }

    setRiotAutoFilled(true)
    setRiotVerified(true)
    setRiotLookupMessage(result.message ?? 'Rank atual preenchido automaticamente — você pode ajustar se quiser.')
  }

  // Migra o pedido de eloboost unranked pra uma MD5 na mesma fila, já
  // configurando riot id (mantido), fila (mantida), partidas restantes e
  // deixando o número editável. Backend revalida a elegibilidade MD5.
  function migrateToMd5() {
    if (!unrankedOffer) return
    setService('md5', 'md5')
    setMd5MatchesRemainingFromApi(unrankedOffer.matchesRemaining)
    setMd5Blocked(false)
    setRiotVerified(true)
    setUnrankedOffer(null)
    setRiotLookupMessage(null)
    setMd5Message(
      `Pedido migrado para MD5 nesta fila. Faltam ${unrankedOffer.matchesRemaining} partida(s) — ajuste o número se quiser.`,
    )
  }

  // O cliente escolheu informar o elo manualmente: libera o formulario com o seletor de rank destravado e
  // marca o pedido como "elo declarado" (aviso especial para o admin).
  function declareRankManually() {
    setRankDeclared(true)
    setRiotVerified(true)
    setRiotAutoFilled(false)
    setUnrankedOffer(null)
    setManualRankOffer(false)
    setRiotLookupMessage('Informe o seu elo abaixo. Nossa equipe vai conferir no seu Riot ID antes de iniciar o pedido.')
  }

  async function lookupForWinBoost() {
    const result = await runLookup()
    if (!result) return

    if (result.md5_eligible && (result.matches_remaining ?? 5) < 1) {
      // Sem rank na fila e sem partida de posicionamento restante: MD5 nao existe, entao o cliente informa o elo manualmente.
      setIsMd5(false)
      setMd5Blocked(false)
      setManualRankOffer(true)
      setRiotLookupMessage('A Riot não encontrou rank nesta fila.')
    } else if (result.md5_eligible) {
      // Conta ainda não rankeada nesta fila — não há "rank atual" para
      // preencher (o usuário ainda precisa escolher manualmente o rank da
      // última temporada), então a grade de rank NÃO é travada aqui.
      const remaining = result.matches_remaining ?? 5
      setIsMd5(true)
      setMd5Blocked(false)
      setRankDeclared(true) // rank da temporada passada nao existe na API: informado pelo cliente e conferido pelo admin
      // setMd5MatchesRemainingFromApi já clampa winsPurchased internamente
      // (Math.max(1, remaining)) -- um setWinsPurchased extra aqui lia
      // `winsPurchased` de uma closure obsoleta (valor de antes desta busca),
      // desfazendo o clamp correto que o setter acabou de aplicar.
      setMd5MatchesRemainingFromApi(remaining)
      setRiotVerified(true)
      setMd5Message(`MD5 ativado — faltam ${remaining} partida(s) de posicionamento.`)
    } else if (!result.tier) {
      // Sem rank na Riot e sem posicionamento restante para MD5: o cliente informa o elo manualmente.
      setManualRankOffer(true)
      setRiotLookupMessage('A Riot não encontrou rank nesta fila.')
    } else {
      // Conta já rankeada nesta fila — preenchemos o rank atual e BLOQUEAMOS o
      // MD5 (anti-fraude): não dá pra comprar garantia de placement de uma
      // conta que já saiu do posicionamento. O backend rejeita de todo jeito.
      setMd5MatchesRemainingFromApi(0)
      setIsMd5(false)
      setMd5Blocked(true)
      setRiotVerified(true)
      setRiotLookupMessage(result.message ?? 'Conta já possui rank nesta fila.')
      if (result.tier) {
        setCurrentRank({ tier: result.tier, division: result.division ?? null })
        setRiotAutoFilled(true)
      }
    }
  }

  return {
    riotLookupMessage, riotLookupError, md5Message, unrankedOffer, manualRankOffer,
    resetLookupMessages, lookupRiotRank, lookupForWinBoost, migrateToMd5, declareRankManually,
  }
}
