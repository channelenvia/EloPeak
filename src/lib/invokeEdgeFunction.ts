import { supabase } from './supabase'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const configuredFunctionsUrl = import.meta.env.VITE_EDGE_FUNCTIONS_URL as string | undefined

const edgeFunctionsUrl = (
  configuredFunctionsUrl?.replace(/\/$/, '')
  || (import.meta.env.DEV ? '/functions/v1' : `${supabaseUrl.replace(/\/$/, '')}/functions/v1`)
)

export type EdgeFunctionErrorBody = {
  success?: boolean
  code?: string
  error?: string | { code?: string; message?: string }
  message?: string
  retry_after?: number
  [key: string]: unknown
}

export class EdgeFunctionError extends Error {
  readonly status: number
  readonly code?: string
  readonly body: EdgeFunctionErrorBody | string | null
  readonly retryAfter?: number

  constructor(params: {
    status: number
    code?: string
    message: string
    body: EdgeFunctionErrorBody | string | null
    retryAfter?: number
  }) {
    super(params.message)
    this.name = 'EdgeFunctionError'
    this.status = params.status
    this.code = params.code
    this.body = params.body
    this.retryAfter = params.retryAfter
  }
}

type InvokeOptions = {
  body?: unknown
  method?: 'GET' | 'POST'
  timeoutMs?: number
  requireAuth?: boolean
}

function extractMessage(body: EdgeFunctionErrorBody | string | null, fallback: string) {
  if (!body || typeof body === 'string') return typeof body === 'string' && body ? body : fallback
  if (typeof body.error === 'string') return body.error
  if (body.error?.message) return body.error.message
  if (typeof body.message === 'string') return body.message
  return fallback
}

function extractCode(body: EdgeFunctionErrorBody | string | null) {
  if (!body || typeof body === 'string') return undefined
  if (typeof body.code === 'string') return body.code
  if (typeof body.error !== 'string' && body.error?.code) return body.error.code
  return undefined
}

function parseRetryAfter(response: Response, body: EdgeFunctionErrorBody | string | null) {
  const header = response.headers.get('Retry-After')
  const headerValue = header ? Number(header) : NaN
  if (Number.isFinite(headerValue) && headerValue > 0) return headerValue
  if (body && typeof body !== 'string' && typeof body.retry_after === 'number') return body.retry_after
  return undefined
}

async function parseBody(response: Response) {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as EdgeFunctionErrorBody
  } catch {
    return text
  }
}

export async function invokeEdgeFunction<T>(name: string, options: InvokeOptions = {}): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000)

  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (options.requireAuth && !session?.access_token) {
      throw new EdgeFunctionError({
        status: 401,
        code: 'AUTH_SESSION_MISSING',
        message: 'Sua sessão expirou. Entre novamente para continuar.',
        body: null,
      })
    }

    const method = options.method ?? 'POST'
    const response = await fetch(`${edgeFunctionsUrl}/${name}`, {
      method,
      headers: {
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: method === 'GET' ? undefined : JSON.stringify(options.body ?? {}),
      signal: controller.signal,
    })

    const parsedBody = await parseBody(response)
    if (!response.ok) {
      throw new EdgeFunctionError({
        status: response.status,
        code: extractCode(parsedBody),
        message: extractMessage(parsedBody, `Edge Function ${name} failed with HTTP ${response.status}`),
        body: parsedBody,
        retryAfter: parseRetryAfter(response, parsedBody),
      })
    }

    return parsedBody as T
  } catch (err) {
    if (err instanceof EdgeFunctionError) throw err
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new EdgeFunctionError({
        status: 0,
        code: 'TIMEOUT',
        message: `Tempo esgotado ao chamar ${name}.`,
        body: null,
      })
    }
    throw new EdgeFunctionError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: `Não foi possível conectar à função ${name}. Em dev, verifique se o Vite foi reiniciado e se VITE_SUPABASE_URL está configurada.`,
      body: err instanceof Error ? err.message : null,
    })
  } finally {
    clearTimeout(timeout)
  }
}
