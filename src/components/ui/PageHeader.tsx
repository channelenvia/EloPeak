import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: React.ReactNode
  description?: React.ReactNode
  /** Rótulo pequeno acima do título (ex.: "Financeiro"). */
  eyebrow?: React.ReactNode
  /** Pills na MESMA linha do título. */
  badges?: React.ReactNode
  /** Ações à direita (botões, indicadores). */
  actions?: React.ReactNode
  className?: string
}

// Header padrão de toda página de lista/painel (admin, booster, cliente).
// Páginas de detalhe de uma entidade usam DetailPageHeader (com "voltar").
export function PageHeader({ title, description, eyebrow, badges, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        {eyebrow && <p className="section-label mb-2">{eyebrow}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-ink">{title}</h1>
          {badges}
        </div>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-secondary">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
