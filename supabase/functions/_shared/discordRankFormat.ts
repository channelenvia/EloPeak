// supabase/functions/_shared/discordRankFormat.ts
// Rótulos de rank/serviço, o layout de campos por tipo de serviço e o
// empacotador de embed, compartilhados entre discord-order-channel (jobs) e
// discord-review-announcement (reviews) -- os dois precisam do MESMO
// template de campos (mesma posição, mesmo tamanho de card, mesmo ícone de
// rank) pra não divergir visualmente a cada ajuste futuro.

import { CLASH_TIER_BOUNDARY_RANKS, CLASH_TIER_LABEL, CLASH_DAY_LABEL } from '../../../shared/clashDomain.ts'
import type { ClashTier, ClashDay } from '../../../shared/pricing.ts'

export const RANK_TIER_LABEL: Record<string, string> = {
  iron: 'Ferro', bronze: 'Bronze', silver: 'Prata', gold: 'Ouro', platinum: 'Platina',
  emerald: 'Esmeralda', diamond: 'Diamante', master: 'Mestre', grandmaster: 'Grão-mestre', challenger: 'Desafiante',
}

// Mirrors getOrderServiceName()/getOrderModeType() em src/lib/utils.ts.
export const SERVICE_TYPE_LABEL: Record<string, string> = {
  elo_boost: 'Elo Boost',
  win_boost: 'Vitórias',
  md5: 'MD5',
  coaching: 'Coaching',
  placement_matches: 'MD5 Completo',
  clash: 'Clash',
}
// coaching e placement_matches não têm variação solo/duo.
export const MODAL_SERVICE_TYPES = ['elo_boost', 'win_boost', 'md5', 'clash']
// Só esses 3 têm o seletor de "Tipo de Fila" (Solo/Duo vs Flex) no
// configurador (ver StepConfigure.tsx) -- coaching, MD5 Completo e Clash não
// têm conceito de fila nenhum (Clash é torneio, não fila ranqueada), então
// não faz sentido mostrar "Solo/Duo" pra eles (mesmo que orders.queue_type
// tenha algum valor default gravado na linha).
export const QUEUE_SERVICE_TYPES = ['elo_boost', 'win_boost', 'md5']

const DASH = '—'

export function formatRankValue(rank: { tier?: string; division?: string | null } | null | undefined) {
  if (!rank?.tier) return null
  const label = RANK_TIER_LABEL[rank.tier] ?? rank.tier
  if (!rank.division || ['master', 'grandmaster', 'challenger'].includes(rank.tier)) return label
  return `${label} ${rank.division}`
}

// Rank usado no ícone/thumbnail do embed -- cobre os 3 formatos de "rank"
// que existem entre os tipos de serviço: faixa (elo_boost usa o alvo, o
// rank que o pedido efetivamente entrega), snapshot (vitórias/MD5 usam o
// atual, não há alvo) e faixa fixa por tier (Clash não grava rank nenhum,
// só o tier -- usamos o topo da faixa aceita nesse tier).
// deno-lint-ignore no-explicit-any
export function rankIconTier(order: any): string | null {
  switch (order.service_type) {
    case 'elo_boost':
      return order.target_rank?.tier ?? order.current_rank?.tier ?? null
    case 'win_boost':
    case 'md5':
    case 'placement_matches':
      return order.current_rank?.tier ?? null
    case 'clash':
      return order.clash_tier ? CLASH_TIER_BOUNDARY_RANKS[order.clash_tier as ClashTier]?.high ?? null : null
    default:
      return null
  }
}

// Emblema quadrado, auto-hospedado em public/ranks/{tier}.png (256x256,
// fundo transparente) -- recorte quadrado centralizado do banner oficial da
// Community Dragon (que só tem PNG em formato 16:9, banner, não ícone;
// Discord também não renderiza o .svg quadrado que a Community Dragon
// oferece). Hospedar no próprio domínio em vez de linkar direto a CDN
// externa no `thumbnail` evita depender da Community Dragon responder bem
// pro crawler de imagem do Discord (curl direto sempre funcionou, mas o
// fetcher do Discord é outra origem/UA -- sem controle nem visibilidade
// sobre isso hotlinkando).
export function rankIconUrl(appUrl: string, tier: string | null): string | null {
  if (!tier || !RANK_TIER_LABEL[tier]) return null
  return `${appUrl}/ranks/${tier}.png`
}

// Fallback pro logo da EloPeak quando o serviço não tem rank associado
// (coaching) -- todo card sempre tem thumbnail, mesmo os sem rank.
export function cardThumbnailUrl(appUrl: string, tier: string | null): string {
  return rankIconUrl(appUrl, tier) ?? `${appUrl}/images/logo.png`
}

// Footer padronizado -- MESMO em toda mensagem transacional (job público,
// DM reservada, review, top3, menção de chat): logo + nome do site. Discord
// não renderiza link nenhum dentro de `footer.text` (sem markdown ali, só
// texto puro) -- por isso o domínio some como texto simples aqui, e quem
// chama isso TAMBÉM deve setar `embeds[0].url` (o link de verdade,
// clicável, vira o título do embed) pra cumprir o "link clicável do site".
export function eloPeakFooter(appUrl: string): { text: string; icon_url: string } {
  const domain = appUrl.replace(/^https?:\/\//, '')
  return { text: `EloPeak • ${domain}`, icon_url: `${appUrl}/images/logo.png` }
}

export function modeValue(order: { service_type: string; boost_mode?: string | null }): string {
  if (!MODAL_SERVICE_TYPES.includes(order.service_type)) return DASH
  return order.boost_mode === 'duo' ? 'Duo' : 'Solo'
}

export function queueValue(order: { service_type: string; queue_type?: string | null }): string {
  if (!QUEUE_SERVICE_TYPES.includes(order.service_type)) return DASH
  return order.queue_type === 'flex' ? 'Flex' : 'Solo/Duo'
}

export interface ServiceDetail {
  primaryLabel: string
  primaryValue: string
  secondaryLabel: string
  secondaryValue: string
}

// Sempre exatamente 2 campos (primary/secondary), pra todo service_type --
// é o que garante o mesmo tamanho de card em qualquer tipo de serviço
// (elo_boost, vitórias, MD5, MD5 Completo, coaching ou Clash): quando um
// dado não existe pro tipo em questão, mostra "—" em vez de omitir o campo.
// deno-lint-ignore no-explicit-any
export function serviceDetail(order: any): ServiceDetail {
  const current = formatRankValue(order.current_rank)
  switch (order.service_type) {
    case 'elo_boost': {
      const target = formatRankValue(order.target_rank)
      return { primaryLabel: '📊 Rank Atual', primaryValue: current ?? DASH, secondaryLabel: '🎯 Rank Alvo', secondaryValue: target ?? DASH }
    }
    case 'win_boost':
    case 'md5':
      return {
        primaryLabel: '📊 Rank Atual', primaryValue: current ?? DASH,
        secondaryLabel: '🏆 Vitórias', secondaryValue: order.wins_purchased ? `${order.wins_purchased} vitórias` : DASH,
      }
    case 'placement_matches':
      return { primaryLabel: '📊 Rank Atual', primaryValue: current ?? DASH, secondaryLabel: '🎮 Partidas', secondaryValue: '5 partidas' }
    case 'coaching':
      return {
        primaryLabel: '🎓 Pacote', primaryValue: order.coach_package_title ?? DASH,
        secondaryLabel: '📚 Sessões', secondaryValue: order.sessions_purchased ? String(order.sessions_purchased) : DASH,
      }
    case 'clash': {
      const tier = order.clash_tier ? (CLASH_TIER_LABEL[order.clash_tier as ClashTier] ?? order.clash_tier) : DASH
      const day = order.clash_day ? (CLASH_DAY_LABEL[order.clash_day as ClashDay] ?? order.clash_day) : DASH
      return { primaryLabel: '🏅 Tier', primaryValue: tier, secondaryLabel: '📅 Dia', secondaryValue: day }
    }
    default: {
      const target = formatRankValue(order.target_rank)
      return { primaryLabel: '📊 Rank Atual', primaryValue: current ?? DASH, secondaryLabel: '🎯 Rank Alvo', secondaryValue: target ?? DASH }
    }
  }
}

export type EmbedField = { name: string; value: string; inline?: boolean }

// Bloco de campos que descreve o serviço em si -- MESMA posição/ordem em
// toda mensagem transacional que carrega um pedido (job público, DM
// reservada, review): padronizado, mas dinâmico em quais campos aparecem.
// Modo só existe pra quem varia Solo/Duo (MODAL_SERVICE_TYPES) e Fila só
// pra quem tem fila ranqueada de verdade (QUEUE_SERVICE_TYPES) -- mesma
// regra de getOrderModeType()/orderRequiresAccountAccess() em src/lib/utils.ts
// ("nunca coaching"; placement_matches idem, nunca teve variação de modo/
// fila no configurador). Rank/tier/dia/sessões (primary/secondary) sempre
// aparecem -- é o serviceDetail() de cada tipo, nunca omitido.
// deno-lint-ignore no-explicit-any
export function coreServiceFields(order: any): EmbedField[] {
  const detail = serviceDetail(order)
  const fields: EmbedField[] = [
    { name: '🛠️ Serviço', value: SERVICE_TYPE_LABEL[order.service_type] ?? order.service_type ?? '—', inline: true },
  ]
  if (MODAL_SERVICE_TYPES.includes(order.service_type)) {
    fields.push({ name: '👥 Modo', value: modeValue(order), inline: true })
  }
  if (QUEUE_SERVICE_TYPES.includes(order.service_type)) {
    fields.push({ name: '📋 Fila', value: queueValue(order), inline: true })
  }
  fields.push({ name: detail.primaryLabel, value: detail.primaryValue, inline: true })
  fields.push({ name: detail.secondaryLabel, value: detail.secondaryValue, inline: true })
  return fields
}

// Discord empacota campos inline contíguos em blocos de até 3 por linha
// automaticamente (nunca 4 -- é um limite fixo do client, não uma escolha
// nossa). Deixar o Discord empacotar sozinho (em vez de forçar exatamente 2
// por linha com um campo separador) é o que dá o layout mais compacto e sem
// gap vertical extra: cada campo inline (Serviço/Modo/Fila/Rank/etc) já sai
// marcado `inline: true` na ordem certa em coreServiceFields/buildOrderFields,
// então basta passar o array direto pro `fields` do embed.

