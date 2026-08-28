import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// Sistema de superfícies funcionais — 7 tipos com um propósito cada. Toda
// variante carrega a classe base "card"/"card-raised"/"card-glass"/
// "card-brand" pra preservar a herança tipográfica de @layer components
// (globals.css) mesmo quando @layer utilities sobrescreve bg/border/shadow
// (utilities sempre vence components na ordem de layer do Tailwind). Os 4
// nomes antigos (default/elevated/brand/glass) continuam válidos como
// aliases.
const cardVariants = cva('transition-all duration-base', {
  variants: {
    variant: {
      // Aliases retrocompatíveis
      default: 'card',
      elevated: 'card-raised',
      brand: 'card-brand',
      glass: 'card-glass',
      // Standard — agrupamento geral de informação. É o card "default".
      standard: 'card',
      // Interactive — clicável/navegável (order cards, booster cards).
      interactive: 'card cursor-pointer hover:bg-bg-raised/90 hover:border-border-strong hover:shadow-card-hover',
      // Primary — o objeto mais importante de contexto na tela (pedido
      // ativo, job ativo). Quem decide acender um glow de marca é quem usa o
      // componente (via className com shadow-brand), não o Card em si.
      primary: 'card-raised border-brand/25',
      // Operational — informação densa (tabelas/listas admin). Decoração
      // mínima: sem blur, sem sombra.
      operational: 'card backdrop-blur-none shadow-none bg-bg-surface',
      // Achievement — rank, progressão, performance, contexto premium.
      achievement: 'card-raised border-t-2 border-t-accent/40',
      // Attention — algo precisa de ação (reembolso pendente, drop, booster
      // bloqueado). Cor controlada por "tone" (padrão danger).
      attention: 'card backdrop-blur-none border-l-2 border-l-danger/50 bg-danger/[0.03]',
      // Elevated Overlay — conteúdo de modal/popover/panel.
      overlay: 'card-glass',
    },
    tone: {
      danger: '',
      warning: '',
      info: '',
    },
    padding: {
      none: '',
      sm: 'p-4',
      md: 'p-5',
      lg: 'p-6',
    },
  },
  compoundVariants: [
    { variant: 'attention', tone: 'warning', class: 'border-l-warning/50 bg-warning/[0.03]' },
    { variant: 'attention', tone: 'info', class: 'border-l-info/50 bg-info/[0.03]' },
  ],
  defaultVariants: {
    variant: 'default',
    tone: 'danger',
    padding: 'md',
  },
})

interface CardProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {}

export function Card({ className, variant, tone, padding, children, ...props }: CardProps) {
  return (
    <div className={cn(cardVariants({ variant, tone, padding }), className)} {...props}>
      {children}
    </div>
  )
}
