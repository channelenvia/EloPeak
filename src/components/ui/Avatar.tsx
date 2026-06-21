import * as RadixAvatar from '@radix-ui/react-avatar'
import { cn, initials } from '@/lib/utils'

interface AvatarProps {
  src?: string | null
  name?: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  className?: string
  online?: boolean
}

const sizeMap = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-9 w-9 text-sm',
  lg: 'h-11 w-11 text-base',
  xl: 'h-14 w-14 text-lg',
}

const onlineDotMap = {
  xs: 'h-1.5 w-1.5 -bottom-px -right-px',
  sm: 'h-2 w-2 bottom-0 right-0',
  md: 'h-2.5 w-2.5 bottom-0 right-0',
  lg: 'h-3 w-3 bottom-0 right-0',
  xl: 'h-3.5 w-3.5 bottom-0.5 right-0.5',
}

export function Avatar({ src, name, size = 'md', className, online }: AvatarProps) {
  return (
    <div className="relative inline-block">
      <RadixAvatar.Root
        className={cn(
          'relative flex shrink-0 overflow-hidden rounded-full bg-bg-elevated',
          sizeMap[size],
          className
        )}
      >
        <RadixAvatar.Image
          src={src ?? undefined}
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
      {online !== undefined && (
        <span
          className={cn(
            'absolute rounded-full border-2 border-bg-base',
            onlineDotMap[size],
            online ? 'bg-success' : 'bg-ink-muted'
          )}
        />
      )}
    </div>
  )
}
