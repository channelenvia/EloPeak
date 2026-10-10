import { describe, expect, it, vi } from 'vitest'
import { checkForUpdate, compareVersions, parseManifest } from '../launcher/src/main/updateCheck'
import { describeFunctionError, SESSION_EXPIRED_MESSAGE, TOKEN_SHAPE_ERRORS } from '../launcher/src/main/functionErrors'

describe('compareVersions', () => {
  it('compara major.minor.patch numericamente (1.10.0 > 1.9.0)', () => {
    expect(compareVersions('1.9.0', '1.10.0')).toBe(-1)
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1)
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0)
  })

  it('pre-release e anterior a versao final', () => {
    expect(compareVersions('1.2.3-beta.1', '1.2.3')).toBe(-1)
    expect(compareVersions('1.2.3', '1.2.3-rc.1')).toBe(1)
  })
})

describe('parseManifest', () => {
  it('aceita manifesto valido com https', () => {
    expect(parseManifest({ version: '1.2.0', url: 'https://x.test/setup.exe', notes: 'correcoes' }))
      .toEqual({ version: '1.2.0', url: 'https://x.test/setup.exe', notes: 'correcoes' })
  })

  it('rejeita url http, javascript:, versao invalida e formatos inesperados', () => {
    expect(parseManifest({ version: '1.2.0', url: 'http://x.test/setup.exe' })).toBeNull()
    expect(parseManifest({ version: '1.2.0', url: 'javascript:alert(1)' })).toBeNull()
    expect(parseManifest({ version: 'latest', url: 'https://x.test/a' })).toBeNull()
    expect(parseManifest(null)).toBeNull()
    expect(parseManifest('1.2.0')).toBeNull()
  })
})

describe('checkForUpdate', () => {
  const ok = (body: unknown) => vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(JSON.stringify(body)) }) as unknown as typeof fetch
  const MANIFEST = 'https://raw.githubusercontent.com/channelenvia/EloPeak-Launcher/main/update.json'
  const REL = 'https://github.com/channelenvia/EloPeak-Launcher/releases/download'
  const good = `${REL}/v0.2.0/Setup.exe`

  it('devolve o manifesto so quando ha versao mais nova', async () => {
    const newer = await checkForUpdate('0.1.0', MANIFEST, ok({ version: '0.2.0', url: good }))
    expect(newer).toMatchObject({ version: '0.2.0', url: good })
    expect(await checkForUpdate('0.2.0', MANIFEST, ok({ version: '0.2.0', url: good }))).toBeNull()
  })

  it.each([
    ['outro repositorio', 'https://github.com/evil/EloPeak-Launcher/releases/download/v1/Setup.exe'],
    ['sufixo no nome do repositorio', 'https://github.com/channelenvia/EloPeak-Launcher.evil/releases/download/v1/Setup.exe'],
    ['mesmo host do manifesto, outro repositorio', 'https://raw.githubusercontent.com/evil/x/main/Setup.exe'],
    ['outro host', 'https://evil.test/Setup.exe'],
    ['dot-segments', `${REL}/../../../../evil/repo/releases/download/v1/Setup.exe`],
    ['dot-segments codificados', `${REL}/%2e%2e/%2e%2e/%2e%2e/evil/Setup.exe`],
    ['userinfo', 'https://channelenvia@evil.test/channelenvia/EloPeak-Launcher/releases/download/v1/Setup.exe'],
    ['porta', 'https://github.com:8443/channelenvia/EloPeak-Launcher/releases/download/v1/Setup.exe'],
    ['http', 'http://github.com/channelenvia/EloPeak-Launcher/releases/download/v1/Setup.exe'],
    ['barra invertida', `${REL}\\..\\x`],
  ])('recusa instalador fora dos releases oficiais: %s', async (_nome, url) => {
    expect(await checkForUpdate('0.1.0', MANIFEST, ok({ version: '0.2.0', url }))).toBeNull()
  })

  it('o manifesto tem tamanho limitado', async () => {
    const huge = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(JSON.stringify({ version: '0.2.0', url: good, notes: 'a'.repeat(20_000) })) }) as unknown as typeof fetch
    expect(await checkForUpdate('0.1.0', MANIFEST, huge)).toBeNull()
  })

  it('segue sem redirecionar (redirect: error) para um https nao virar http', async () => {
    const fetchMock = ok({ version: '0.2.0', url: good })
    await checkForUpdate('0.1.0', MANIFEST, fetchMock)
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({ redirect: 'error' })
  })

  it('sem url configurada, com url http, erro de rede ou resposta ruim: nunca lanca e devolve null', async () => {
    expect(await checkForUpdate('0.1.0', undefined)).toBeNull()
    expect(await checkForUpdate('0.1.0', 'http://x.test/m.json', ok({ version: '9.9.9', url: 'https://x.test/s.exe' }))).toBeNull()
    expect(await checkForUpdate('0.1.0', 'https://x.test/m.json', vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch)).toBeNull()
    expect(await checkForUpdate('0.1.0', 'https://x.test/m.json', vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch)).toBeNull()
  })
})

describe('describeFunctionError', () => {
  it('401 vira sessao expirada e 429 informa quanto esperar', () => {
    expect(describeFunctionError({ status: 401 })).toBe(SESSION_EXPIRED_MESSAGE)
    expect(describeFunctionError({ status: 429, retryAfterSeconds: 42 })).toContain('42 s')
    expect(describeFunctionError({ status: 429 })).toContain('Aguarde')
  })

  it('codigos conhecidos tem texto proprio; 5xx e desconhecidos tem fallback claro', () => {
    expect(describeFunctionError({ status: 400, code: 'token_expired' })).toContain('expirado')
    expect(describeFunctionError({ status: 503 })).toContain('servidor')
    expect(describeFunctionError({ status: 400 })).toContain('Não foi possível')
  })

  it('so invalid_token/token_not_found tentam o outro endpoint', () => {
    expect(TOKEN_SHAPE_ERRORS.has('invalid_token')).toBe(true)
    expect(TOKEN_SHAPE_ERRORS.has('order_not_active')).toBe(false)
  })
})

import { callbackPage, classifyCallbackRequest, escapeHtml } from '../launcher/src/main/callbackGate'

describe('classifyCallbackRequest (servidor local do OAuth)', () => {
  const base = { method: 'GET', pathname: '/callback', host: '127.0.0.1:5555', port: 5555, code: null, errorDescription: null }

  it('so GET /callback com Host 127.0.0.1:<porta> conta; o resto e ignorado sem encerrar o login', () => {
    expect(classifyCallbackRequest({ ...base, pathname: '/favicon.ico' })).toBe('ignore')
    expect(classifyCallbackRequest({ ...base, method: 'POST', code: 'x' })).toBe('ignore')
    expect(classifyCallbackRequest({ ...base, host: 'evil.test:5555', code: 'x' })).toBe('ignore') // DNS rebinding
    expect(classifyCallbackRequest({ ...base, host: '127.0.0.1:9999', code: 'x' })).toBe('ignore')
  })

  it('<img>/fetch de outra pagina (Sec-Fetch-Dest diferente de document) nao conta; navegacao real ou header ausente conta', () => {
    expect(classifyCallbackRequest({ ...base, code: 'x', secFetchDest: 'image' })).toBe('ignore')
    expect(classifyCallbackRequest({ ...base, code: 'x', secFetchDest: 'empty' })).toBe('ignore')
    expect(classifyCallbackRequest({ ...base, code: 'x', secFetchDest: 'document' })).toBe('code')
    expect(classifyCallbackRequest({ ...base, code: 'x' })).toBe('code')
  })

  it('/callback sem code nem erro fica pendente; com code troca a sessao; com erro do Discord falha', () => {
    expect(classifyCallbackRequest(base)).toBe('pending')
    expect(classifyCallbackRequest({ ...base, code: 'abc' })).toBe('code')
    expect(classifyCallbackRequest({ ...base, errorDescription: 'access_denied' })).toBe('provider_error')
  })
})

describe('callbackPage', () => {
  it('escapa HTML da mensagem (sem injecao na pagina local)', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')
    expect(callbackPage(false, '<img src=x onerror=alert(1)>')).not.toContain('<img')
  })

  it('so a pagina de sucesso manda fechar a aba', () => {
    expect(callbackPage(true, 'Pode fechar esta aba')).toContain('Pode fechar')
    expect(callbackPage(false, 'Falhou')).not.toContain('Pode fechar')
  })
})
