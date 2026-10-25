import { notifyError, notifySuccess } from './notify'

/** Copia para a área de transferência e confirma com toast (sem isso a cópia era silenciosa). */
export async function copyToClipboard(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    notifySuccess(`${label} copiado`)
  } catch {
    notifyError(`Não foi possível copiar ${label.toLowerCase()}`)
  }
}
