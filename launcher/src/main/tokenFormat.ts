// Validacao do token colado pelo booster ANTES de qualquer chamada de rede ou processo: o servidor emite o token como
// base64 (encode(..., 'base64') do Postgres, que quebra linha a cada 76 caracteres) de um blob cifrado.
export const MAX_TOKEN_LENGTH = 8192
const MIN_TOKEN_LENGTH = 40

export type TokenCheck = { ok: true; token: string } | { ok: false; error: string }

export function normalizeToken(raw: unknown): TokenCheck {
  if (typeof raw !== 'string') return { ok: false, error: 'Token inválido.' }
  if (raw.length > MAX_TOKEN_LENGTH * 2) return { ok: false, error: 'Token inválido: muito longo. Copie apenas o token da página do pedido.' }
  // Quebras de linha/espacos de copiar-e-colar nao fazem parte do token.
  const token = raw.replace(/\s+/g, '')
  if (token.length === 0) return { ok: false, error: 'Cole o token copiado da página do pedido.' }
  if (token.length > MAX_TOKEN_LENGTH) return { ok: false, error: 'Token inválido: muito longo. Copie apenas o token da página do pedido.' }
  if (token.length < MIN_TOKEN_LENGTH || !/^[A-Za-z0-9+/]+={0,2}$/.test(token) || token.length % 4 !== 0) {
    return { ok: false, error: 'Token inválido. Copie o token inteiro novamente na página do pedido.' }
  }
  return { ok: true, token }
}
