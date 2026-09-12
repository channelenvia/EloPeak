import { AlertTriangle } from 'lucide-react'
import { Button, DetailPageHeader } from '@/components/ui'

interface OrderPageHeaderProps {
  backHref: string
  orderIdShort: string
  statusBadge: React.ReactNode
  /** Pills de ação na MESMA linha do código do pedido, logo após o status (ex.: "Concluído · Avaliar", "Atrasado · Discord"). */
  statusActions?: React.ReactNode
  /** Badges/infos extras abaixo do título (ex.: "pedido reatribuído", countdown). */
  extra?: React.ReactNode
  onDrop?: () => void
  dropDisabled?: boolean
  dropTooltip?: string
  primary?: React.ReactNode
}

/**
 * Header de página normal do dashboard (voltar + título+status à esquerda,
 * ações à direita) -- casca fina em cima de DetailPageHeader (mesmo header
 * genérico reaproveitado por BoosterDetail/CustomerDetail no admin), só fixa
 * o título como "Pedido #..." e adiciona o botão de Dropar. Reaproveitado
 * por cliente/booster/admin. O chat não abre mais por aqui -- fica sempre
 * visível inline na página (ver layout de 2 colunas em cada tela de
 * detalhe), então não há mais botão/badge de chat neste header.
 */
export function OrderPageHeader({
  backHref, orderIdShort, statusBadge, statusActions, extra, onDrop, dropDisabled, dropTooltip, primary,
}: OrderPageHeaderProps) {
  return (
    <DetailPageHeader
      backHref={backHref}
      title={`Pedido #${orderIdShort}`}
      titleBadges={<>{statusBadge}{statusActions}</>}
      subtitle={extra}
      actions={(onDrop || primary) && (
        <>
          {onDrop && (
            <Button
              variant="danger-ghost"
              size="sm"
              leftIcon={<AlertTriangle className="h-4 w-4" />}
              onClick={onDrop}
              disabled={dropDisabled}
              title={dropTooltip}
            >
              Dropar
            </Button>
          )}
          {primary}
        </>
      )}
    />
  )
}
