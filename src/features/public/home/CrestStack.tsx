import { RANK_TIER_ORDER } from '@/lib/utils'
import { RANK_TIER_LABEL } from '@/lib/utils'
import { cn } from '@/lib/cn'

interface CrestStackProps {
  /** Índice do tier ativo em RANK_TIER_ORDER. */
  activeIndex: number
  className?: string
}

// Os 10 cristais empilhados; só o ativo aparece (ver .lp-crest em home.css).
export function CrestStack({ activeIndex, className }: CrestStackProps) {
  return (
    <div className={cn('relative aspect-square', className)}>
      {RANK_TIER_ORDER.map((tier, i) => (
        <img
          key={tier}
          src={`/ranks/${tier}.svg`}
          alt={i === activeIndex ? `Rank ${RANK_TIER_LABEL[tier]}` : ''}
          aria-hidden={i === activeIndex ? undefined : true}
          className={cn('lp-crest', i === activeIndex && 'on')}
          loading={i === 0 ? 'eager' : 'lazy'}
          decoding="async"
        />
      ))}
    </div>
  )
}
