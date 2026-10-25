const PHRASES = [
  'Elo Boost', 'Win Boost', 'Clash', 'Coaching', 'Garantia MD5',
  '1.800+ pedidos concluídos', '4,9/5 de avaliação', 'Chat ao vivo com seu booster',
  'Pagamento via PIX ou cartão', 'Garantia 100% de conclusão',
] as const

// Faixa contínua com as promessas do produto; o conjunto é duplicado para o loop emendar.
export function Ticker() {
  const items = [...PHRASES, ...PHRASES]
  return (
    <div className="relative z-[3] flex items-center overflow-hidden border-y border-border-subtle bg-bg-surface py-4" aria-label="O que o EloPeak entrega">
      <span aria-hidden="true" className="lp-eq z-[2] ml-5 inline-flex shrink-0 items-center gap-[3px] rounded-full bg-brand px-4 py-2 text-ink-inverse shadow-[0_0_0_10px_rgb(var(--color-bg-surface))]">
        {Array.from({ length: 7 }, (_, i) => <i key={i} />)}
      </span>
      <div aria-hidden="true" className="lp-marquee flex gap-10 whitespace-nowrap pl-10 font-display text-lg font-semibold">
        {items.map((phrase, i) => (
          <span key={i} className="flex gap-10">
            <span className="text-ink/90">{phrase}</span>
            <b className="font-semibold text-brand">·</b>
          </span>
        ))}
      </div>
    </div>
  )
}
