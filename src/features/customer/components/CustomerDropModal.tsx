import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ActionBar } from '@/components/ui/ActionBar'
import { Button, ErrorAlert, Modal } from '@/components/ui'
import { useRequestCustomerOrderDrop } from '@/api/orders'
import type { Order } from '@/types'

// Mesmo teto de drop_count usado pelo backend (apply_order_drop, ver supabase/migrations).
export const MAX_CUSTOMER_DROPS = 2

const dropSchema = z.object({ reason: z.string().trim().min(10, 'Motivo deve ter pelo menos 10 caracteres.') })

export function CustomerDropModal({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
  const requestDrop = useRequestCustomerOrderDrop(order.id)
  const remainingDrops = Math.max(0, MAX_CUSTOMER_DROPS - order.drop_count)
  const { register, handleSubmit, reset, formState: { isValid } } = useForm<{ reason: string }>({
    resolver: zodResolver(dropSchema),
    defaultValues: { reason: '' },
    mode: 'onChange',
  })

  function close() { onClose(); reset({ reason: '' }) }
  function submit(data: { reason: string }) {
    requestDrop.mutate(data.reason.trim(), { onSuccess: close })
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) close() }}
      title="Solicitar troca de booster"
      description="Enviamos ao admin para aprovação. O pedido continua ativo e passa para outro booster, sem cobrança ou reembolso."
    >
      <p className="text-xs font-medium text-ink-secondary bg-bg-raised rounded-lg px-3 py-2">
        Você ainda possui {remainingDrops} drop{remainingDrops === 1 ? '' : 's'} disponíve{remainingDrops === 1 ? 'l' : 'is'} para este pedido.
      </p>
      <div>
        <label htmlFor="customer-drop-reason" className="text-xs font-semibold text-ink-secondary block mb-1.5">
          Motivo <span className="text-danger">*</span>
        </label>
        <textarea id="customer-drop-reason" {...register('reason')} placeholder="Descreva o motivo…" className="input-base w-full min-h-[100px] resize-none text-sm" maxLength={500} />
      </div>
      {requestDrop.isError && (
        <ErrorAlert message={requestDrop.error instanceof Error ? requestDrop.error.message : 'Erro'} className="mt-2" />
      )}
      <ActionBar>
        <Button disabled={requestDrop.isPending} variant="secondary" onClick={close}>Cancelar</Button>
        <Button variant="danger" loading={requestDrop.isPending} disabled={!isValid} onClick={handleSubmit(submit)}>
          Enviar solicitação
        </Button>
      </ActionBar>
    </Modal>
  )
}
