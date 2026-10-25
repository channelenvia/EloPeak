import { normalizeApiError } from '@/api/core/errors'
import { notifyError, notifySuccess } from '@/lib/notify'

interface FeedbackMeta {
  successMessage?: string
  silentError?: boolean
}

/** Erro de mutation vira toast, a menos que a tela já o exiba (meta.silentError). */
export function handleMutationError(error: unknown, meta: FeedbackMeta | undefined): void {
  if (meta?.silentError) return
  notifyError(normalizeApiError(error).message)
}

export function handleMutationSuccess(meta: FeedbackMeta | undefined): void {
  if (meta?.successMessage) notifySuccess(meta.successMessage)
}
