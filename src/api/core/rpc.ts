import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { assertRpcSuccess, normalizeApiError } from './errors'

type RpcFunctions = Database['public']['Functions']
type RpcResult = { success?: boolean; error?: string }

// Ponto único de chamada de RPC SECURITY DEFINER que devolve
// `{ success, error? }`: normaliza o erro do PostgREST e traduz o código de
// `error` via `messages` (ver assertRpcSuccess). Quem precisa de campos extras
// no retorno faz `as Promise<{ success: boolean; ...extras }>` no call site.
export async function callRpc<N extends keyof RpcFunctions>(
  name: N,
  // `& Record` tolera parâmetros que o database.types.ts gerado ainda não conhece.
  args: RpcFunctions[N]['Args'] & Record<string, unknown>,
  messages?: Record<string, string>,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(name, args as never)
  if (error) throw normalizeApiError(error)
  return assertRpcSuccess(data as unknown as RpcResult, messages)
}
