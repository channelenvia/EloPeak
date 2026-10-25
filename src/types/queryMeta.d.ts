import '@tanstack/react-query'

interface AppMutationMeta extends Record<string, unknown> {
  /** Toast de sucesso após a mutation (texto curto em pt-BR). Sem isso, não há toast de sucesso. */
  successMessage?: string
  /** true quando a tela já mostra o erro por conta própria: suprime o toast de erro padrão. */
  silentError?: boolean
}

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: AppMutationMeta
  }
}
