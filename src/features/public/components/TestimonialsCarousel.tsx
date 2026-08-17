import { MessageSquareText } from 'lucide-react'
import { EmptyState, Skeleton } from '@/components/ui'
import { usePublicReviews } from '@/api/reviews'
import { PLACEHOLDER_TESTIMONIALS } from '../data/placeholderTestimonials'
import { TestimonialCard } from './TestimonialCard'

// Avaliações reais e públicas (reviews.is_public = true) -- nunca depoimentos
// inventados. Se ainda não houver avaliações suficientes, mostra um estado
// vazio explícito em vez de inventar conteúdo (ver master-prompt seção 28.1).
//
// TEMP: site ainda em fase de testes, sem clientes reais -- usando
// depoimentos fictícios (ver ../data/placeholderTestimonials.ts) só pro
// carrossel não ficar vazio. Antes de qualquer lançamento real, apagar
// USE_PLACEHOLDER abaixo (e o arquivo de dados) e voltar a depender só de
// `usePublicReviews`.
const USE_PLACEHOLDER = true

export function TestimonialsCarousel() {
  const { data: realReviews, isLoading } = usePublicReviews()
  const reviews = USE_PLACEHOLDER ? PLACEHOLDER_TESTIMONIALS : realReviews

  if (!USE_PLACEHOLDER && isLoading) {
    return (
      <div className="max-w-screen-xl mx-auto px-5 sm:px-8 flex gap-5 overflow-hidden">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-40 w-80 shrink-0 rounded-2xl" />)}
      </div>
    )
  }

  if (!reviews?.length) {
    return (
      <div className="max-w-screen-xl mx-auto px-5 sm:px-8">
        <EmptyState
          icon={MessageSquareText}
          title="Ainda sem avaliações públicas"
          description="As primeiras avaliações de clientes aparecerão aqui assim que forem publicadas."
        />
      </div>
    )
  }

  // Duplica a lista sempre (mesmo com só 1-2 avaliações) pra fechar o loop
  // visual da esteira sem emenda -- a animação desloca -50%, que só bate com
  // um ponto real do loop quando as duas metades são idênticas; com poucas
  // avaliações e sem duplicar, o marquee pulava/quebrava no fim do ciclo.
  const track = [...reviews, ...reviews]

  return (
    <div className="group relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_5%,black_95%,transparent)]">
      <div className="flex w-max gap-5 animate-marquee group-hover:[animation-play-state:paused]">
        {track.map((review, i) => (
          <TestimonialCard key={`${review.id}-${i}`} {...review} className="w-80 shrink-0" />
        ))}
      </div>
    </div>
  )
}
