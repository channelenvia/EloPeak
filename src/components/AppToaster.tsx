import { Toaster } from 'sonner'

// Toast no tema do app (tokens de globals.css); o sonner lê estas variáveis CSS.
const TOAST_STYLE = {
  '--normal-bg': 'rgb(var(--color-bg-raised))',
  '--normal-border': 'rgb(var(--color-border-strong))',
  '--normal-text': 'rgb(var(--color-ink))',
  '--success-bg': 'rgb(var(--color-bg-raised))',
  '--success-border': 'rgb(var(--color-success) / 0.4)',
  '--success-text': 'rgb(var(--color-success))',
  '--error-bg': 'rgb(var(--color-bg-raised))',
  '--error-border': 'rgb(var(--color-danger) / 0.4)',
  '--error-text': 'rgb(var(--color-danger))',
} as React.CSSProperties

export function AppToaster() {
  return <Toaster theme="dark" position="bottom-center" style={TOAST_STYLE} closeButton />
}
