import { createServer } from 'node:http'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, shell } from 'electron'
import { clearStoredSession, getSupabaseClient } from './config'
import { callbackPage, classifyCallbackRequest } from './callbackGate'
import { describeFunctionError, TOKEN_SHAPE_ERRORS, type FunctionErrorInfo } from './functionErrors'

// Log em arquivo pro fluxo de OAuth — o app roda sem console visível pro
// booster, então console.log sozinho não ajuda a diagnosticar um login que
// trava. Nunca grava login/senha do jogo aqui, só o passo a passo do
// handshake Discord/Supabase (URLs, códigos de status, nomes de erro).
// So grava em --dev (nunca em producao) e nunca a URL/query do OAuth (o ?code= e um segredo de uso unico).
const AUTH_LOG_ENABLED = process.argv.includes('--dev') && !app.isPackaged

function logAuth(line: string): void {
  if (!AUTH_LOG_ENABLED) return
  try {
    const logPath = join(app.getPath('userData'), 'debug.log')
    appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`)
  } catch {
    // se nem o log funcionar, não é isso que deve derrubar o login
  }
}

export interface ResolvedCredentials {
  login: string
  password: string
  kind: 'order' | 'duo_account'
  refId: string | undefined
}

// Extrai status HTTP, codigo e Retry-After de um erro de supabase.functions.invoke.
async function parseErrorInfo(error: unknown): Promise<FunctionErrorInfo> {
  const context = (error as { context?: Response }).context
  const info: FunctionErrorInfo = { status: context?.status }
  const retryAfter = Number(context?.headers?.get?.('retry-after'))
  if (Number.isFinite(retryAfter) && retryAfter > 0) info.retryAfterSeconds = retryAfter
  try {
    if (context && typeof context.json === 'function') {
      const body = await context.json() as { error?: string; code?: string }
      info.code = typeof body?.error === 'string' ? body.error : typeof body?.code === 'string' ? body.code : undefined
    }
  } catch {
    // corpo nao veio em JSON: segue com status/Retry-After
  }
  return info
}

// Login é só via Discord (mesmo fluxo do painel web, LoginPage.tsx — não
// existe conta com e-mail/senha neste produto). Não dá pra usar um WebView
// embutido pro OAuth do Discord (prática desaconselhada e não suportada por
// vários provedores) nem capturar o fragmento #access_token de um redirect
// (um servidor HTTP nunca recebe o fragmento). Solução: abre o navegador
// padrão do Windows para o Discord, com PKCE (código de autorização vem por
// querystring, não fragmento) e um servidor HTTP local efêmero só para
// capturar esse ?code= de volta.
let loginInFlight: Promise<{ ok: true } | { ok: false; error: string }> | null = null

// Uma tentativa por vez: uma segunda sobrescreveria o verifier PKCE da primeira e invalidaria o retorno do Discord.
export function loginWithDiscord(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!loginInFlight) {
    loginInFlight = runDiscordLogin().finally(() => { loginInFlight = null })
  }
  return loginInFlight
}

function runDiscordLogin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = getSupabaseClient()

  return new Promise((resolve) => {
    let settled = false
    const finish = (result: { ok: true } | { ok: false; error: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      server.close()
      resolve(result)
    }

    // Porta real so existe depois do listen; o handler compara o Host com ela (anti DNS-rebinding).
    let port = 0
    let exchangeAttempts = 0
    const MAX_EXCHANGE_ATTEMPTS = 10

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const code = url.searchParams.get('code')
      const errorDescription = url.searchParams.get('error_description')
      // Favicon, outro site, outro Host (DNS rebinding) ou /callback sem code/erro nao encerram o login.
      const action = classifyCallbackRequest({
        method: req.method, pathname: url.pathname, host: req.headers.host, port, code, errorDescription,
        secFetchDest: req.headers['sec-fetch-dest'] as string | undefined,
      })
      if (action === 'ignore') {
        res.writeHead(404)
        res.end()
        return
      }
      if (action === 'pending') {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Aguardando o retorno do Discord.')
        return
      }

      const reply = (ok: boolean, message: string) => {
        res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end(callbackPage(ok, message))
      }

      if (action === 'provider_error') {
        // Qualquer pagina da web consegue bater aqui com texto arbitrario: mensagem fixa e o login continua valendo
        // ate o timeout (o booster fechando a aba do Discord so espera os 120 s).
        reply(false, 'O Discord não concluiu o login. Volte ao Booster Launcher e tente de novo.')
        return
      }

      logAuth('retorno do Discord recebido, trocando o codigo pela sessao')
      supabase.auth.exchangeCodeForSession(code!)
        .then(({ error }) => {
          logAuth(`exchangeCodeForSession: ${error ? 'erro' : 'ok'}`)
          if (!error) {
            reply(true, 'Pode fechar esta aba e voltar para o Booster Launcher.')
            finish({ ok: true })
            return
          }
          // Codigo que nao confere com o verifier PKCE (ex.: chamada de terceiros): nao derruba o login real, que ainda
          // pode chegar. Depois de algumas falhas desiste.
          exchangeAttempts += 1
          reply(false, 'Não foi possível concluir o login. Volte ao Booster Launcher e tente de novo.')
          if (exchangeAttempts >= MAX_EXCHANGE_ATTEMPTS) finish({ ok: false, error: 'Falha ao concluir login com Discord.' })
        })
        .catch((err) => {
          logAuth(`exchangeCodeForSession lancou excecao: ${err instanceof Error ? err.name : 'erro'}`)
          reply(false, 'Não foi possível concluir o login. Volte ao Booster Launcher e tente de novo.')
          finish({ ok: false, error: 'Falha ao concluir login com Discord.' })
        })
    })

    // Sem isso, uma falha ao abrir a porta (firewall, permissão, etc.) vira
    // uma exceção não tratada no processo main — a Promise nunca resolve e o
    // botão fica "carregando" pra sempre, sem nenhuma mensagem de erro.
    server.on('error', (err) => {
      logAuth(`servidor local falhou: ${err instanceof Error ? err.message : String(err)}`)
      finish({ ok: false, error: 'Não foi possível abrir a porta local para o login. Feche outros antivírus/firewall e tente de novo.' })
    })

    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      port = typeof address === 'object' && address ? address.port : 0
      const redirectTo = `http://127.0.0.1:${port}/callback`
      logAuth(`servidor local ouvindo em ${redirectTo}`)

      supabase.auth.signInWithOAuth({
        provider: 'discord',
        options: { scopes: 'identify email guilds.join', redirectTo, skipBrowserRedirect: true },
      })
        .then(({ data, error }) => {
          if (error || !data?.url) {
            logAuth(`signInWithOAuth falhou: ${error?.message ?? '(sem url retornada)'}`)
            finish({ ok: false, error: error?.message ?? 'Não foi possível iniciar o login com Discord.' })
            return
          }
          logAuth('abrindo navegador para o login do Discord')
          void shell.openExternal(data.url)
        })
        .catch((err) => {
          logAuth(`signInWithOAuth lançou exceção: ${err instanceof Error ? err.message : String(err)}`)
          finish({ ok: false, error: 'Não foi possível iniciar o login com Discord.' })
        })
    })

    const timeout = setTimeout(() => {
      logAuth('timeout de 120s atingido sem receber callback do Discord')
      finish({ ok: false, error: 'Tempo esgotado aguardando o login com Discord.' })
    }, 120_000)
  })
}

export async function logout(): Promise<void> {
  try {
    // scope 'local': nao depende da rede para limpar a sessao deste computador.
    await getSupabaseClient().auth.signOut({ scope: 'local' })
  } catch {
    // sem rede: o arquivo da sessao e limpo logo abaixo de qualquer forma
  }
  clearStoredSession()
}

// Mostra o nome/usuário do Discord (metadata do provider) em vez do e-mail
// cru — mais reconhecível pro booster e alinhado com "Vincular Discord" ser
// o único jeito de entrar (ver LoginPage.tsx no painel web).
export async function getSessionDisplayName(): Promise<string | null> {
  const { data } = await getSupabaseClient().auth.getSession()
  const user = data.session?.user
  if (!user) return null
  const metadata = user.user_metadata as Record<string, unknown> | undefined
  return (
    (metadata?.full_name as string | undefined)
    ?? (metadata?.custom_claims as { global_name?: string } | undefined)?.global_name
    ?? (metadata?.preferred_username as string | undefined)
    ?? user.email
    ?? null
  )
}

// Tenta resolver o token como credencial de pedido (conta do próprio
// cliente) e, se não for desse tipo, como token de conta Duo — o token é um
// blob opaco cifrado no servidor, o launcher não tem como saber de antemão
// qual dos dois é sem perguntar ao backend (ver 'kind' em resolve_order_
// access_token / resolve_duo_account_access_token no banco).
const FUNCTION_TIMEOUT_MS = 20_000

type AttemptResult =
  | { ok: true; credentials: ResolvedCredentials }
  | { ok: false; info: FunctionErrorInfo }

async function invokeCredentialFunction(
  supabase: ReturnType<typeof getSupabaseClient>,
  attempt: { fn: string; kind: ResolvedCredentials['kind']; idKey: string },
  accessToken: string,
): Promise<AttemptResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<AttemptResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, info: { status: 504 } }), FUNCTION_TIMEOUT_MS)
  })
  const call = (async (): Promise<AttemptResult> => {
    const { data, error } = await supabase.functions.invoke(attempt.fn, { body: { access_token: accessToken } })
    if (error) return { ok: false, info: await parseErrorInfo(error) }
    if (data?.success && data.login && data.password) {
      return { ok: true, credentials: { login: data.login, password: data.password, kind: attempt.kind, refId: data[attempt.idKey] } }
    }
    return { ok: false, info: { status: 400, code: typeof data?.error === 'string' ? data.error : undefined } }
  })().catch((): AttemptResult => ({ ok: false, info: { status: 500 } }))
  try {
    return await Promise.race([call, timeout])
  } finally {
    clearTimeout(timer)
  }
}

// O token e um blob opaco: pode ser de um pedido (conta do cliente) ou de uma conta Duo. Antes tentava um endpoint e
// so depois o outro (duas idas ao servidor em fila no caso Duo); agora pergunta aos dois ao mesmo tempo e usa o que
// reconhecer o token. Erros "esse token nao e deste tipo" de um lado nao escondem um erro real do outro.
export async function resolveCredentials(accessToken: string): Promise<ResolvedCredentials> {
  const supabase = getSupabaseClient()
  const { data: sessionData } = await supabase.auth.getSession()
  if (!sessionData.session) throw new Error(describeFunctionError({ status: 401 }))

  const attempts = [
    { fn: 'resolve-order-credentials', kind: 'order' as const, idKey: 'order_id' },
    { fn: 'resolve-duo-account-credentials', kind: 'duo_account' as const, idKey: 'account_id' },
  ]
  const results = await Promise.all(attempts.map((attempt) => invokeCredentialFunction(supabase, attempt, accessToken)))

  for (const result of results) if (result.ok) return result.credentials

  const failures = results.flatMap((r) => (r.ok ? [] : [r.info]))
  const nonShape = failures.filter((info) => !(info.code && TOKEN_SHAPE_ERRORS.has(info.code)))
  // Um erro com codigo conhecido (ex.: token_expired) vale mais que um 5xx/timeout do outro endpoint.
  const definitive = nonShape.find((info) => info.code) ?? nonShape[0]
  throw new Error(describeFunctionError(definitive ?? failures[0] ?? {}))
}
