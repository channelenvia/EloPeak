import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import { useMasterPlusPriceRow } from '@/api/catalog'
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction'
import { calcEloPrice, estimateEloBoostHours, getWinBoostPrice, getMd5WinPrice, applyLpModifier, lpModifierPct, applyMasterPlusPdlDiscount, MATCH_DURATION_HOURS, DELIVERY_ESTIMATE_MULTIPLIER, expectedMatchesForWins } from '@/lib/pricing'
import { isMasterPlusCurrentTier, isDuoBlockedAtTier } from '@/lib/boostDomain'

// Preço e prazo do pedido a partir da configuração do builder; espelha o
// resultado no store (basePrice/estimatedHours/pdlModifierPct).
export function useBuilderPricing() {
  const {
    serviceType, currentRank, targetRank, queueType, boostMode,
    winsPurchased, currentLp, avgLpGain, avgLpLoss, currentPdl,
    setBasePrice, setEstimatedHours, setPdlModifierPct,
  } = useOrderBuilderStore()
  const currentIsMasterPlus = currentRank ? isMasterPlusCurrentTier(currentRank.tier) : false

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
  const { data: masterPlusPriceRow, isFetching: loadingMasterPlusPrice } = useMasterPlusPriceRow({
    currentTier: masterPlusPriceCurrentTier,
    targetTier: targetRank?.tier,
    queueType,
    boostMode,
    pdlFrom: masterPlusPricePdl,
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

  // Cálculo puro extraído do useEffect que só empurrava pra store -- ter isso
  // num useMemo evita o passo de render extra que um useEffect sempre
  // adiciona (render -> efeito dispara -> setState -> re-render) a cada
  // mudança de rank/modo/fila antes do preço atualizar. Chaves ausentes no
  // resultado = "não mexe nesse campo" (mesma semântica dos early-return do
  // efeito original, ex.: coaching/clash só resetam pdlModifierPct e nunca
  // tocam basePrice/estimatedHours, que são setados por outro componente).
  const pricingUpdate = useMemo((): { basePrice?: number; estimatedHours?: number | null; pdlModifierPct?: number | null } | null => {
    if (serviceType === 'elo_boost') {
      if (!currentRank) return null

      if (currentIsMasterPlus) {
        const price = masterPlusPriceRow?.price
        // Duo Boost no Master+ só é aceito na fila Flex.
        if (!targetRank || price == null || (boostMode === 'duo' && queueType !== 'flex')) {
          // Modificador de PDL nunca se aplica ao Master+ — sempre null aqui.
          return { basePrice: 0, estimatedHours: null, pdlModifierPct: null }
        }
        const discountedPrice = applyMasterPlusPdlDiscount(
          price,
          targetRank.tier as 'grandmaster' | 'challenger',
          currentPdl,
          currentRank.tier,
          queueType,
          masterPlusCutoffs,
        )
        const masterPlusHours = estimateEloBoostHours({
          currentRank,
          targetRank,
          currentLp: 0,
          avgLpGain: 30,
          avgLpLoss: 30,
          currentPdl,
          masterPlusCutoffs,
        })
        return {
          basePrice: discountedPrice,
          estimatedHours: masterPlusHours == null ? null : masterPlusHours * DELIVERY_ESTIMATE_MULTIPLIER,
          pdlModifierPct: null,
        }
      }

      if (!targetRank) return null
      // Duo Boost com alvo Grão-Mestre/Challenger só é aceito na fila Flex
      // -- alvo Master em si é permitido normalmente na Solo/Duo.
      if (boostMode === 'duo' && queueType !== 'flex' && isDuoBlockedAtTier(targetRank.tier)) {
        return { basePrice: 0, estimatedHours: null, pdlModifierPct: null }
      }
      const { price } = calcEloPrice(
        queueType, boostMode,
        currentRank.tier, currentRank.division ?? null,
        targetRank.tier, targetRank.division ?? null,
      )
      const withLp = applyLpModifier(price, currentRank.tier, currentLp, avgLpGain, undefined, queueType, boostMode)
      let combined = withLp
      if (isStandardToMasterPlus) {
        if (masterPlusPriceRow?.price == null || !targetRank) {
          return { basePrice: 0, estimatedHours: null, pdlModifierPct: null }
        }
        const discountedMasterPlusPrice = applyMasterPlusPdlDiscount(
          masterPlusPriceRow.price,
          targetRank.tier as 'grandmaster' | 'challenger',
          0,
          currentRank.tier,
          queueType,
          masterPlusCutoffs,
        )
        combined = Math.round((withLp + discountedMasterPlusPrice) * 100) / 100
      }
      const eloHours = estimateEloBoostHours({
        currentRank,
        targetRank,
        currentLp,
        avgLpGain,
        avgLpLoss,
        currentPdl: null,
        masterPlusCutoffs,
      })
      return {
        basePrice: combined,
        estimatedHours: eloHours == null ? null : eloHours * DELIVERY_ESTIMATE_MULTIPLIER,
        pdlModifierPct: lpModifierPct(avgLpGain),
      }

    } else if (serviceType === 'win_boost') {
      if (!winsPurchased || !currentRank) return null
      const pricePerWin = getWinBoostPrice(queueType, currentRank.tier, boostMode, currentRank.division ?? null)
      const winsTotal = Math.round(winsPurchased * pricePerWin * 100) / 100
      return {
        basePrice: winsTotal,
        estimatedHours: expectedMatchesForWins(winsPurchased) * MATCH_DURATION_HOURS * DELIVERY_ESTIMATE_MULTIPLIER,
        pdlModifierPct: null,
      }
    } else if (serviceType === 'md5') {
      if (!winsPurchased || !currentRank) return null
      const cappedWins = Math.min(5, winsPurchased)
      const pricePerWin = getMd5WinPrice(queueType, currentRank.tier, boostMode)
      const winsTotal = Math.round(cappedWins * pricePerWin * 100) / 100
      return {
        basePrice: winsTotal,
        estimatedHours: expectedMatchesForWins(cappedWins) * MATCH_DURATION_HOURS * DELIVERY_ESTIMATE_MULTIPLIER,
        pdlModifierPct: null,
      }
    } else if (serviceType === 'coaching') {
      // Preço vem do pacote escolhido em CoachPackagePicker (setBasePrice
      // chamado lá, não recalculado aqui) — mas o modificador de PDL de uma
      // configuração elo_boost anterior na mesma sessão não pode vazar para
      // o resumo de um pedido de coaching.
      return { pdlModifierPct: null }
    } else if (serviceType === 'clash') {
      // Preço/estimativa vêm de ClashConfigPicker (que já chama
      // setBasePrice/setEstimatedHours diretamente) — só garante que o
      // modificador de PDL de uma configuração elo_boost anterior não vaza
      // pro resumo de um pedido de Clash.
      return { pdlModifierPct: null }
    }
    return null
  }, [
    serviceType, currentRank, targetRank, boostMode, winsPurchased, queueType,
    currentLp, avgLpGain, avgLpLoss, currentPdl, currentIsMasterPlus, isStandardToMasterPlus,
    masterPlusPriceRow, masterPlusCutoffs,
  ])

  // Único efeito colateral real (escrever num store externo ao componente) --
  // só espelha o resultado já calculado acima.
  useEffect(() => {
    if (!pricingUpdate) return
    if ('basePrice' in pricingUpdate) setBasePrice(pricingUpdate.basePrice!)
    if ('estimatedHours' in pricingUpdate) setEstimatedHours(pricingUpdate.estimatedHours!)
    if ('pdlModifierPct' in pricingUpdate) setPdlModifierPct(pricingUpdate.pdlModifierPct!)
  }, [pricingUpdate, setBasePrice, setEstimatedHours, setPdlModifierPct])

  return { masterPlusPriceRow, loadingMasterPlusPrice, leagueCutoffs }
}
