import { useState } from 'react'
import { Shield, Star, Gem, Diamond, Crown, Flame, Trophy } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { Division, RankTier } from '@/types'
import { RANK_TIER_LABEL, RANK_TIER_COLOR } from '@/lib/utils'

const MASTER_PLUS: RankTier[] = ['master', 'grandmaster', 'challenger']

const RANK_ICON_FALLBACK: Record<RankTier, React.ElementType> = {
  iron:        Shield,
  bronze:      Shield,
  silver:      Star,
  gold:        Star,
  platinum:    Gem,
  emerald:     Gem,
  diamond:     Diamond,
  master:      Crown,
  grandmaster: Flame,
  challenger:  Trophy,
}

// Emblemas oficiais (mini-crests da Riot) servidos de public/ranks/ -- antes
// vinham ao vivo da Community Dragon, que leva ~20s por arquivo e deixava o
// ícone em branco / caindo pro ícone genérico.
const rankImageUrl = (tier: RankTier) => `/ranks/${tier}.svg`

type BadgeSize = 'xs' | 'sm' | 'md' | 'lg'

interface RankBadgeProps {
  tier: RankTier
  division?: Division | null
  size?: BadgeSize
  className?: string
  showDivision?: boolean
  showLabel?: boolean
}

// wrap/img for when label is shown (taller badge)
// wrapIcon/imgBig for icon-only (square badge, bigger image)
const SIZE_MAP: Record<BadgeSize, {
  wrap: string; wrapIcon: string
  img: string;  imgBig: string
  icon: string; label: string; gap: string
}> = {
  xs: {
    wrap:     'w-9 h-11 rounded-lg p-1',      wrapIcon: 'w-9 h-9 rounded-lg p-1',
    img:      'h-5 w-5',                       imgBig:   'h-7 w-7',
    icon: 'h-4 w-4', label: 'text-2xs',  gap: 'gap-0.5',
  },
  sm: {
    wrap:     'w-12 h-14 rounded-xl p-1.5',   wrapIcon: 'w-12 h-12 rounded-xl p-1.5',
    img:      'h-7 w-7',                       imgBig:   'h-9 w-9',
    icon: 'h-5 w-5', label: 'text-2xs',  gap: 'gap-0.5',
  },
  md: {
    wrap:     'w-16 h-[74px] rounded-xl p-2', wrapIcon: 'w-16 h-16 rounded-xl p-2',
    img:      'h-9 w-9',                       imgBig:   'h-12 w-12',
    icon: 'h-6 w-6', label: 'text-2xs', gap: 'gap-1',
  },
  lg: {
    wrap:     'w-20 h-24 rounded-2xl p-2.5',  wrapIcon: 'w-20 h-20 rounded-2xl p-2.5',
    img:      'h-12 w-12',                     imgBig:   'h-14 w-14',
    icon: 'h-7 w-7', label: 'text-xs',     gap: 'gap-1.5',
  },
}

// Emblema local -> ícone lucide como último recurso (só se o arquivo falhar).
// Exportado -- é a ÚNICA implementação desse fallback no app; RankLockGrid
// consome RankIcon diretamente.
export function RankIcon({ tier, imgClass, iconClass }: { tier: RankTier; imgClass: string; iconClass: string }) {
  const [failed, setFailed] = useState(false)
  const FallbackIcon = RANK_ICON_FALLBACK[tier]
  const color        = RANK_TIER_COLOR[tier]

  if (failed) {
    return <FallbackIcon className={cn(iconClass, color)} />
  }

  return (
    <img
      src={rankImageUrl(tier)}
      alt={RANK_TIER_LABEL[tier]}
      className={cn(imgClass, 'object-contain')}
      onError={() => setFailed(true)}
      draggable={false}
    />
  )
}

export function RankBadge({
  tier, division, size = 'md', className, showDivision = true, showLabel = true,
}: RankBadgeProps) {
  const sc           = SIZE_MAP[size]
  const color        = RANK_TIER_COLOR[tier]
  const isMasterPlus = MASTER_PLUS.includes(tier)
  const divLabel     = showDivision && !isMasterPlus && division ? ` ${division}` : ''

  const wrapCls = showLabel ? sc.wrap     : sc.wrapIcon
  const imgCls  = showLabel ? sc.img      : sc.imgBig

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center bg-bg-raised border border-border-subtle shrink-0',
        wrapCls, showLabel ? sc.gap : '', className,
      )}
    >
      <RankIcon tier={tier} imgClass={imgCls} iconClass={sc.icon} />
      {showLabel && (
        <span className={cn('font-bold text-center leading-tight', sc.label, color)}>
          {RANK_TIER_LABEL[tier]}{divLabel}
        </span>
      )}
    </div>
  )
}
