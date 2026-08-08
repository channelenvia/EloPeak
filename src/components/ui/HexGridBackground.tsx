import { cn } from '@/lib/utils'

// Textura de assinatura: grid hexagonal quase imperceptível (~4% opacidade),
// referência direta ao hextech/emblemas de elo do próprio produto — não é
// um padrão decorativo genérico. Uso: primeiro filho de um container
// `relative overflow-hidden` (hero, empty state).
export function HexGridBackground({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 opacity-[0.04]',
        className,
      )}
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg width='56' height='100' viewBox='0 0 56 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M28 0L56 16.5V49.5L28 66L0 49.5V16.5Z' fill='none' stroke='%2322C55E' stroke-width='1'/%3E%3C/svg%3E")`,
        backgroundSize: '56px 100px',
      }}
    />
  )
}
