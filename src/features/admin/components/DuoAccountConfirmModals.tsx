import { ActionBar } from '@/components/ui/ActionBar'
import { Button, ErrorAlert, Modal } from '@/components/ui'
import type { AdminDuoAccount } from '@/api/duoAccounts'

interface DeleteProps {
  target: AdminDuoAccount | null
  isPending: boolean
  isError: boolean
  error: unknown
  onClose: () => void
  onConfirm: (id: string) => void
}

export function DeleteDuoAccountModal({ target, isPending, isError, error, onClose, onConfirm }: DeleteProps) {
  return (
    <Modal
      open={!!target}
      onOpenChange={(open) => !open && onClose()}
      title="Excluir conta Duo"
      description={`Tem certeza que quer excluir "${target?.riot_id ?? target?.label}"? Essa ação não pode ser desfeita.`}
    >
      <div className="space-y-3">
        {isError && <ErrorAlert message={error instanceof Error ? error.message : 'Erro ao excluir'} />}
        <ActionBar>
          <Button disabled={isPending} variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="danger" loading={isPending} onClick={() => target && onConfirm(target.id)}>
            Excluir
          </Button>
        </ActionBar>
      </div>
    </Modal>
  )
}

interface ReleaseProps {
  target: AdminDuoAccount | null
  isPending: boolean
  onClose: () => void
  onConfirm: (id: string) => void
}

export function ReleaseDuoReservationModal({ target, isPending, onClose, onConfirm }: ReleaseProps) {
  return (
    <Modal
      open={!!target}
      onOpenChange={(open) => !open && onClose()}
      title="Liberar reserva"
      description={`Isso força a liberação da conta "${target?.riot_id ?? target?.label}", mesmo que um booster esteja usando ela agora no meio de um boost.`}
    >
      <ActionBar>
        <Button disabled={isPending} variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button variant="danger" loading={isPending} onClick={() => target && onConfirm(target.id)}>
          Liberar
        </Button>
      </ActionBar>
    </Modal>
  )
}
