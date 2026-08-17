import { useId } from 'react'
import { cn } from '@/lib/utils'

// Textura de assinatura: grid hexagonal quase imperceptível (~4% opacidade),
// referência direta ao hextech/emblemas de elo do próprio produto — não é
// um padrão decorativo genérico. Uso: primeiro filho de um container
// `relative overflow-hidden` (hero, empty state).
// SVG inline (não data-URI) pra que o stroke herde currentColor -- assim a
// cor da marca vem só de text-brand (globals.css --color-brand), sem
// duplicar o hex aqui.
export function HexGridBackground({ className }: { className?: string }) {
  const patternId = `hex-grid-pattern-${useId()}`
  return (
    <svg
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 h-full w-full opacity-[0.04] text-brand',
        className,
      )}
    >
      <defs>
        <pattern id={patternId} width="56" height="100" patternUnits="userSpaceOnUse">
          <path d="M28 0L56 16.5V49.5L28 66L0 49.5V16.5Z" fill="none" stroke="currentColor" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  )
}
