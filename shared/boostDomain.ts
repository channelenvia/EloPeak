// Domínio central do configurador de boost (Solo/Duo/Master+): fluxos,
// ranks aceitos, addons válidos por fluxo e faixas de PDL do Master+.
// Roda em Vite/React e na Edge Function Deno (como shared/pricing.ts) —
// nada de `@/...` nem de APIs de browser/Deno aqui. O frontend usa isto só
// pra UX; a Edge Function usa as mesmas funções para validar de verdade —
// não confie em nenhuma decisão recalculada apenas no cliente.

import { rankStep, type Division, type RankTier, type ServiceType, type QueueType } from './pricing.ts'

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

// A Riot agora libera Duo (fila solo/duo) até o rank Mestre — Grão-Mestre e
// Challenger continuam bloqueados pra Duo em qualquer serviço de progressão
// por rank (Elo Boost, Vitórias). Exceção: MD5 nunca bloqueia Duo por rank
// (ver a checagem de md5 em orderPricing.ts) porque o rank informado é o da
// temporada passada — a partida real acontece bem abaixo desse elo. Esse
// bloqueio por rank só existe na fila Solo/Duo -- na Flex a Riot não
// restringe duo por elo, então este helper nunca é o único fator: quem
// chama sempre combina com `queueType === 'solo_duo'` (ver getBoostFlow).
export function isDuoBlockedAtTier(tier: RankTier): boolean {
  return tier === 'grandmaster' || tier === 'challenger'
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

// Determina o fluxo aplicável a partir do rank atual, da modalidade pedida e
// da fila. Retorna null quando a combinação é inválida (ex.: Duo pedido com
// rank Master/Grão-Mestre — Elo Boost Duo só existe Iron–Diamond agora, em
// qualquer fila — ou Challenger como rank atual) — quem chamar deve tratar
// null como pedido rejeitado, nunca "cair" silenciosamente em outro fluxo.
export function getBoostFlow(currentTier: RankTier, requestedMode: BoostMode, _queueType: QueueType): BoostFlow | null {
  if (isMasterPlusCurrentTier(currentTier)) {
    if (requestedMode === 'duo') return null
    return 'master_plus'
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
// service_type do mesmo flow (ex.: solo_standard serve Elo Boost Solo,
// Vitórias, MD5 e Solo Clash), com name/description base escritos pensando
// só em Elo Boost. service_type_overrides (migration 121) guarda como
// renomear/redescrever o mesmo addon pros outros service_types sem duplicar
// a linha; chave/campo ausente cai pro texto base, nunca vazio.
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

// Ordena addons pela propriedade explícita `sort_order` — nunca pela ordem
// do banco ou de clique do usuário. Preço dos addons é calculado só por
// `computeOrderPrice`/`extrasBreakdown` em shared/pricing.ts (percentual
// linear sobre o preço base); não há uma segunda função de soma aqui.
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
