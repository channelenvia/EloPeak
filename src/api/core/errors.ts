import { PostgrestError } from '@supabase/supabase-js'
import { EdgeFunctionError } from '@/lib/invokeEdgeFunction'

// Normaliza os três formatos de erro que a camada de API pode receber
// (PostgrestError de .from()/.rpc(), EdgeFunctionError de invokeEdgeFunction,
// e falhas de rede genéricas) num único formato que toda a UI sabe exibir --
// elimina o `console.error` + mensagem genérica duplicados em cada call site
// que existiam antes desta camada.
export class ApiError extends Error {
  readonly code?: string
  readonly status?: number
  readonly cause?: unknown

  constructor(message: string, opts: { code?: string; status?: number; cause?: unknown } = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = opts.code
    this.status = opts.status
    this.cause = opts.cause
  }
}

const FALLBACK_MESSAGE = 'Algo deu errado. Tente novamente em instantes.'

function isPostgrestError(err: unknown): err is PostgrestError {
  return typeof err === 'object' && err !== null && 'code' in err && 'message' in err && 'details' in err
}

export function normalizeApiError(err: unknown, fallbackMessage = FALLBACK_MESSAGE): ApiError {
  if (err instanceof ApiError) return err

  if (err instanceof EdgeFunctionError) {
    return new ApiError(err.message || fallbackMessage, { code: err.code, status: err.status, cause: err })
  }

  if (isPostgrestError(err)) {
    // PGRST116 = .single()/.maybeSingle() sem linha (não é uma falha real do
    // ponto de vista do usuário na maioria dos casos, mas ainda assim
    // normalizado aqui para quem quiser diferenciar via .code).
    return new ApiError(err.message || fallbackMessage, { code: err.code, cause: err })
  }

  if (err instanceof Error) {
    return new ApiError(err.message || fallbackMessage, { cause: err })
  }

  return new ApiError(fallbackMessage, { cause: err })
}

// Ponto único para uma função RPC que retorna o padrão
// `{ success: boolean, error?: string, ... }` usado por quase toda função
// SECURITY DEFINER deste projeto (ver supabase/schema) -- normaliza o campo
// `error` (um código curto, ex.: 'insufficient_balance') pra ApiError com
// tradução opcional via `messages`.
export function assertRpcSuccess<T extends { success?: boolean; error?: string }>(
  result: T,
  messages: Record<string, string> = {},
): T {
  if (result.success === false) {
    const code = result.error ?? 'unknown_error'
    throw new ApiError(messages[code] ?? FALLBACK_MESSAGE, { code })
  }
  return result
}
