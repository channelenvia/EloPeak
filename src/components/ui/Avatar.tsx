import * as RadixAvatar from '@radix-ui/react-avatar'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn, initials } from '@/lib/utils'
import { resolveRiotAvatarUrl } from '@/lib/riotAssets'

const avatarVariants = cva('relative flex shrink-0 overflow-hidden rounded-full bg-bg-elevated', {
  variants: {
    size: {
      xs: 'h-6 w-6 text-[10px]',
      sm: 'h-8 w-8 text-xs',
      md: 'h-9 w-9 text-sm',
      lg: 'h-11 w-11 text-base',
      xl: 'h-14 w-14 text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

interface AvatarProps extends VariantProps<typeof avatarVariants> {
  src?: string | null
  name?: string
  className?: string
}

export function Avatar({ src, name, size, className }: AvatarProps) {
  const resolvedSrc = resolveRiotAvatarUrl(src)

  return (
    <RadixAvatar.Root className={cn(avatarVariants({ size }), className)}>
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
