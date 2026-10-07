export type CardPaymentOutcome = 'approved' | 'pending' | 'rejected'

// approved: dinheiro confirmado. pending: o MP ainda decide (análise antifraude
// ou do emissor) -- vincula ao pedido e espera o webhook. rejected: qualquer
// outro status (inclusive desconhecidos) -- NÃO vincula ao pedido, para o
// cliente poder tentar de novo com outro cartão no mesmo pedido.
export function classifyCardPayment(status: unknown): CardPaymentOutcome {
  if (status === 'approved') return 'approved'
  if (status === 'pending' || status === 'in_process' || status === 'authorized') return 'pending'
  return 'rejected'
}

export interface ThreeDsInfo {
  external_resource_url: string
  creq: string
}

// Desafio 3DS 2.0: o MP devolve status 'pending' + status_detail
// 'pending_challenge' com o endereço do banco emissor e o creq. Só repassamos
// ao client uma URL https -- nunca um valor arbitrário vindo do provedor.
export function extractThreeDsInfo(mp: { status_detail?: unknown; three_ds_info?: unknown }): ThreeDsInfo | null {
  if (mp.status_detail !== 'pending_challenge') return null
  const info = mp.three_ds_info as { external_resource_url?: unknown; creq?: unknown } | null | undefined
  if (typeof info?.external_resource_url !== 'string' || typeof info.creq !== 'string') return null
  if (!info.external_resource_url.startsWith('https://') || !info.creq) return null
  return { external_resource_url: info.external_resource_url, creq: info.creq }
}
