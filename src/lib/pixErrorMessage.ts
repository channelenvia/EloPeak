import { EdgeFunctionError } from '@/lib/invokeEdgeFunction'

// Mensagem de erro de PIX/pedido pendente, igual no configurador e em Meus Pedidos.
export function pixErrorMessage(err: unknown) {
  if (!(err instanceof EdgeFunctionError)) {
    return err instanceof Error ? err.message : 'Erro ao gerar PIX'
  }
  if (err.code === 'NETWORK_ERROR') return 'Não foi possível conectar para gerar o PIX. Tente novamente.'
  if (err.status === 401) return 'Sua sessão expirou. Entre novamente para continuar.'
  if (err.status === 403) return 'Você não tem permissão para esse pedido.'
  if (err.status === 429) {
    const seconds = Math.max(1, Math.ceil(err.retryAfter ?? 10))
    return `Muitas tentativas seguidas. Aguarde ${seconds}s e tente novamente.`
  }
  if (err.status >= 500) return 'Não foi possível gerar o PIX agora. Tente novamente em instantes.'
  return err.message
}
