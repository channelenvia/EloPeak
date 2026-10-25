import type { BoostFlow, PaymentStore } from './paymentTypes'

// Monta o payload da intenção de pedido. O preço nunca é enviado pelo cliente.
// Retorna um objeto novo; não lê nem altera nada fora dos argumentos.
export function buildOrderIntent(
  store: PaymentStore,
  addonCodes: string[],
  flow: BoostFlow,
): Record<string, unknown> {
  const base = {
    service_type: store.serviceType,
    service_id: store.serviceId!,
    game_id: store.gameId!,
    server: store.server,
    customer_notes: store.customerNotes || null,
    coupon_code: store.couponCode,
  }

  if (store.serviceType === 'clash') {
    // clashIntentSchema (backend) é .strict() e não define queue_type --
    // Clash não tem fila, só o tier (clash_tier abaixo). current_rank/
    // current_lp são aceitos (opcionais, só informativos pro card de
    // detalhes) -- ver ClashConfigPicker::lookupRiotRank, que os preenche
    // a partir da mesma consulta que já deriva o tier.
    return {
      ...base,
      boost_mode: store.boostMode,
      clash_tier: store.clashTier,
      clash_day: store.clashDay,
      current_rank: store.currentRank,
      current_lp: store.currentLp,
      addon_codes: addonCodes,
      riot_id: store.riotId,
      customer_lanes: store.customerLanes,
      rank_declared: store.rankDeclared,
    }
  }

  const baseWithRank = {
    ...base,
    queue_type: store.queueType,
    current_rank: store.currentRank,
  }

  if (store.serviceType === 'elo_boost') return buildEloBoostIntent(store, addonCodes, flow, baseWithRank)

  if (store.serviceType === 'md5') {
    return {
      ...baseWithRank,
      boost_mode: store.boostMode,
      wins_purchased: store.winsPurchased,
      addon_codes: addonCodes,
      riot_id: store.riotId,
      customer_lanes: store.customerLanes,
      rank_declared: store.rankDeclared,
    }
  }

  return {
    ...baseWithRank,
    target_rank: store.targetRank,
    boost_mode: store.boostMode,
    wins_purchased: store.winsPurchased,
    sessions_purchased: store.sessionsPurchased,
    addon_codes: addonCodes,
    win_package: store.winPackage,
    booster_service_id: store.selectedCoachPackage?.id ?? null,
    riot_id: store.serviceType === 'win_boost' ? store.riotId : null,
    // Coaching/placement_matches não têm esse conceito de rota, mas o
    // schema (otherServiceIntentSchema) exige a chave presente pros três
    // (sem .default(), diferente de riot_id) -- omitir pra quem não é
    // win_boost derrubava a validação com "Body inválido" (400) em vez de
    // cair no valor certo. Manda vazio nesse caso.
    customer_lanes: store.serviceType === 'win_boost' ? store.customerLanes : [],
    rank_declared: store.serviceType === 'win_boost' ? store.rankDeclared : false,
  }
}

function buildEloBoostIntent(
  store: PaymentStore,
  addonCodes: string[],
  flow: BoostFlow,
  baseWithRank: Record<string, unknown>,
): Record<string, unknown> {
  const common = {
    ...baseWithRank,
    target_rank: store.targetRank,
    boost_mode: store.boostMode,
  }
  const tail = {
    addon_codes: addonCodes,
    riot_id: store.riotId,
    customer_lanes: store.customerLanes,
    rank_declared: store.rankDeclared,
  }
  if (flow === 'master_plus') {
    // So vale no elo declarado (rank_declared): com a Riot o servidor usa o valor verificado (M-29).
    return { ...common, current_pdl: store.currentPdl, ...tail }
  }
  return { ...common, current_lp: store.currentLp, win_package: store.winPackage, ...tail }
}
