import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { checkForUpdate, compareVersions, normalizeVersion } from '../launcher/src/main/updateCheck'
import { normalizeToken } from '../launcher/src/main/tokenFormat'

const MANIFEST = 'https://raw.githubusercontent.com/channelenvia/EloPeak-Launcher/main/update.json'
const REL = 'https://github.com/channelenvia/EloPeak-Launcher/releases/download'
const manifest = (version: string, url = `${REL}/v${version.replace(/^v/, '')}/Setup.exe`) =>
  vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(JSON.stringify({ version, url, sha256: 'b'.repeat(64) })) }) as unknown as typeof fetch

describe('aviso de nova versao (so quando remote > local)', () => {
  it('iguais: sem aviso', async () => {
    expect(await checkForUpdate('0.1.2', MANIFEST, manifest('0.1.2'))).toBeNull()
  })
  it('remoto menor: sem aviso', async () => {
    expect(await checkForUpdate('0.1.10', MANIFEST, manifest('0.1.2'))).toBeNull()
  })
  it('remoto maior (0.1.10 > 0.1.2, numerico): aviso', async () => {
    expect(await checkForUpdate('0.1.2', MANIFEST, manifest('0.1.10'))).toMatchObject({ version: '0.1.10' })
  })
  it('prefixo v no remoto e no local e normalizado', async () => {
    expect(await checkForUpdate('v0.1.2', MANIFEST, manifest('v0.1.2'))).toBeNull()
    expect(await checkForUpdate('0.1.2', MANIFEST, manifest('v0.1.3'))).toMatchObject({ version: '0.1.3' })
  })
  it('malformado: sem aviso', async () => {
    for (const v of ['latest', '0.1', '1.2.3.4', '', 'v', '0.1.x']) {
      expect(await checkForUpdate('0.1.2', MANIFEST, manifest(v, `${REL}/v9.9.9/Setup.exe`))).toBeNull()
    }
    const bad = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('<html>not json') }) as unknown as typeof fetch
    expect(await checkForUpdate('0.1.2', MANIFEST, bad)).toBeNull()
  })
  it('versao local ilegivel: sem aviso (nunca assume que ha update)', async () => {
    expect(await checkForUpdate('', MANIFEST, manifest('0.1.3'))).toBeNull()
    expect(await checkForUpdate('dev', MANIFEST, manifest('0.1.3'))).toBeNull()
  })
  it('pre-release remoto nao e oferecido a versao final; entre pre-releases segue semver', async () => {
    expect(await checkForUpdate('0.1.2', MANIFEST, manifest('0.1.3-beta.1'))).toBeNull()
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.11')).toBe(-1)
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1)
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBe(-1)
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1)
    expect(await checkForUpdate('0.1.3-beta.1', MANIFEST, manifest('0.1.3-beta.2'))).toMatchObject({ version: '0.1.3-beta.2' })
  })
  it('url do instalador de outra versao que a anunciada: sem aviso', async () => {
    expect(await checkForUpdate('0.1.2', MANIFEST, manifest('0.1.3', `${REL}/v0.1.2/Setup.exe`))).toBeNull()
  })
  it('erro de rede, HTTP != 2xx e timeout: sem aviso', async () => {
    expect(await checkForUpdate('0.1.2', MANIFEST, vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch)).toBeNull()
    expect(await checkForUpdate('0.1.2', MANIFEST, vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch)).toBeNull()
  })
  it('normalizeVersion', () => {
    expect(normalizeVersion('v1.2.3')).toBe('1.2.3')
    expect(normalizeVersion(' 1.2.3 ')).toBe('1.2.3')
    expect(normalizeVersion('1.2')).toBeNull()
    expect(normalizeVersion(undefined)).toBeNull()
  })
})

describe('banner de atualizacao (causa-raiz do falso "nova versao")', () => {
  it('.hidden vence qualquer display declarado depois (.update-banner { display: flex })', () => {
    const css = readFileSync('launcher/src/renderer/styles.css', 'utf-8')
    expect(css).toMatch(/\.hidden\s*\{\s*display:\s*none\s*!important/)
  })
})

describe('normalizeToken', () => {
  it('remove espacos e quebras de linha do copiar-e-colar (base64 do Postgres quebra a cada 76)', () => {
    const r = normalizeToken(`  ${'A'.repeat(76)}\n${'B'.repeat(76)}\n${'C'.repeat(8)}  `)
    expect(r).toEqual({ ok: true, token: 'A'.repeat(76) + 'B'.repeat(76) + 'C'.repeat(8) })
  })
  it('rejeita vazio, so espacos, nao-string, curto, caracteres fora do base64 e muito longo', () => {
    for (const bad of ['', '   \n ', null, undefined, 42, 'abc', `${'A'.repeat(60)}!`, 'A'.repeat(61), 'A'.repeat(9000)]) {
      expect(normalizeToken(bad).ok).toBe(false)
    }
  })
  it('erro nunca contem o token', () => {
    const secret = `${'Z'.repeat(60)}!`
    const r = normalizeToken(secret)
    expect(r.ok === false && r.error.includes('ZZZ')).toBe(false)
  })
})

describe('ordem do fluxo no main (token:submit)', () => {
  it('Deceive, Riot Client e jogo sao checados antes de resolveCredentials; Deceive so roda depois', () => {
    const src = readFileSync('launcher/src/main/index.ts', 'utf-8')
    const at = (s: string) => src.indexOf(s)
    expect(at('normalizeToken(rawToken)')).toBeGreaterThan(-1)
    expect(at('normalizeToken(rawToken)')).toBeLessThan(at('requireDeceiveExecutable()'))
    expect(at('requireDeceiveExecutable()')).toBeLessThan(at('isRiotClientAvailable()'))
    expect(at('isRiotClientAvailable()')).toBeLessThan(at('inspectRiotClient()'))
    expect(at('inspectRiotClient()')).toBeLessThan(at('await resolveCredentials('))
    expect(at('await resolveCredentials(')).toBeLessThan(at('await autoLoginToRiotClient('))
  })
})

import { readFileSync as readSrc } from 'node:fs'
import { join as joinSrc } from 'node:path'

describe('LOGIN_SCRIPT reconfirma o foco do Riot Client antes de clicar/digitar (A12-01)', () => {
  const source = readSrc(joinSrc(__dirname, '..', 'launcher', 'src', 'main', 'riotClient.ts'), 'utf8')
  const bodyStart = source.indexOf('const LOGIN_SCRIPT = `')
  const body = source.slice(bodyStart, source.indexOf('`.trim()', bodyStart))

  it('define Assert-RiotForeground com WINDOW_NOT_FOCUSED e o chama antes de cada digitacao', () => {
    expect(body).toContain('function Assert-RiotForeground')
    expect(body).toContain("'WINDOW_NOT_FOCUSED'")
    const typeCalls = [...body.matchAll(/Clear-AndType -text/g)].map((m) => m.index!)
    expect(typeCalls.length).toBe(2)
    for (const at of typeCalls) {
      const before = body.slice(Math.max(0, at - 160), at)
      expect(before).toContain('Assert-RiotForeground')
    }
  })

  it('confere o foco antes de travar o input e antes de cada clique', () => {
    const block = body.slice(body.indexOf('BlockInput($true)'))
    const clicks = [...block.matchAll(/ClickAt\(\$(?:user|pass|login)Point/g)].length
    const asserts = [...block.matchAll(/Assert-RiotForeground/g)].length
    expect(clicks).toBe(3)
    expect(asserts).toBeGreaterThanOrEqual(clicks)
    expect(body.indexOf('GetForegroundWindow() -ne $hwnd')).toBeGreaterThan(-1)
  })
})
