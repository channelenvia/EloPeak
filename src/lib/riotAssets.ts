import { invokeEdgeFunction } from './invokeEdgeFunction'

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
