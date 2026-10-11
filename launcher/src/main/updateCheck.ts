// Aviso de nova versao sem infraestrutura de auto-update: o app le um manifesto JSON estatico (config.updateManifestUrl)
// no formato { "version": "1.2.3", "url": "https://.../EloPeak-App-1.2.3.exe", "sha256": "<64 hex>", "notes": "opcional" }
// e avisa o booster. O sha256 do instalador e obrigatorio: sem ele o manifesto e ignorado (nao ha como conferir o download).
// So aceita https e nunca baixa/executa nada sozinho: o booster abre o link e instala por conta propria.

export interface UpdateManifest {
  version: string
  url: string
  sha256: string
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

// Semver estrito (MAJOR.MINOR.PATCH[-pre]); um "v" na frente e aceito e removido (tag do GitHub: v0.1.2).
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export function normalizeVersion(version: unknown): string | null {
  if (typeof version !== 'string') return null
  const v = version.trim().replace(/^v/i, '')
  return VERSION_PATTERN.test(v) ? v : null
}

function core(version: string): number[] {
  return version.split('-', 1)[0].split('.').map((n) => Number(n))
}

// Precedencia de pre-release do semver: identificadores numericos < alfanumericos; mais campos vence se o prefixo e igual.
function comparePrerelease(a: string, b: string): number {
  const pa = a.split('.')
  const pb = b.split('.')
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1
    if (pb[i] === undefined) return 1
    const na = /^\d+$/.test(pa[i])
    const nb = /^\d+$/.test(pb[i])
    if (na && nb) {
      if (Number(pa[i]) !== Number(pb[i])) return Number(pa[i]) < Number(pb[i]) ? -1 : 1
    } else if (na !== nb) {
      return na ? -1 : 1
    } else if (pa[i] !== pb[i]) {
      return pa[i] < pb[i] ? -1 : 1
    }
  }
  return 0
}

// -1 / 0 / 1 (semver; "1.2.3-beta" e anterior a "1.2.3"). Entrada ja normalizada (normalizeVersion).
export function compareVersions(a: string, b: string): number {
  const pa = core(a)
  const pb = core(b)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  const aPre = a.includes('-') ? a.slice(a.indexOf('-') + 1) : null
  const bPre = b.includes('-') ? b.slice(b.indexOf('-') + 1) : null
  if (aPre === null && bPre === null) return 0
  if (aPre === null) return 1
  if (bPre === null) return -1
  return comparePrerelease(aPre, bPre)
}

export function parseManifest(raw: unknown): UpdateManifest | null {
  if (!raw || typeof raw !== 'object') return null
  const { version, url, notes, sha256 } = raw as Record<string, unknown>
  const normalized = normalizeVersion(version)
  if (!normalized) return null
  if (typeof url !== 'string') return null
  if (typeof sha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(sha256.trim())) return null
  try {
    if (new URL(url).protocol !== 'https:') return null
  } catch {
    return null
  }
  return { version: normalized, url, sha256: sha256.trim().toLowerCase(), ...(typeof notes === 'string' ? { notes: notes.slice(0, 300) } : {}) }
}

export async function checkForUpdate(
  currentVersion: string,
  manifestUrl: string | undefined,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8000,
): Promise<UpdateManifest | null> {
  const local = normalizeVersion(currentVersion)
  // Versao local ilegivel: nao ha como afirmar que existe versao mais nova.
  if (!local || !manifestUrl) return null
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
    // O instalador tem de ser o da propria versao anunciada (tag v<version>): manifesto adiantado/incoerente nao avisa.
    if (!new URL(manifest.url).pathname.startsWith(`${INSTALLER_PATH_PREFIX}v${manifest.version}/`)) return null
    // Pre-release remoto nunca e oferecido a quem roda uma versao final.
    if (manifest.version.includes('-') && !local.includes('-')) return null
    return compareVersions(local, manifest.version) < 0 ? manifest : null
  } catch {
    return null // sem rede / manifesto invalido: nunca atrapalha o uso do app (e nunca vira "ha update")
  }
}
