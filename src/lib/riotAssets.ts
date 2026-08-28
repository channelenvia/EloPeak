import { invokeEdgeFunction } from './invokeEdgeFunction'
import type { RankTier } from '@/types'
import { CDRAGON_RANK_CREST_BASE } from '../../shared/riotAssets'

// Emblemas de elo (mini-crests) servidos ao vivo pela Community Dragon
// (mesmo domínio já liberado na CSP para profile icons — ver vercel.json).
// Testado manualmente: os 10 tiers respondem 200/image+svg com
// Access-Control-Allow-Origin: * neste path — SVG, não PNG, porque o
// diretório "ranked-emblem" tem imagens 1280x720 (banner, não ícone) e o
// "ranked-mini-crests" não tem .png pra emerald (só .svg). RankBadge/
// RankLockGrid usam isso como primeira tentativa, com as imagens locais em
// public/ranks/ como fallback automático via onError caso a CDN mude ou
// fique fora do ar — nunca depende só da rede externa.
export function riotRankEmblemUrl(tier: RankTier): string {
  return `${CDRAGON_RANK_CREST_BASE}/${tier}.svg`
}

interface ProfileIconsResponse {
  version: string
  icons: { id: number; url: string }[]
  stale: boolean
}

let iconUrlById: Map<number, string> = new Map()

const CDRAGON_PROFILE_ICON_BASE = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons'

export function riotProfileIconUrl(id: number): string {
  return iconUrlById.get(id)
    ?? `${CDRAGON_PROFILE_ICON_BASE}/${id}.jpg`
}

export function parseRiotProfileIconId(url: string | null | undefined): number | null {
  const match = url?.match(/profile-?icons?\/(\d+)\.(?:png|jpg|webp)/i)
  if (!match) return null
  const id = Number(match[1])
  return Number.isFinite(id) ? id : null
}

export function resolveRiotAvatarUrl(url: string | null | undefined): string | undefined {
  const iconId = parseRiotProfileIconId(url)
  if (iconId !== null) return riotProfileIconUrl(iconId)
  return url ?? undefined
}

export async function fetchRiotProfileIconIds(): Promise<number[]> {
  const data = await invokeEdgeFunction<ProfileIconsResponse>('riot-profile-icons', {
    method: 'GET',
  })
  iconUrlById = new Map(data.icons.map((icon) => [icon.id, icon.url]))
  return data.icons.map((icon) => icon.id).sort((a, b) => b - a)
}
