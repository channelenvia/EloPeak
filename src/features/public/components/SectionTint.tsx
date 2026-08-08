// Fundo translúcido usado para alternar o "peso visual" entre seções da
// home, sem criar a quebra/contração visível que existia antes: em vez de
// bg-bg-surface/35 direto na <section> (retângulo com borda de opacidade
// dura), esse overlay usa mask-image para esmaecer a opacidade a zero nos
// ~96px do topo/rodapé -- a transição com a seção vizinha (transparente,
// mostrando o AmbientBackground por trás) fica gradual em vez de um corte
// reto. -z-10 garante que fica atrás do conteúdo normal da seção sem
// precisar de z-index explícito nele; a seção precisa ser `relative`.
const FADE_MASK = 'linear-gradient(to bottom, transparent 0%, black 96px, black calc(100% - 96px), transparent 100%)'

export function SectionTint() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 -z-10 bg-bg-surface/35 backdrop-blur-sm pointer-events-none"
      style={{ maskImage: FADE_MASK, WebkitMaskImage: FADE_MASK }}
    />
  )
}
