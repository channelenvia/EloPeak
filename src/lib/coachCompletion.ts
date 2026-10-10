// % do pacote de coaching ja entregue, digitado pelo admin. Vazio/invalido NUNCA vira 0 em silencio
// (0 pagaria o coach por nada): devolve null e a tela bloqueia a confirmacao.
export function parseCompletionPct(value: string): number | null {
  if (value.trim() === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || n > 100) return null
  return n
}
