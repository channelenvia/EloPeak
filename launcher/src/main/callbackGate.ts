// Decide o que fazer com cada requisicao recebida no servidor local do OAuth (logica pura, testada em shared/).

export type CallbackAction = 'ignore' | 'pending' | 'provider_error' | 'code'

export interface CallbackRequest {
  method: string | undefined
  pathname: string
  host: string | undefined
  port: number
  code: string | null
  errorDescription: string | null
  /** Header Sec-Fetch-Dest, quando o navegador envia: o retorno do Discord e uma navegacao (document). */
  secFetchDest?: string
}

// - ignore: qualquer coisa que nao seja GET /callback com Host 127.0.0.1:<porta> (favicon, outro site, DNS rebinding).
// - pending: e o /callback mas sem code nem erro (nao e o retorno do Discord): segue esperando.
// - provider_error: o Discord devolveu erro.
// - code: retorno com codigo de autorizacao para trocar pela sessao.
export function classifyCallbackRequest(req: CallbackRequest): CallbackAction {
  if (req.method !== 'GET' || req.pathname !== '/callback' || req.host !== `127.0.0.1:${req.port}`) return 'ignore'
  // <img>, fetch(), <script> de outra pagina sondando a porta nao contam (a navegacao real do Discord e 'document').
  if (req.secFetchDest && req.secFetchDest !== 'document') return 'ignore'
  if (req.errorDescription) return 'provider_error'
  if (req.code) return 'code'
  return 'pending'
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

// Pagina mostrada no navegador depois do Discord: so diz "pode fechar" quando deu certo.
export function callbackPage(ok: boolean, message: string): string {
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Booster Launcher</title></head>'
    + '<body style="font-family:sans-serif;background:#0f1115;color:#e6e8eb;display:flex;align-items:center;'
    + 'justify-content:center;height:100vh;margin:0;text-align:center;padding:0 24px">'
    + `<p style="color:${ok ? '#e6e8eb' : '#ff8a8a'}">${escapeHtml(message)}</p></body></html>`
}
