import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from './Button'

interface DetailPageHeaderProps {
  backHref: string
  title: React.ReactNode
  /** Badges/pills na MESMA linha do título (status, "TOP 3" etc.). */
  titleBadges?: React.ReactNode
  /** Linha secundária abaixo do título (email, contagem, countdown...). */
  subtitle?: React.ReactNode
  /** Ações à direita (botões). */
  actions?: React.ReactNode
}

// Header padrão de toda página de detalhe de uma única entidade (pedido,
// booster, cliente) -- voltar + título+badges à esquerda, ações à direita.
// OrderPageHeader é uma casca fina em cima deste componente (título fixo
// "Pedido #..." + slot de Dropar), reaproveitado assim pelas 3 telas de
// detalhe de pedido; BoosterDetail/CustomerDetail (admin) usam este
// componente direto, pra não ter 3 estruturas de header hand-rolled diferentes.
export function DetailPageHeader({ backHref, title, titleBadges, subtitle, actions }: DetailPageHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <Button asChild variant="ghost" size="icon" aria-label="Voltar" className="shrink-0">
          <Link to={backHref}><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-ink truncate">{title}</h1>
            {titleBadges}
          </div>
          {subtitle && <div className="flex items-center gap-2 flex-wrap mt-1">{subtitle}</div>}
        </div>
      </div>

      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}
