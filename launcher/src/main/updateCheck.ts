// Aviso de nova versao sem infraestrutura de auto-update: o app le um manifesto JSON estatico (config.updateManifestUrl)
// no formato { "version": "1.2.3", "url": "https://.../Booster-Launcher-Setup.exe", "notes": "opcional" } e avisa o booster.
// So aceita https e nunca baixa/executa nada sozinho: o booster abre o link e instala por conta propria.

export interface UpdateManifest {
  version: string
  url: string
  notes?: string
}

const MAX_MANIFEST_BYTES = 16 * 1024

// O instalador pesa ~100 MB (acima do limite do Storage gratuito): fica em GitHub Releases de um repositorio publico.
// Unico destino aceito: github.com + este prefixo de caminho, comparados na URL ja parseada/normalizada (nada de
// startsWith na string bruta, nada de atalho "mesmo host": raw.githubusercontent.com serve QUALQUER repositorio).
const INSTALLER_HOST = 'github.com'
const INSTALLER_PATH_PREFIX = '/channelenvia/EloPeak-Launcher/releases/download/'

function isTrustedInstallerUrl(installerUrl: string): boolean {
  let u: URL
  try {
    u = new URL(installerUrl)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false
  if (u.hostname !== INSTALLER_HOST) return false
  // Segmentos de ponto (inclusive codificados) mudariam o caminho final depois da checagem.
  if (/(^|\/)\.\.?(\/|$)/.test(installerUrl) || /%2e/i.test(installerUrl) || installerUrl.includes('\\')) return false
  return u.pathname.startsWith(INSTALLER_PATH_PREFIX)
}

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

function core(version: string): number[] {
  return version.split('-', 1)[0].split('.').map((n) => Number(n))
}

// -1 / 0 / 1 (semver simples; "1.2.3-beta" e anterior a "1.2.3").
export function compareVersions(a: string, b: string): number {
  const pa = core(a)
  const pb = core(b)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  const aPre = a.includes('-')
  const bPre = b.includes('-')
  if (aPre === bPre) return 0
  return aPre ? -1 : 1
}

export function parseManifest(raw: unknown): UpdateManifest | null {
  if (!raw || typeof raw !== 'object') return null
  const { version, url, notes } = raw as Record<string, unknown>
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) return null
  if (typeof url !== 'string') return null
  try {
    if (new URL(url).protocol !== 'https:') return null
  } catch {
    return null
  }
  return { version, url, ...(typeof notes === 'string' ? { notes: notes.slice(0, 300) } : {}) }
}

export async function checkForUpdate(
  currentVersion: string,
  manifestUrl: string | undefined,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8000,
): Promise<UpdateManifest | null> {
  if (!manifestUrl) return null
  try {
    if (new URL(manifestUrl).protocol !== 'https:') return null
    // redirect 'error': um https que redireciona para http (ou outro lugar) e descartado.
    const response = await fetchImpl(manifestUrl, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error', headers: { 'Cache-Control': 'no-cache' } })
    if (!response.ok) return null
    const text = await response.text()
    if (text.length > MAX_MANIFEST_BYTES) return null
    const manifest = parseManifest(JSON.parse(text))
    // Um manifesto adulterado nao aponta para um site qualquer: so os releases oficiais.
    if (!manifest || !isTrustedInstallerUrl(manifest.url)) return null
    return compareVersions(currentVersion, manifest.version) < 0 ? manifest : null
  } catch {
    return null // sem rede / manifesto invalido: nunca atrapalha o uso do app
  }
}
