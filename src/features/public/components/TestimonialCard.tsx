import { ShieldCheck, Quote } from 'lucide-react'
import { StarRating, Avatar } from '@/components/ui'
import { cn } from '@/lib/utils'
import { riotProfileIconUrl } from '@/lib/riotAssets'
import type { PublicReview } from '@/api/reviews'

// customer_name/avatar_icon_id/service_label só existem nos depoimentos
// fictícios (ver src/features/public/data/placeholderTestimonials.ts) --
// reviews reais (PublicReview) não têm esses campos, e o card cai de volta
// no badge genérico "Cliente verificado" de sempre. Pick só dos campos
// realmente usados (em vez de extends PublicReview) porque os fictícios não
// têm `created_at`/`booster_id`.
interface TestimonialCardProps extends Pick<PublicReview, 'rating' | 'content' | 'booster_display_name'> {
  customer_name?: string
  avatar_icon_id?: number
  service_label?: string
  className?: string
}

export function TestimonialCard({ rating, content, booster_display_name, customer_name, avatar_icon_id, service_label, className }: TestimonialCardProps) {
  return (
    <div className={cn('card relative p-5 flex flex-col gap-4 overflow-hidden', className)}>
      <Quote className="absolute -top-2 -right-1 h-16 w-16 text-ink/[0.04] rotate-180" strokeWidth={1} />
      <div className="flex items-center gap-2 relative">
        {customer_name ? (
          <Avatar src={avatar_icon_id != null ? riotProfileIconUrl(avatar_icon_id) : undefined} name={customer_name} size="sm" />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-success/10 text-success shrink-0">
            <ShieldCheck className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <p className="text-sm font-semibold text-ink truncate">{customer_name ?? 'Cliente verificado'}</p>
            {customer_name && <ShieldCheck className="h-3.5 w-3.5 text-success shrink-0" />}
          </div>
          <StarRating rating={rating} showValue={false} size="xs" />
        </div>
      </div>
      <p className="text-sm text-ink-secondary leading-relaxed relative">&ldquo;{content}&rdquo;</p>
      <div className="flex items-center gap-2 flex-wrap relative">
        <span className="inline-flex items-center gap-1.5 self-start text-xs font-medium px-2.5 py-1 rounded-full border border-brand/40 text-brand bg-brand/5">
          Booster: {booster_display_name}
        </span>
        {service_label && (
          <span className="inline-flex items-center gap-1.5 self-start text-xs font-medium px-2.5 py-1 rounded-full border border-ink-muted/30 text-ink-muted">
            {service_label}
          </span>
        )}
      </div>
    </div>
  )
}
