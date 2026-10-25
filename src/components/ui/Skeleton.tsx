import type { CSSProperties } from 'react'
import { cn } from '@/lib/cn'
import { staggerStyle } from '@/lib/motion'

interface SkeletonProps {
  className?: string
  style?: CSSProperties
}

export function Skeleton({ className, style }: SkeletonProps) {
  return <div className={cn('skeleton h-4', className)} style={style} />
}

interface SkeletonListProps extends SkeletonProps {
  count: number
}

/** `count` skeletons iguais, soltos no grid/lista do pai, entrando em escada. */
export function SkeletonList({ count, className }: SkeletonListProps) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={cn('animate-rise', className)} style={staggerStyle(i)} />
      ))}
    </>
  )
}
