import { fetchWithTimeout } from './http.ts'

const DDRAGON_BASE = 'https://ddragon.leagueoflegends.com'
const CDRAGON_BASE = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default'
const CDRAGON_PROFILE_ICONS_URL = `${CDRAGON_BASE}/v1/profile-icons.json`
const CACHE_TTL_MS = Number(Deno.env.get('DDRAGON_CACHE_TTL_MS') ?? String(6 * 60 * 60 * 1000)) // 6h default

interface CacheEntry {
  fetchedAt: number
  version: string
  icons: { id: number; url: string }[]
}

let cache: CacheEntry | null = null
let inFlight: Promise<CacheEntry> | null = null

function communityDragonAssetUrl(iconPath: string): string {
  const normalizedPath = iconPath
    .replace(/^\/lol-game-data\/assets\//, '/')
    .replace(/^\/+/, '')
  return `${CDRAGON_BASE}/${normalizedPath}`
}

async function fetchCommunityDragonIcons(): Promise<CacheEntry> {
  const iconsResp = await fetchWithTimeout(CDRAGON_PROFILE_ICONS_URL, {}, 8000)
  if (!iconsResp.ok) throw new Error(`CommunityDragon profile-icons.json failed: ${iconsResp.status}`)
  const body = await iconsResp.json() as unknown
  if (!Array.isArray(body)) {
    throw new Error('CommunityDragon profile-icons.json returned an unexpected shape')
  }

  const icons = body
    .map((entry) => {
      if (
        !entry
        || typeof entry !== 'object'
        || typeof (entry as { id?: unknown }).id !== 'number'
        || typeof (entry as { iconPath?: unknown }).iconPath !== 'string'
      ) {
        return null
      }

      const { id, iconPath } = entry as { id: number; iconPath: string }
      return { id, url: communityDragonAssetUrl(iconPath) }
    })
    .filter((icon): icon is { id: number; url: string } => icon !== null && Number.isFinite(icon.id))
    .sort((a, b) => b.id - a.id)

  if (icons.length === 0) throw new Error('CommunityDragon profile-icons.json returned zero icons')

  return { fetchedAt: Date.now(), version: 'communitydragon-latest', icons }
}

async function fetchDataDragonIcons(): Promise<CacheEntry> {
  const versionsResp = await fetchWithTimeout(`${DDRAGON_BASE}/api/versions.json`, {}, 8000)
  if (!versionsResp.ok) throw new Error(`versions.json failed: ${versionsResp.status}`)
  const versions = await versionsResp.json() as unknown
  if (!Array.isArray(versions) || typeof versions[0] !== 'string') {
    throw new Error('versions.json returned an unexpected shape')
  }
  const version = versions[0] as string

  const iconsResp = await fetchWithTimeout(
    `${DDRAGON_BASE}/cdn/${version}/data/pt_BR/profileicon.json`, {}, 8000,
  )
  if (!iconsResp.ok) throw new Error(`profileicon.json failed: ${iconsResp.status}`)
  const body = await iconsResp.json() as { data?: Record<string, { id: number }> }
  if (!body.data || typeof body.data !== 'object') {
    throw new Error('profileicon.json returned an unexpected shape')
  }

  const icons = Object.values(body.data)
    .map((entry) => ({ id: entry.id, url: `${DDRAGON_BASE}/cdn/${version}/img/profileicon/${entry.id}.png` }))
    .sort((a, b) => b.id - a.id)

  if (icons.length === 0) throw new Error('profileicon.json returned zero icons')

  return { fetchedAt: Date.now(), version, icons }
}

async function fetchFresh(): Promise<CacheEntry> {
  try {
    return await fetchCommunityDragonIcons()
  } catch (err) {
    console.error('CommunityDragon fetch failed, falling back to Data Dragon', err instanceof Error ? err.message : err)
    return await fetchDataDragonIcons()
  }
}

// Cache + concurrent-call collapsing: multiple simultaneous requests while
// the cache is cold/stale share a single upstream fetch instead of firing
// one upstream request per caller. Falls back to the last-known-good
// cache entry (even if stale) on any upstream failure, rather than erroring
// every caller whenever Riot/community asset CDNs have a blip.
export async function getProfileIcons(): Promise<{ version: string; icons: { id: number; url: string }[]; stale: boolean }> {
  const isFresh = cache && (Date.now() - cache.fetchedAt) < CACHE_TTL_MS
  if (isFresh) return { version: cache!.version, icons: cache!.icons, stale: false }

  if (!inFlight) {
    inFlight = fetchFresh()
      .then((fresh) => { cache = fresh; return fresh })
      .catch((err) => {
        if (cache) {
          console.error('Profile icon fetch failed, serving stale cache', err instanceof Error ? err.message : err)
          return cache
        }
        throw err
      })
      .finally(() => { inFlight = null })
  }

  const result = await inFlight
  return { version: result.version, icons: result.icons, stale: result !== cache || (Date.now() - result.fetchedAt) >= CACHE_TTL_MS }
}
