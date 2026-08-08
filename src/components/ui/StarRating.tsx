import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'

interface StarRatingProps {
  rating: number
  count?: number
  size?: 'xs' | 'sm' | 'md'
  showValue?: boolean
}

const SIZE_CLASS: Record<NonNullable<StarRatingProps['size']>, string> = {
  xs: 'h-3 w-3',
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
}

export function StarRating({ rating, count, size = 'sm', showValue = true }: StarRatingProps) {
  const filled = Math.round(rating)
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star key={i} className={cn(SIZE_CLASS[size], i <= filled ? 'text-warning fill-warning' : 'text-bg-overlay')} />
        ))}
      </div>
      {showValue && <span className="text-sm font-bold text-ink">{rating.toFixed(1)}</span>}
      {count != null && <span className="text-xs text-ink-muted">({count} avaliações)</span>}
    </div>
  )
}
