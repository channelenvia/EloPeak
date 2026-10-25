import { useState } from 'react'

const COPIED_RESET_MS = 3000
const COPY_ERROR_RESET_MS = 4000

export function useCopyCode() {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), COPIED_RESET_MS)
    } catch {
      setCopyError('Não foi possível copiar. Copie o código manualmente.')
      setTimeout(() => setCopyError(null), COPY_ERROR_RESET_MS)
    }
  }

  return { copied, copyError, copy }
}
