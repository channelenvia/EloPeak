import { supabase } from '@/lib/supabase'
import { assertRpcSuccess, normalizeApiError } from '@/api/core/errors'

// Espelha v_min_amount em request_payout (migration 089) -- só pra
// habilitar/desabilitar o botão sem round-trip; o valor que vale de
// verdade é sempre o checado no servidor.
export const MIN_PAYOUT_AMOUNT = 50

const REQUEST_PAYOUT_MESSAGES: Record<string, string> = {
  invalid_amount: 'Informe um valor de saque válido.',
  below_minimum_amount: `O valor mínimo de saque é R$ ${MIN_PAYOUT_AMOUNT.toFixed(2).replace('.', ',')}.`,
  booster_not_approved: 'Sua conta de booster ainda não está aprovada.',
  insufficient_balance: 'O valor solicitado é maior que o seu saldo disponível.',
  unauthorized: 'Sua sessão expirou. Entre novamente para continuar.',
  withdrawal_window_closed: 'Saques só podem ser solicitados nos dias 15 e 30 de cada mês.',
}

export async function requestPayout(amount: number): Promise<{ requestId: string }> {
  const { data, error } = await supabase.rpc('request_payout', { p_amount: amount })
  if (error) throw normalizeApiError(error)
  const result = assertRpcSuccess(
    data as { success: boolean; error?: string; request_id?: string },
    REQUEST_PAYOUT_MESSAGES,
  )
  return { requestId: result.request_id! }
}

const CANCEL_MESSAGES: Record<string, string> = {
  not_found: 'Solicitação não encontrada.',
  invalid_status: 'Esta solicitação não pode mais ser cancelada.',
}

export async function cancelPayoutRequest(requestId: string): Promise<void> {
  const { data, error } = await supabase.rpc('cancel_payout_request', { p_request_id: requestId })
  if (error) throw normalizeApiError(error)
  assertRpcSuccess(data as { success: boolean; error?: string }, CANCEL_MESSAGES)
}

const REVIEW_MESSAGES: Record<string, string> = {
  forbidden: 'Você não tem permissão para revisar solicitações de saque.',
  invalid_target_status: 'Status de destino inválido.',
  not_found: 'Solicitação não encontrada.',
  invalid_status: 'Esta solicitação não está mais no estado esperado.',
}

export async function adminReviewPayoutRequest(params: {
  requestId: string
  newStatus: 'under_review' | 'approved' | 'rejected'
  note?: string
}): Promise<void> {
  const { data, error } = await supabase.rpc('admin_review_payout_request', {
    p_request_id: params.requestId,
    p_new_status: params.newStatus,
    p_note: params.note,
  })
  if (error) throw normalizeApiError(error)
  assertRpcSuccess(data as { success: boolean; error?: string }, REVIEW_MESSAGES)
}

const MARK_PAID_MESSAGES: Record<string, string> = {
  forbidden: 'Você não tem permissão para marcar saques como pagos.',
  proof_required: 'Anexe o comprovante de pagamento antes de marcar como pago.',
  not_found: 'Solicitação não encontrada.',
  invalid_status: 'A solicitação precisa estar aprovada antes de ser paga.',
}

export async function adminMarkPayoutPaid(params: { requestId: string; proofUrl: string }): Promise<void> {
  const { data, error } = await supabase.rpc('admin_mark_payout_paid', {
    p_request_id: params.requestId,
    p_proof_url: params.proofUrl,
  })
  if (error) throw normalizeApiError(error)
  assertRpcSuccess(data as { success: boolean; error?: string }, MARK_PAID_MESSAGES)
}

// Nome de arquivo é controlado pelo usuário (vem do <input type="file"> no
// browser) -- sem isso, um nome como "../outroRequestId/x.png" ou contendo
// "/" mudaria o path de verdade dentro do bucket (que só usa "/" como
// separador de string, não é um filesystem de verdade), permitindo escrever
// fora da "pasta" do requestId pretendido. Mantém só o último segmento e
// troca qualquer caractere fora de um allowlist seguro.
function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() || 'arquivo'
  return base.replace(/[^a-zA-Z0-9._-]/g, '_')
}

// Upload do comprovante para o bucket privado `payout-proofs` (migration
// 082) -- só admins têm policy de INSERT nele. Retorna o path do objeto,
// que é o valor gravado em payout_requests.proof_url.
export async function uploadPayoutProof(params: { requestId: string; file: File }): Promise<string> {
  const path = `${params.requestId}/${Date.now()}-${sanitizeFileName(params.file.name)}`
  const { error } = await supabase.storage.from('payout-proofs').upload(path, params.file, { upsert: false })
  if (error) throw normalizeApiError(error, 'Falha ao enviar o comprovante.')
  return path
}

export async function getPayoutProofSignedUrl(proofPath: string): Promise<string> {
  const { data, error } = await supabase.storage.from('payout-proofs').createSignedUrl(proofPath, 60 * 10)
  if (error || !data) throw normalizeApiError(error, 'Falha ao gerar link do comprovante.')
  return data.signedUrl
}
