// Traduz a falha de uma Edge Function (resolve-*-credentials) em texto para o booster.
// Antes 401 (sessao vencida) e 429 (limite de tentativas) caiam na mensagem generica.

export interface FunctionErrorInfo {
  status?: number
  code?: string
  retryAfterSeconds?: number
}

const CODE_MESSAGES: Record<string, string> = {
  invalid_token: 'Token inválido. Copie o token novamente na página do pedido.',
  token_not_found: 'Token inválido. Copie o token novamente na página do pedido.',
  token_expired: 'Token expirado. Gere um novo token na página do pedido.',
  token_expired_or_invalid: 'Token expirado. Gere um novo token na página do pedido.',
  order_not_active: 'Este pedido não está mais ativo.',
  order_not_paid_or_active: 'Este pedido não está mais ativo.',
  booster_not_authorized: 'Sua conta de booster não está aprovada.',
  reservation_no_longer_valid: 'Essa conta Duo não está mais reservada para você.',
  credentials_not_required_for_service: 'Este serviço não usa login automático.',
  server_key_not_configured: 'Erro interno do servidor. Contate o suporte.',
}

export const SESSION_EXPIRED_MESSAGE = 'Sua sessão expirou. Saia e entre novamente com o Discord.'

export function describeFunctionError(info: FunctionErrorInfo): string {
  if (info.status === 401) return SESSION_EXPIRED_MESSAGE
  if (info.status === 429) {
    const wait = info.retryAfterSeconds && info.retryAfterSeconds > 0 ? ` Tente de novo em ${Math.ceil(info.retryAfterSeconds)} s.` : ' Aguarde um instante.'
    return `Muitas tentativas em pouco tempo.${wait}`
  }
  if (info.code && CODE_MESSAGES[info.code]) return CODE_MESSAGES[info.code]
  if (info.status && info.status >= 500) return 'O servidor está com problemas agora. Tente novamente em instantes.'
  return 'Não foi possível obter as credenciais. Tente novamente.'
}

// Erros que significam "esse token nao e desse tipo": so neles vale tentar o outro endpoint (pedido x conta Duo).
export const TOKEN_SHAPE_ERRORS = new Set(['invalid_token', 'token_not_found'])
