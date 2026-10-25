import { ActionBar } from '@/components/ui/ActionBar'
import { Button, Modal } from '@/components/ui'
import { RotateCcw } from 'lucide-react'

interface OrderBuilderConfirmModalsProps {
  hasPendingOrder: boolean
  showRestartConfirm: boolean
  onRestartOpenChange: (open: boolean) => void
  onConfirmRestart: () => void
  showExitConfirm: boolean
  onExitOpenChange: (open: boolean) => void
  onConfirmExit: () => void
}

export function OrderBuilderConfirmModals(props: OrderBuilderConfirmModalsProps) {
  return (
    <>
      <Modal open={props.showRestartConfirm} onOpenChange={props.onRestartOpenChange} title="Reiniciar configuração?" maxWidth="sm">
        <p className="text-sm text-ink-secondary">
          Você vai perder toda a configuração deste pedido (serviço, ranks e extras) e voltar ao primeiro passo. Deseja realmente reiniciar?
        </p>
        {props.hasPendingOrder && (
          <p className="text-sm text-ink-secondary">
            O pedido que você já gerou continua salvo em <strong className="text-ink">Meus Pedidos</strong>.
          </p>
        )}
        <ActionBar>
          <Button variant="secondary" onClick={() => props.onRestartOpenChange(false)}>Cancelar</Button>
          <Button variant="danger" leftIcon={<RotateCcw className="h-4 w-4" />} onClick={props.onConfirmRestart}>Reiniciar</Button>
        </ActionBar>
      </Modal>

      <Modal open={props.showExitConfirm} onOpenChange={props.onExitOpenChange} title="Sair sem pagar?" maxWidth="sm">
        <p className="text-sm text-ink-secondary">
          Seu configurador será reiniciado, mas seu pedido continua salvo — você pode pagar a qualquer momento na aba <strong className="text-ink">Meus Pedidos</strong>.
        </p>
        <ActionBar>
          <Button variant="secondary" onClick={() => props.onExitOpenChange(false)}>Continuar pagamento</Button>
          <Button variant="danger" onClick={props.onConfirmExit}>Sair e reiniciar</Button>
        </ActionBar>
      </Modal>
    </>
  )
}
