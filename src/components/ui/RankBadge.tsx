import { useState } from 'react'
import { Shield, Star, Gem, Diamond, Crown, Flame, Trophy } from 'lucide-react'
import { cn } from '@/lib/utils'
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

const RANK_IMAGE: Record<RankTier, string> = {
  iron:        '/ranks/1_iron.webp',
  bronze:      '/ranks/2_bronze.webp',
  silver:      '/ranks/3_silver.webp',
  gold:        '/ranks/4_gold.webp',
  platinum:    '/ranks/5_platinum.webp',
  emerald:     '/ranks/7_emerald.webp',
  diamond:     '/ranks/6_diamond.webp',
  master:      '/ranks/7_master.webp',
  grandmaster: '/ranks/8_grandmaster.webp',
  challenger:  '/ranks/9_challenger.webp',
}

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
    icon: 'h-4 w-4', label: 'text-[8px]',  gap: 'gap-0.5',
  },
  sm: {
    wrap:     'w-12 h-14 rounded-xl p-1.5',   wrapIcon: 'w-12 h-12 rounded-xl p-1.5',
    img:      'h-7 w-7',                       imgBig:   'h-9 w-9',
    icon: 'h-5 w-5', label: 'text-[9px]',  gap: 'gap-0.5',
  },
  md: {
    wrap:     'w-16 h-[74px] rounded-xl p-2', wrapIcon: 'w-16 h-16 rounded-xl p-2',
    img:      'h-9 w-9',                       imgBig:   'h-12 w-12',
    icon: 'h-6 w-6', label: 'text-[10px]', gap: 'gap-1',
  },
  lg: {
    wrap:     'w-20 h-24 rounded-2xl p-2.5',  wrapIcon: 'w-20 h-20 rounded-2xl p-2.5',
    img:      'h-12 w-12',                     imgBig:   'h-14 w-14',
    icon: 'h-7 w-7', label: 'text-xs',     gap: 'gap-1.5',
  },
}

function RankIcon({ tier, imgClass, iconClass }: { tier: RankTier; imgClass: string; iconClass: string }) {
  const [imgError, setImgError] = useState(false)
  const FallbackIcon = RANK_ICON_FALLBACK[tier]
  const color        = RANK_TIER_COLOR[tier]

  if (!imgError) {
    return (
      <img
        src={RANK_IMAGE[tier]}
        alt={RANK_TIER_LABEL[tier]}
        className={cn(imgClass, 'object-contain')}
        onError={() => setImgError(true)}
        draggable={false}
      />
    )
  }

  return <FallbackIcon className={cn(iconClass, color)} />
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
        'flex flex-col items-center justify-center bg-bg-elevated border border-bg-overlay shrink-0',
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
