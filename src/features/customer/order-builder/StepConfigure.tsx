import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import { FormField } from '@/components/ui/FormField'
import { RankLockGrid, WinCountButtons, PdlFieldRow, ErrorAlert } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction'
import { cn, RANK_TIER_ORDER } from '@/lib/utils'
import { calcEloPrice, estimateEloBoostHours, getWinBoostPrice, getMd5WinPrice, DUO_BOOST_PCT, MD5_DISCOUNT_PCT, applyLpModifier, lpModifierPct, MATCH_DURATION_HOURS, DELIVERY_ESTIMATE_MULTIPLIER, expectedMatchesForWins } from '@/lib/pricing'
import { isMasterPlusCurrentTier } from '@/lib/boostDomain'
import type { Division, QueueType, RankTier } from '@/types'
import { Search, Info, Lock } from 'lucide-react'
import { CoachPackagePicker } from './CoachPackagePicker'
import { ClashConfigPicker } from './ClashConfigPicker'

// Mesmo formato aceito pelo backend (riot-account-rank bodySchema): 1-16 chars
// antes do #, 2-5 alfanuméricos depois. Validar no cliente evita um 400
// "Riot ID inválido" a cada busca com ID incompleto.
const RIOT_ID_FORMAT = /^[^#]{1,16}#[A-Za-z0-9]{2,5}$/

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

// ── Main component ────────────────────────────────────────────────────────────

export function StepConfigure() {
  const {
    serviceType, currentRank, targetRank, queueType, boostMode,
    winsPurchased,
    isMd5, md5MatchesRemaining,
    currentLp, avgLpGain, avgLpLoss,
    currentPdl,
    riotId, riotAutoFilled, riotVerified, riotLookupLoading, stepAttempted,
    setService, setCurrentRank, setTargetRank, setQueueType, setBoostMode,
    setWinsPurchased,
    setIsMd5, setMd5MatchesRemainingFromApi,
    setCurrentLp, setAvgLpGain, setAvgLpLoss,
    setCurrentPdl, setAvgPdlGain, setAvgPdlLoss,
    setBasePrice, setEstimatedHours, setPdlModifierPct,
    setRiotId, setRiotAutoFilled, setRiotVerified, setMd5Blocked, clearRiotLookup, setRiotLookupLoading,
  } = useOrderBuilderStore()

  const currentIsMasterPlus = currentRank ? isMasterPlusCurrentTier(currentRank.tier) : false
  const [riotLookupMessage, setRiotLookupMessage] = useState<string | null>(null)
  const [riotLookupError, setRiotLookupError] = useState<string | null>(null)
  const [md5Message, setMd5Message] = useState<string | null>(null)
  // Oferta de migração pra MD5 quando o eloboost dá unranked na fila — guarda
  // as partidas restantes detectadas pela Riot; null quando não há oferta.
  const [unrankedOffer, setUnrankedOffer] = useState<{ matchesRemaining: number } | null>(null)

  function resetLookupMessages() {
    setRiotLookupMessage(null)
    setRiotLookupError(null)
    setMd5Message(null)
    setUnrankedOffer(null)
  }

  async function lookupRiotRank() {
    if (riotLookupLoading) return
    const trimmed = riotId.trim()
    resetLookupMessages()
    if (!RIOT_ID_FORMAT.test(trimmed)) {
      setRiotLookupError('Riot ID inválido. Use o formato Nome#TAG (ex.: Fulano#BR1).')
      return
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
      return
    } finally {
      setRiotLookupLoading(false)
    }

    if (!result?.found) {
      setRiotLookupError('Conta Riot não encontrada.')
      return
    }
    if (!result.ranked || !result.tier) {
      // Sem rank nesta fila — em vez de barrar, oferecemos migrar pra uma MD5
      // da MESMA fila (mesmo endpoint já devolve md5_eligible/matches_remaining).
      // O form segue travado (riotVerified false) até o usuário decidir.
      const remaining = result.matches_remaining ?? 5
      if (remaining < 1) {
        // Unranked mas sem partidas de posicionamento restantes — o backend
        // rejeitaria a MD5, então não oferecemos (evita um beco sem saída).
        setRiotLookupError('Conta sem rank e sem partidas de posicionamento restantes nesta fila. Confira a fila selecionada.')
        return
      }
      setUnrankedOffer({ matchesRemaining: remaining })
      setRiotLookupMessage('Conta sem rank nesta fila.')
      return
    }

    setCurrentRank({ tier: result.tier, division: result.division ?? null })
    if (isMasterPlusCurrentTier(result.tier)) {
      setCurrentPdl(Math.max(0, Math.min(9999, result.league_points ?? 0)))
      setAvgPdlGain(30)
      setAvgPdlLoss(30)
    } else {
      setCurrentLp(Math.max(0, Math.min(99, result.league_points ?? 0)))
      if (typeof result.avg_lp_gain === 'number') setAvgLpGain(Math.max(1, Math.min(50, result.avg_lp_gain)))
      if (typeof result.avg_lp_loss === 'number') setAvgLpLoss(Math.max(1, Math.min(50, result.avg_lp_loss)))
    }

    setRiotAutoFilled(true)
    setRiotVerified(true)
    setRiotLookupMessage(result.message ?? 'Rank atual preenchido automaticamente. Você ainda pode alterar os dados.')
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

  async function lookupForWinBoost() {
    if (riotLookupLoading) return
    const trimmed = riotId.trim()
    resetLookupMessages()
    if (!RIOT_ID_FORMAT.test(trimmed)) {
      setRiotLookupError('Riot ID inválido. Use o formato Nome#TAG (ex.: Fulano#BR1).')
      return
    }
    clearRiotLookup()

    let result: RiotRankResponse
    setRiotLookupLoading(true)
    try {
      result = await fetchRiotRank(trimmed, queueType)
    } catch (error) {
      setRiotLookupError(error instanceof Error ? error.message : 'Não foi possível consultar a Riot agora.')
      return
    } finally {
      setRiotLookupLoading(false)
    }

    if (!result?.found) {
      setRiotLookupError('Conta Riot não encontrada.')
      return
    }

    if (result.md5_eligible) {
      // Conta ainda não rankeada nesta fila — não há "rank atual" para
      // preencher (o usuário ainda precisa escolher manualmente o rank da
      // última temporada), então a grade de rank NÃO é travada aqui.
      const remaining = result.matches_remaining ?? 5
      setIsMd5(true)
      setMd5Blocked(false)
      setMd5MatchesRemainingFromApi(remaining)
      setWinsPurchased(Math.min(remaining, winsPurchased ?? remaining))
      setRiotVerified(true)
      setMd5Message(
        `Conta ainda não rankeada nesta fila - MD5 ativado automaticamente. `
        + `Faltam ${remaining} partida(s) de posicionamento.`,
      )
    } else {
      // Conta já rankeada nesta fila — preenchemos o rank atual e BLOQUEAMOS o
      // MD5 (anti-fraude): não dá pra comprar garantia de placement de uma
      // conta que já saiu do posicionamento. O backend rejeita de todo jeito.
      setMd5MatchesRemainingFromApi(0)
      setIsMd5(false)
      setMd5Blocked(true)
      setRiotVerified(true)
      setRiotLookupMessage(result.message ?? 'Conta já possui rank nesta fila - MD5 indisponível.')
      if (result.tier) {
        setCurrentRank({ tier: result.tier, division: result.division ?? null })
        setRiotAutoFilled(true)
      }
    }
  }

  // Grão-Mestre só tem um destino válido (Challenger) — a interface pode
  // preenchê-lo automaticamente, mas o backend valida a combinação de novo.
  useEffect(() => {
    if (currentRank?.tier === 'grandmaster' && targetRank?.tier !== 'challenger') {
      setTargetRank({ tier: 'challenger', division: null })
    }
  }, [currentRank, targetRank, setTargetRank])

  // Diamond- mirando Grão-Mestre/Challenger direto (fluxo padrão): o trecho
  // Mestre->alvo usa o mesmo preço por PDL do Master+, sempre a partir do
  // PDL=0 (entra em Mestre do zero). "master" como alvo exato não entra
  // aqui — já fica coberto pelo preço por divisão (calcEloPrice) abaixo.
  const isStandardToMasterPlus = !currentIsMasterPlus
    && (targetRank?.tier === 'grandmaster' || targetRank?.tier === 'challenger')

  // Preço do Master+ vem da tabela comercial — depende do par (tier atual,
  // tier alvo), da fila e do degrau de PDL atual (varia a cada 100 PDL,
  // mais barato quanto mais perto do corte do próximo tier). Pega o maior
  // degrau que não ultrapassa o PDL atual; acima do último degrau
  // cadastrado usa o preço do último (mais barato). Se a combinação ainda
  // não tem preço configurado, o preço fica indefinido e o pedido não avança.
  const masterPlusPriceCurrentTier = currentIsMasterPlus ? currentRank?.tier : 'master'
  const masterPlusPricePdl = Math.max(0, currentIsMasterPlus ? currentPdl : 0)
  const { data: masterPlusPriceRow, isFetching: loadingMasterPlusPrice } = useQuery({
    queryKey: ['master-plus-price', masterPlusPriceCurrentTier, targetRank?.tier, queueType, masterPlusPricePdl],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('master_plus_pricing')
        .select('price')
        .eq('current_tier', masterPlusPriceCurrentTier!)
        .eq('target_tier', targetRank!.tier)
        .eq('queue_type', queueType)
        .lte('pdl_from', masterPlusPricePdl)
        .order('pdl_from', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data as { price: number | null } | null
    },
    enabled: (currentIsMasterPlus || isStandardToMasterPlus) && !!currentRank && !!targetRank,
  })

  // Corte atual (PDL do último colocado) das ligas GM/Challenger na Riot —
  // usado só na estimativa de prazo do Master+ (nunca no preço, fixo por
  // tier). Cacheado no servidor (riot_league_cutoffs); staleTime aqui só
  // evita rebuscar a cada render, o valor em si já "atualiza sozinho" pois o
  // servidor reconsulta a Riot quando o cache passa de 6h.
  const { data: leagueCutoffs } = useQuery({
    queryKey: ['riot-league-cutoffs', queueType],
    queryFn: () => invokeEdgeFunction<{ grandmaster_cutoff: number | null; challenger_cutoff: number | null }>('riot-league-cutoffs', {
      body: { queue: queueType },
      requireAuth: true,
    }),
    enabled: serviceType === 'elo_boost',
    staleTime: 5 * 60 * 1000,
  })
  const masterPlusCutoffs = useMemo(
    () => leagueCutoffs
      ? { grandmaster: leagueCutoffs.grandmaster_cutoff, challenger: leagueCutoffs.challenger_cutoff }
      : undefined,
    [leagueCutoffs],
  )

  useEffect(() => {
    if (serviceType === 'elo_boost') {
      if (!currentRank) return

      if (currentIsMasterPlus) {
        const price = masterPlusPriceRow?.price
        // Modificador de PDL nunca se aplica ao Master+ — sempre null aqui.
        setPdlModifierPct(null)
        if (!targetRank || price == null) {
          setBasePrice(0)
          setEstimatedHours(null)
          return
        }
        setBasePrice(price)
        const masterPlusHours = estimateEloBoostHours({
          currentRank,
          targetRank,
          currentLp: 0,
          avgLpGain: 30,
          avgLpLoss: 30,
          currentPdl,
          masterPlusCutoffs,
        })
        setEstimatedHours(masterPlusHours == null ? null : masterPlusHours * DELIVERY_ESTIMATE_MULTIPLIER)
        return
      }

      if (!targetRank) return
      const { price } = calcEloPrice(
        queueType,
        currentRank.tier, currentRank.division ?? null,
        targetRank.tier, targetRank.division ?? null,
      )
      const withLp = applyLpModifier(price, currentRank.tier, currentLp, avgLpGain, undefined, queueType)
      let combined = withLp
      if (isStandardToMasterPlus) {
        if (masterPlusPriceRow?.price == null) {
          setBasePrice(0)
          setEstimatedHours(null)
          setPdlModifierPct(null)
          return
        }
        combined = Math.round((withLp + masterPlusPriceRow.price) * 100) / 100
      }
      const finalPrice = boostMode === 'duo'
        ? Math.round(combined * (1 + DUO_BOOST_PCT / 100) * 100) / 100
        : combined
      setBasePrice(finalPrice)
      const eloHours = estimateEloBoostHours({
        currentRank,
        targetRank,
        currentLp,
        avgLpGain,
        avgLpLoss,
        currentPdl: null,
        masterPlusCutoffs,
      })
      setEstimatedHours(eloHours == null ? null : eloHours * DELIVERY_ESTIMATE_MULTIPLIER)
      setPdlModifierPct(lpModifierPct(avgLpGain))

    } else if (serviceType === 'win_boost') {
      if (!winsPurchased || !currentRank) return
      const pricePerWin = getWinBoostPrice(queueType, currentRank.tier, currentRank.division ?? null)
      const winsTotal = winsPurchased * pricePerWin
      setBasePrice(Math.round((boostMode === 'duo' ? winsTotal * (1 + DUO_BOOST_PCT / 100) : winsTotal) * 100) / 100)
      setEstimatedHours(expectedMatchesForWins(winsPurchased) * MATCH_DURATION_HOURS * DELIVERY_ESTIMATE_MULTIPLIER)
      setPdlModifierPct(null)
    } else if (serviceType === 'md5') {
      if (!winsPurchased || !currentRank) return
      const cappedWins = Math.min(5, winsPurchased)
      const pricePerWin = getMd5WinPrice(queueType, currentRank.tier)
      const winsTotal = cappedWins * pricePerWin
      setBasePrice(Math.round((boostMode === 'duo' ? winsTotal * (1 + DUO_BOOST_PCT / 100) : winsTotal) * 100) / 100)
      setEstimatedHours(expectedMatchesForWins(cappedWins) * MATCH_DURATION_HOURS * DELIVERY_ESTIMATE_MULTIPLIER)
      setPdlModifierPct(null)
    } else if (serviceType === 'coaching') {
      // Preço vem do pacote escolhido em CoachPackagePicker (setBasePrice
      // chamado lá, não recalculado aqui) — mas o modificador de PDL de uma
      // configuração elo_boost anterior na mesma sessão não pode vazar para
      // o resumo de um pedido de coaching.
      setPdlModifierPct(null)
    } else if (serviceType === 'clash') {
      // Preço/estimativa vêm de ClashConfigPicker (que já chama
      // setBasePrice/setEstimatedHours diretamente) — só garante que o
      // modificador de PDL de uma configuração elo_boost anterior não vaza
      // pro resumo de um pedido de Clash.
      setPdlModifierPct(null)
    }
  }, [
    serviceType, currentRank, targetRank, boostMode, winsPurchased, queueType,
    currentLp, avgLpGain, avgLpLoss, currentPdl, currentIsMasterPlus, isStandardToMasterPlus,
    masterPlusPriceRow, masterPlusCutoffs,
    setBasePrice, setEstimatedHours, setPdlModifierPct,
  ])

  return (
    <div>
      <h2 className="text-lg font-bold text-ink mb-1">Configurar Pedido</h2>
      <p className="text-sm text-ink-secondary mb-6">Defina seus ranks e preferências.</p>

      <div className="space-y-6">
        {/* Modalidade (Solo/Duo Boost) — escolha livre do cliente, mesmo
            padrão visual do seletor de Tipo de Fila logo abaixo. Fica antes
            de tudo porque não depende do Riot ID. Duo não existe no Master+,
            mas isso só se sabe depois de verificar o elo — o próprio store
            (setCurrentRank/setBoostMode) já força 'solo' e recusa 'duo'
            nesse caso, então o botão só some/trava quando descobrimos. */}
        {serviceType === 'elo_boost' && (
          <FormField label="Modalidade">
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setBoostMode('solo')}
                className={cn(
                  'flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all',
                  boostMode === 'solo'
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-bg-elevated bg-bg-card text-ink-secondary hover:border-brand/30',
                )}
              >
                Solo Boost
              </button>
              <button
                type="button"
                onClick={() => setBoostMode('duo')}
                disabled={currentIsMasterPlus}
                className={cn(
                  'flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all',
                  boostMode === 'duo'
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-bg-elevated bg-bg-card text-ink-secondary hover:border-brand/30',
                  currentIsMasterPlus && 'opacity-50 cursor-not-allowed hover:border-bg-elevated',
                )}
              >
                Duo Boost <span className="font-normal opacity-70">(+{DUO_BOOST_PCT}%)</span>
              </button>
            </div>
            <p className="text-xs text-ink-muted mt-1.5">
              {currentIsMasterPlus
                ? 'Duo Boost indisponível para Mestre ou superior.'
                : 'Duo Boost: você joga junto com o booster na duo queue.'}
            </p>
          </FormField>
        )}

        {/* Vitórias ou MD5 — NUNCA é escolha livre, o próprio Riot ID abaixo
            decide: conta sem rank nesta fila vira MD5 automaticamente, conta
            já rankeada trava em Vitórias (anti-fraude, o backend rejeita MD5
            de conta que já saiu do posicionamento de qualquer jeito). Antes
            de verificar, mostra o estado default (Vitórias) sem travar
            ainda. Mesmo padrão visual do seletor de Tipo de Fila abaixo. */}
        {(serviceType === 'win_boost' || serviceType === 'md5') && (
          <FormField label="Vitórias ou MD5">
            <div className="flex gap-3">
              <button
                type="button"
                disabled
                className={cn(
                  'flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all cursor-not-allowed',
                  !isMd5
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-bg-elevated bg-bg-card text-ink-secondary opacity-50',
                )}
              >
                <span className="inline-flex items-center gap-1.5">
                  Vitórias
                  {riotVerified && isMd5 && <Lock className="h-3 w-3 opacity-60" />}
                </span>
              </button>
              <button
                type="button"
                disabled
                className={cn(
                  'flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all cursor-not-allowed',
                  isMd5
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-bg-elevated bg-bg-card text-ink-secondary opacity-50',
                )}
              >
                <span className="inline-flex items-center gap-1.5">
                  MD5 <span className="font-normal opacity-70">(-{MD5_DISCOUNT_PCT}%)</span>
                  {riotVerified && !isMd5 && <Lock className="h-3 w-3 opacity-60" />}
                </span>
              </button>
            </div>
            <p className="text-xs text-ink-muted mt-1.5">
              {!riotVerified
                ? 'Detectado automaticamente ao verificar seu Riot ID abaixo.'
                : isMd5
                  ? 'Conta ainda no posicionamento nesta fila — MD5 ativado, garantia de 80%+ de win rate.'
                  : 'Conta já possui rank nesta fila — MD5 indisponível (anti-fraude).'}
            </p>
          </FormField>
        )}

        {/* Solo/Duo Vitórias — vale tanto pra Vitórias quanto MD5 (mesma
            escolha, mesmo padrão visual do Modalidade do Elo Boost acima).
            Duo indisponível em Mestre+, igual Duo Boost -- currentIsMasterPlus
            já é genérico (calculado a partir de currentRank, não do
            serviceType). */}
        {(serviceType === 'win_boost' || serviceType === 'md5') && (
          <FormField label="Modalidade">
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setBoostMode('solo')}
                className={cn(
                  'flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all',
                  boostMode === 'solo'
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-bg-elevated bg-bg-card text-ink-secondary hover:border-brand/30',
                )}
              >
                {isMd5 ? 'Solo MD5' : 'Solo Vitórias'}
              </button>
              <button
                type="button"
                onClick={() => setBoostMode('duo')}
                disabled={currentIsMasterPlus}
                className={cn(
                  'flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all',
                  boostMode === 'duo'
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-bg-elevated bg-bg-card text-ink-secondary hover:border-brand/30',
                  currentIsMasterPlus && 'opacity-50 cursor-not-allowed hover:border-bg-elevated',
                )}
              >
                {isMd5 ? 'Duo MD5' : 'Duo Vitórias'} <span className="font-normal opacity-70">(+{DUO_BOOST_PCT}%)</span>
              </button>
            </div>
            <p className="text-xs text-ink-muted mt-1.5">
              {currentIsMasterPlus
                ? `Duo ${isMd5 ? 'MD5' : 'Vitórias'} indisponível para Mestre ou superior.`
                : `Duo ${isMd5 ? 'MD5' : 'Vitórias'}: o booster joga com Riot ID próprio ou conta da plataforma, junto com você na duo queue.`}
            </p>
          </FormField>
        )}

        {/* Tipo de fila vem antes do Riot ID — a busca na Riot precisa saber
            qual fila consultar (Solo/Duo ou Flex) antes de rodar, senão o
            rank/PDL preenchido pode vir da fila errada. Compartilhado entre
            elo_boost e win_boost/md5. */}
        {(serviceType === 'elo_boost' || serviceType === 'win_boost' || serviceType === 'md5') && (
          <FormField label="Tipo de Fila" required>
            <div className="flex gap-3">
              {(['solo_duo', 'flex'] as QueueType[]).map(q => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQueueType(q)}
                  className={cn(
                    'flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all',
                    queueType === q
                      ? 'border-brand bg-brand/10 text-brand'
                      : 'border-bg-elevated bg-bg-card text-ink-secondary hover:border-brand/30',
                  )}
                >
                  {q === 'solo_duo' ? 'Solo/Duo' : 'Flex'}
                </button>
              ))}
            </div>
          </FormField>
        )}

        {/* Riot ID: usado pra preencher rank/LP/PDL atual de acordo com a fila
            marcada acima. O usuário ainda pode editar tudo depois; a
            validação do backend continua sendo a autoridade na criação do
            pedido. */}
        {serviceType === 'elo_boost' && (
          <FormField
            label="Riot ID"
            required
            hint="Informe antes de configurar. Ex: NomeDoInvocador#BR1. Vamos tentar preencher seu elo atual automaticamente."
            error={stepAttempted && !riotId.trim() ? 'Campo obrigatório' : undefined}
          >
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={riotId}
                onChange={e => {
                  setRiotId(e.target.value)
                  resetLookupMessages()
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void lookupRiotRank()
                  }
                }}
                placeholder="NomeDoInvocador#TAG"
                className="input-base flex-1"
                maxLength={32}
              />
              <button
                type="button"
                onClick={() => void lookupRiotRank()}
                disabled={riotLookupLoading}
                className={cn(
                  'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all',
                  'bg-brand text-white hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed',
                )}
              >
                <Search className="h-4 w-4" />
                {riotLookupLoading ? 'Consultando...' : 'Verificar elo'}
              </button>
            </div>
            {riotLookupMessage && (
              <p className="mt-2 text-xs text-success">{riotLookupMessage}</p>
            )}
            {riotLookupError && <ErrorAlert message={riotLookupError} className="mt-2" />}
          </FormField>
        )}

        {/* Eloboost sem rank na fila — oferta de migrar o pedido pra MD5 na
            mesma fila, já configurando tudo. O form segue travado até aqui. */}
        {serviceType === 'elo_boost' && !riotVerified && unrankedOffer && (
          <div className="rounded-2xl border-2 border-warning/30 bg-warning/5 p-4 space-y-3">
            <div className="flex items-start gap-2.5">
              <Info className="h-4 w-4 text-warning shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-ink">Conta sem rank nesta fila</p>
                <p className="text-xs text-ink-secondary mt-0.5">
                  Sua conta ainda está no posicionamento nesta fila, então não dá pra fazer um Elo Boost.
                  Você pode migrar este pedido para uma <span className="font-semibold">MD5</span> na mesma
                  fila — garantimos 80%+ de win rate nas {unrankedOffer.matchesRemaining} partida(s) restantes
                  (você ajusta o número depois).
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={migrateToMd5}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-brand text-white hover:opacity-90 transition-all"
            >
              Migrar para MD5
            </button>
          </div>
        )}

        {/* Vitórias/MD5: Riot ID vem logo após o Tipo de Fila — a consulta
            usa a fila marcada acima, e a checagem de elegibilidade MD5
            precisa acontecer antes de qualquer outro campo. */}
        {(serviceType === 'win_boost' || serviceType === 'md5') && (
          <FormField
            label="Riot ID"
            required
            hint="Informe seu Nome#TAG. Usamos isso para checar automaticamente se sua conta já tem rank nesta fila (MD5)."
            error={stepAttempted && !riotId.trim() ? 'Campo obrigatório' : undefined}
          >
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={riotId}
                onChange={e => {
                  setRiotId(e.target.value)
                  resetLookupMessages()
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void lookupForWinBoost()
                  }
                }}
                placeholder="NomeDoInvocador#TAG"
                className="input-base flex-1"
                maxLength={32}
              />
              <button
                type="button"
                onClick={() => void lookupForWinBoost()}
                disabled={riotLookupLoading}
                className={cn(
                  'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all',
                  'bg-brand text-white hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed',
                )}
              >
                <Search className="h-4 w-4" />
                {riotLookupLoading ? 'Consultando...' : 'Verificar elo'}
              </button>
            </div>
            {md5Message && <p className="mt-2 text-xs text-success">{md5Message}</p>}
            {riotLookupMessage && !md5Message && <p className="mt-2 text-xs text-success">{riotLookupMessage}</p>}
            {riotLookupError && <ErrorAlert message={riotLookupError} className="mt-2" />}
          </FormField>
        )}

        {/* Número de vitórias/partidas — controle único: grade 1..5, ou até as
            partidas restantes detectadas pela Riot quando MD5. O rótulo vira
            "Número de Partidas" no MD5. */}
        {(serviceType === 'win_boost' || serviceType === 'md5') && riotVerified && (
          <FormField label={isMd5 ? 'Número de Partidas' : 'Número de Vitórias'} required>
            <WinCountButtons
              value={winsPurchased}
              max={isMd5 ? Math.max(1, md5MatchesRemaining ?? 5) : 5}
              onChange={setWinsPurchased}
            />
            <p className="text-xs text-ink-muted mt-1.5">
              {isMd5
                ? `Máximo ${Math.max(1, md5MatchesRemaining ?? 5)} (partidas restantes detectadas pela Riot)`
                : 'Máximo 5'}
            </p>
          </FormField>
        )}

        {/* Rank selection — elo boost (split two-column layout). Só após
            verificar o elo (o rank atual vem preenchido da Riot). */}
        {serviceType === 'elo_boost' && riotVerified && (
          <div className="rounded-2xl border border-bg-elevated overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-2">
              {/* ── Current rank column ── */}
              <div className="p-4 space-y-4 border-b border-bg-elevated md:border-b-0 md:border-r">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">Rank Atual</p>
                </div>

                <RankLockGrid
                  tiers={RANK_TIER_ORDER.filter(t => t !== 'challenger')}
                  current={null}
                  selectedTier={currentRank?.tier ?? null}
                  selectedDivision={currentRank?.division ?? null}
                  onChange={(tier, division) => setCurrentRank({ tier, division })}
                  disabled
                />
                {stepAttempted && !currentRank && (
                  <p className="text-xs text-danger">Selecione um rank</p>
                )}

                {/* PDL Atual — mesmo cartão para os dois fluxos, só trocando
                    quais campos do estado ficam ligados a cada input. Master+
                    não tem PDL alvo — o preço depende da faixa do PDL atual,
                    não de um alvo informado pelo cliente. */}
                {currentRank && (
                  <div className="rounded-xl border border-bg-elevated bg-bg-elevated/20 p-3 space-y-2.5">
                    {currentIsMasterPlus ? (
                      <PdlFieldRow fields={[
                        { label: 'PDL Atual', value: currentPdl, min: 0, max: 9999, onChange: setCurrentPdl, disabled: true },
                        { label: 'Média PDL', value: 30, min: 30, max: 30, onChange: setAvgPdlGain, disabled: true },
                      ]} />
                    ) : (
                      <PdlFieldRow fields={[
                        { label: 'PDL Atual', value: currentLp, min: 0, max: 99, onChange: setCurrentLp, disabled: true },
                        { label: 'Média PDL', value: avgLpGain, min: 1, max: 50, onChange: setAvgLpGain, disabled: true },
                      ]} />
                    )}
                  </div>
                )}
              </div>

              {/* ── Target rank column ── */}
              <div className="p-4 space-y-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">Rank Alvo</p>

                {!currentRank ? (
                  <p className="text-xs text-ink-muted pt-2">Selecione o rank atual primeiro.</p>
                ) : (
                  // A grade sempre mostra os 10 tiers, travando só os que estão
                  // no mesmo degrau ou abaixo do rank atual (RankLockGrid usa
                  // rankStep — Master/Grão-Mestre/Challenger entram na mesma
                  // regra, sem lista de progressões separada). Vale tanto para
                  // o fluxo padrão mirando Master+ (Diamond → Master, por
                  // exemplo) quanto para quem já está em Master+.
                  <RankLockGrid
                    tiers={RANK_TIER_ORDER}
                    current={currentRank}
                    selectedTier={targetRank?.tier ?? null}
                    selectedDivision={targetRank?.division ?? null}
                    onChange={(tier, division) => setTargetRank({ tier, division })}
                  />
                )}
                {currentIsMasterPlus && (
                  <>
                    {loadingMasterPlusPrice && <p className="text-[11px] text-ink-muted">Calculando preço…</p>}
                    {!loadingMasterPlusPrice && targetRank && masterPlusPriceRow?.price == null && (
                      <p className="text-[11px] text-warning">Preço ainda não configurado para esse tier. Fale com o suporte.</p>
                    )}
                  </>
                )}
                {/* Corte ao vivo de GM/Challenger — vale pro fluxo Master+
                    (rank atual já é Master/GM) E pro fluxo padrão mirando
                    GM/Challenger direto de Diamond ou abaixo (progressão por
                    degrau, mesma RankLockGrid acima). Não depende de
                    currentIsMasterPlus, só do rank alvo escolhido. */}
                {targetRank?.tier === 'grandmaster' && leagueCutoffs?.grandmaster_cutoff != null && (
                  <p className="text-[11px] text-ink-muted">Corte atual do Grão-Mestre: {leagueCutoffs.grandmaster_cutoff} PDL (atualizado automaticamente)</p>
                )}
                {targetRank?.tier === 'challenger' && leagueCutoffs?.challenger_cutoff != null && (
                  <p className="text-[11px] text-ink-muted">Corte atual do Challenger: {leagueCutoffs.challenger_cutoff} PDL (atualizado automaticamente)</p>
                )}
                {stepAttempted && currentRank && !targetRank && (
                  <p className="text-xs text-danger">Selecione o rank alvo</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Rank — win boost / MD5. Só após verificar o elo. */}
        {(serviceType === 'win_boost' || serviceType === 'md5') && riotVerified && (
          <FormField
            label={isMd5 ? 'Rank da Última Temporada' : 'Rank Atual'}
            required
            hint={isMd5 ? 'Sem LP - apenas o rank final da temporada passada.' : undefined}
            error={stepAttempted && !currentRank ? 'Selecione um rank' : undefined}
          >
            <RankLockGrid
              tiers={RANK_TIER_ORDER}
              current={null}
              selectedTier={currentRank?.tier ?? null}
              selectedDivision={currentRank?.division ?? null}
              onChange={(tier, division) => setCurrentRank({ tier, division })}
              disabled={serviceType === 'win_boost' || riotAutoFilled}
            />
          </FormField>
        )}

        {/* Coaching — escolhe um pacote real de um booster; preço vem do
            pacote, nunca é combinado depois. */}
        {serviceType === 'coaching' && <CoachPackagePicker />}

        {/* Clash — modalidade, tier fixo e dia; preço vem da tabela fixa
            (mode × tier), setado dentro do próprio picker. */}
        {serviceType === 'clash' && <ClashConfigPicker />}
      </div>
    </div>
  )
}
