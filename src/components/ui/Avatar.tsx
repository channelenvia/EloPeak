import { useState } from 'react'
import * as RadixAvatar from '@radix-ui/react-avatar'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn, initials } from '@/lib/utils'
import { parseRiotProfileIconId, resolveRiotAvatarUrl } from '@/lib/riotAssets'
import { useDdragonVersion } from '@/lib/ddragon'

const avatarVariants = cva('relative flex shrink-0 overflow-hidden rounded-full bg-bg-raised', {
  variants: {
    size: {
      xs: 'h-6 w-6 text-2xs',
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
  // Ícone de perfil da Riot: Data Dragon primeiro (CDN rápida); a Community
  // Dragon (~20s por arquivo) só entra se o ícone não existir no ddragon.
  const ddragonVersion = useDdragonVersion()
  const [ddragonFailed, setDdragonFailed] = useState(false)
  const iconId = parseRiotProfileIconId(src)
  const resolvedSrc = iconId !== null && ddragonVersion && !ddragonFailed
    ? `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/profileicon/${iconId}.png`
    : resolveRiotAvatarUrl(src)

  return (
    <RadixAvatar.Root className={cn(avatarVariants({ size }), className)}>
      <RadixAvatar.Image
        key={resolvedSrc}
        src={resolvedSrc}
        onLoadingStatusChange={(status) => { if (status === 'error' && iconId !== null) setDdragonFailed(true) }}
        alt={name}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
      />
      <RadixAvatar.Fallback
        className="flex h-full w-full items-center justify-center bg-gradient-brand text-ink-inverse font-semibold"
        delayMs={400}
      >
        {name ? initials(name) : '?'}
      </RadixAvatar.Fallback>
    </RadixAvatar.Root>
  )
}
