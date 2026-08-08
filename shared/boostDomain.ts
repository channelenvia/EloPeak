// Domínio central do configurador de boost — Solo Boost, Duo Boost e
// Boost Master+. Fonte única de verdade para: fluxos aplicáveis, ranks
// aceitos como origem/destino, addons válidos por fluxo (e sua ordem de
// exibição), faixas de PDL do Master+ e o cálculo de addons sobre o preço
// base.
//
// Roda nos dois runtimes (Vite/React e a Edge Function Deno
// create-pix-payment), assim como shared/pricing.ts — não importe nada de
// `@/...` nem de APIs específicas de browser/Deno aqui.
//
// O frontend usa este módulo só para montar uma boa experiência (mostrar as
// opções certas, na ordem certa). A Edge Function usa exatamente as mesmas
// funções para validar e rejeitar qualquer combinação inválida — não confie
// em nenhuma decisão de fluxo/addon recalculada apenas no cliente.

import { rankStep, type Division, type RankTier, type ServiceType } from './pricing.ts'

export type BoostMode = 'solo' | 'duo'
export type BoostFlow = 'solo_standard' | 'duo_standard' | 'master_plus'

// ── Ranks ──────────────────────────────────────────────────────────────────

// Ranks aceitos como "rank atual" nos fluxos de boost de progressão
// (Solo/Duo/Master+). Challenger fica de fora da fonte — não é filtrado
// visualmente, ele nunca entra nesta lista.
export const BOOST_CURRENT_RANK_TIERS: RankTier[] = [
  'iron', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'master', 'grandmaster',
]

// Ranks do fluxo padrão (Solo/Duo), Iron a Diamond.
export const STANDARD_RANK_TIERS: RankTier[] = [
  'iron', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond',
]

export function isStandardTier(tier: RankTier): boolean {
  return (STANDARD_RANK_TIERS as RankTier[]).includes(tier)
}

export function isMasterPlusCurrentTier(tier: RankTier): tier is 'master' | 'grandmaster' {
  return tier === 'master' || tier === 'grandmaster'
}

// Tiers sem divisão (I–IV) — Master, Grão-Mestre e Challenger são medidos só
// por PDL, sem subdivisões. Vale tanto para rank atual quanto para rank
// alvo: um cliente Diamond pode mirar Master/Grão-Mestre/Challenger pelo
// fluxo padrão (progressão por degrau, mesma fórmula de Iron–Diamond), e
// nesse caso o rank alvo também não tem divisão.
export const NO_DIVISION_TIERS: readonly RankTier[] = ['master', 'grandmaster', 'challenger']

export function tierHasDivisions(tier: RankTier): boolean {
  return !NO_DIVISION_TIERS.includes(tier)
}

// Determina o fluxo aplicável a partir do rank atual e da modalidade pedida.
// Retorna null quando a combinação é inválida (ex.: Duo pedido com rank
// Master/Grão-Mestre, ou Challenger como rank atual) — quem chamar deve
// tratar null como pedido rejeitado, nunca "cair" silenciosamente em outro
// fluxo.
export function getBoostFlow(currentTier: RankTier, requestedMode: BoostMode): BoostFlow | null {
  if (isMasterPlusCurrentTier(currentTier)) {
    return requestedMode === 'duo' ? null : 'master_plus'
  }
  if (isStandardTier(currentTier)) {
    return requestedMode === 'duo' ? 'duo_standard' : 'solo_standard'
  }
  return null // challenger (ou qualquer tier fora da fonte de origem válida)
}

// ── Faixas de PDL atual (Master+) ────────────────────────────────────────────

export type PdlBracket = '0_49' | '50_89' | '90_119' | '120_plus'

export const PDL_BRACKETS: readonly PdlBracket[] = ['0_49', '50_89', '90_119', '120_plus']

export function getPdlBracket(currentPdl: number): PdlBracket {
  if (currentPdl >= 0 && currentPdl < 50) return '0_49'
  if (currentPdl >= 50 && currentPdl < 90) return '50_89'
  if (currentPdl >= 90 && currentPdl < 120) return '90_119'
  return '120_plus'
}

// ── Addons por fluxo ─────────────────────────────────────────────────────────

// Código do addon que deve aparecer sempre por último, em qualquer tela.
export const PRIORITY_ADDON_CODE = 'priority'

// Whitelist estrutural: define QUAIS códigos de addon existem para cada
// fluxo, na ordem canônica esperada (Acesso Prioritário sempre por último).
// O texto exibido, o percentual e o sort_order "de verdade" vêm da tabela
// `service_extras` (editável pelo admin) — esta lista é a fonte de verdade
// sobre *validade* (o que pode ser aceito), não sobre o *conteúdo* (label,
// percentual). Um código que não está aqui nunca é aceito pelo backend,
// mesmo que exista uma linha ativa em `service_extras` para ele.
export const BOOST_ADDON_CODES: Record<BoostFlow, readonly string[]> = {
  solo_standard: ['solo_only', 'mono_champ', 'live_stream', PRIORITY_ADDON_CODE],
  duo_standard: ['undetectable_duo', 'explanatory_gameplay', 'duo_voice', PRIORITY_ADDON_CODE],
  master_plus: ['explanatory_gameplay', 'mono_champ', 'live_stream', PRIORITY_ADDON_CODE],
}

export function isAddonCodeValidForFlow(flow: BoostFlow, code: string): boolean {
  return BOOST_ADDON_CODES[flow].includes(code)
}

// Um addon (code) é UMA linha em service_extras compartilhada por todo
// service_type que reaproveita seu flow (ex.: solo_standard serve Elo Boost
// Solo, Vitórias, MD5 e Solo Clash) — o name/description base foi escrito
// pensando só em Elo Boost. service_type_overrides (migration 121) guarda
// como o MESMO addon deve ser chamado/descrito para os demais service_types
// daquele flow, sem duplicar a linha (preço/flow/code continuam únicos).
// Chave ausente (ou campo ausente dentro dela) sempre cai pro texto base —
// nunca um texto vazio. Usado tanto pelo frontend (StepExtras/OrderBuilder,
// exibição ao vivo) quanto pela Edge Function (snapshot congelado em
// orders.extras) — o mesmo texto que o cliente viu ao escolher o addon é o
// que fica gravado no pedido.
export interface AddonLabelOverride {
  name?: string
  description?: string
}

export interface AddonLabelSource {
  name: string
  description: string
  service_type_overrides?: Partial<Record<ServiceType, AddonLabelOverride>> | null
}

export function resolveAddonLabel(
  extra: AddonLabelSource,
  serviceType: ServiceType,
): { name: string; description: string } {
  const override = extra.service_type_overrides?.[serviceType]
  return {
    name: override?.name ?? extra.name,
    description: override?.description ?? extra.description,
  }
}

export function hasDuplicateAddonCodes(codes: string[]): boolean {
  return new Set(codes).size !== codes.length
}

// Ordena qualquer lista de addons (catálogo, seleção do usuário, snapshot de
// pedido) pela propriedade explícita de ordenação — nunca pela ordem em que
// chegaram do banco ou pela ordem de clique do usuário.
//
// Cálculo de preço dos addons: cada addon é um percentual aplicado sobre o
// preço base, somado linearmente (nunca composto) — isso já é o que
// `computeOrderPrice`/`extrasBreakdown` em shared/pricing.ts fazem para
// qualquer `OrderExtraInput` (basta mapear o addon do fluxo para
// `{ id: code, priceModifier: 0, priceModifierPct: percentage }`). Não há
// uma segunda função de soma aqui de propósito — um único lugar calcula
// addon sobre preço base, tanto para os 4 extras legados quanto para os
// addons de Solo/Duo/Master+.
export function sortAddonsBySortOrder<T extends { sort_order: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.sort_order - b.sort_order)
}

// ── Bloqueio de rank (grade sempre visível) ──────────────────────────────────

// Único critério de bloqueio de rank: um candidato está bloqueado se seu
// degrau (rankStep) for MENOR OU IGUAL ao degrau do rank atual — nunca
// escondido da lista, apenas desabilitado. Usado tanto pela grade de ranks
// do frontend (RankLockGrid) quanto por qualquer revalidação server-side
// que precise da mesma regra (create-pix-payment já usa rankStep
// diretamente para a mesma comparação no fluxo padrão — este helper existe
// para os lugares que precisam de um booleano pronto, não uma reimplementação).
export function isRankLocked(
  candidate: { tier: RankTier; division: Division | null },
  current: { tier: RankTier; division: Division | null } | null,
): boolean {
  if (!current) return false
  return rankStep(candidate.tier, candidate.division) <= rankStep(current.tier, current.division)
}

// ── Campos proibidos por fluxo ───────────────────────────────────────────────
// Master+ não tem PDL alvo — nunca deve existir no schema, no payload nem no
// estado. Mantido aqui só como referência para validação/testes; o schema
// Zod da Edge Function é quem efetivamente recusa o campo (ver seção 19 do
// contrato de API).
export const MASTER_PLUS_FORBIDDEN_FIELDS = ['targetPdl', 'target_pdl', 'targetLp', 'target_lp'] as const
