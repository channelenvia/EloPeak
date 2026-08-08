import * as RadixAvatar from '@radix-ui/react-avatar'
import { cn, initials } from '@/lib/utils'
import { resolveRiotAvatarUrl } from '@/lib/riotAssets'

interface AvatarProps {
  src?: string | null
  name?: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

const sizeMap = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-9 w-9 text-sm',
  lg: 'h-11 w-11 text-base',
  xl: 'h-14 w-14 text-lg',
}

export function Avatar({ src, name, size = 'md', className }: AvatarProps) {
  const resolvedSrc = resolveRiotAvatarUrl(src)

  return (
    <RadixAvatar.Root
      className={cn(
        'relative flex shrink-0 overflow-hidden rounded-full bg-bg-elevated',
        sizeMap[size],
        className
      )}
    >
      <RadixAvatar.Image
        src={resolvedSrc}
        alt={name}
        className="h-full w-full object-cover"
      />
      <RadixAvatar.Fallback
        className="flex h-full w-full items-center justify-center bg-gradient-brand text-white font-semibold"
        delayMs={400}
      >
        {name ? initials(name) : '?'}
      </RadixAvatar.Fallback>
    </RadixAvatar.Root>
  )
}
