// shared/clashDomain.ts
// Domínio do serviço Clash (Solo Clash / Duo Clash) — tier/dia e rótulos de
// exibição. O preço em si (tabela + computeOrderPrice) vive em
// shared/pricing.ts, igual ao Elo Boost. Addons do Clash reaproveitam a
// LINHA/tabela do catálogo 'solo_standard' (mesmo de Solo Boost/Vitórias/
// MD5) e 'duo_standard' (mesmo de Duo Boost) em service_extras — mas o
// Clash só aceita um subconjunto desses códigos (CLASH_ADDON_CODES abaixo),
// não a whitelist inteira do fluxo. Ver shared/boostDomain.ts
// (BoostFlow/BOOST_ADDON_CODES) pra whitelist cheia dos demais serviços.
//
// Roda nos dois runtimes (Vite/React e a Edge Function Deno
// create-pix-payment) — não importe nada de `@/...` nem de APIs específicas
// de browser/Deno aqui.

import type { ClashDay, ClashTier, RankTier } from './pricing.ts'
import { PRIORITY_ADDON_CODE, sortAddonsBySortOrder, type BoostMode } from './boostDomain.ts'

export { sortAddonsBySortOrder }

// Subconjunto do catálogo solo_standard/duo_standard aceito no Clash —
// decisão de produto: Solo Clash só oferece Transmissão + Acesso
// Prioritário; Duo Clash só oferece Chamada de Voz + Acesso Prioritário.
// Os demais addons do Elo Boost/Vitórias/MD5 (mono champ, duo indetectável,
// gameplay explicativo etc.) continuam existindo pra esses outros serviços,
// só não se aplicam ao Clash. Ver BOOST_ADDON_CODES em shared/boostDomain.ts
// pra whitelist "cheia" do fluxo.
export const CLASH_ADDON_CODES: Record<BoostMode, readonly string[]> = {
  solo: ['live_stream', PRIORITY_ADDON_CODE],
  duo: ['duo_voice', PRIORITY_ADDON_CODE],
}

export function isAddonCodeValidForClash(mode: BoostMode, code: string): boolean {
  return CLASH_ADDON_CODES[mode].includes(code)
}

export const CLASH_TIER_LABEL: Record<ClashTier, string> = {
  tier_4: 'Tier 4',
  tier_3: 'Tier 3',
  tier_2: 'Tier 2',
  tier_1: 'Tier 1',
}

export const CLASH_TIER_RANGE_LABEL: Record<ClashTier, string> = {
  tier_4: 'Ferro – Prata',
  tier_3: 'Ouro',
  tier_2: 'Platina – Esmeralda',
  tier_1: 'Diamante – Desafiante',
}

// Ranks aceitos em cada tier — referência de validação/exibição. O pedido
// grava só o tier escolhido (orders.clash_tier), nunca um rank+divisão
// específico como o Elo Boost.
export const CLASH_TIER_RANK_TIERS: Record<ClashTier, RankTier[]> = {
  tier_4: ['iron', 'bronze', 'silver'],
  tier_3: ['gold'],
  tier_2: ['platinum', 'emerald'],
  tier_1: ['diamond', 'master', 'grandmaster', 'challenger'],
}

// Rank mais baixo/mais alto de cada tier — só pra exibir os dois ícones de
// fronteira no seletor (RankBadge); nunca gravado no pedido.
export const CLASH_TIER_BOUNDARY_RANKS: Record<ClashTier, { low: RankTier; high: RankTier }> = {
  tier_4: { low: 'iron', high: 'silver' },
  tier_3: { low: 'gold', high: 'gold' },
  tier_2: { low: 'platinum', high: 'emerald' },
  tier_1: { low: 'diamond', high: 'challenger' },
}

export const CLASH_DAY_LABEL: Record<ClashDay, string> = {
  saturday: 'Sábado',
  sunday: 'Domingo',
}

// Inverso de CLASH_TIER_RANK_TIERS — dado o rank verificado via Riot
// (mesma consulta riot-account-rank usada pelo Elo Boost/Vitórias/MD5),
// resolve automaticamente o tier de Clash correspondente, sem o cliente
// precisar escolher manualmente. Cobre os 10 RankTier existentes (Ferro a
// Challenger), então sempre encontra um tier — o fallback nunca é
// alcançado na prática.
export function rankTierToClashTier(tier: RankTier): ClashTier {
  for (const clashTier of Object.keys(CLASH_TIER_RANK_TIERS) as ClashTier[]) {
    if (CLASH_TIER_RANK_TIERS[clashTier].includes(tier)) return clashTier
  }
  return 'tier_1'
}
