import { useEffect, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ActionBar } from '@/components/ui/ActionBar'
import { Button, CurrencyMaskedInput, ErrorAlert, Modal } from '@/components/ui'
import { useCurrency } from '@/hooks/useCurrency'
import { useAdminAdjustBoosterBalance } from '@/api/admin'
import { useBoosterPayoutTotals } from '@/api/payouts'

interface AdjustBalanceFormData {
  reason: string
  amountCents: number
}

export function AdjustBoosterBalanceModal({ boosterId, open, onClose }: { boosterId: string; open: boolean; onClose: () => void }) {
  const currency = useCurrency()
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit')
  const adjust = useAdminAdjustBoosterBalance()
  // Só usado como teto de UX pro débito -- se a RPC não devolver o saldo (ex.:
  // função restrita ao próprio booster), o backend segue como fonte de verdade.
  const { data: totals } = useBoosterPayoutTotals(open ? boosterId : undefined)
  const maxDebitCents = direction === 'debit' && totals ? Math.round(totals.available_balance * 100) : undefined

  const { control, register, handleSubmit, watch, reset, trigger, formState: { isValid } } = useForm<AdjustBalanceFormData>({
    resolver: zodResolver(z.object({
      reason: z.string().trim().min(10, 'Motivo deve ter pelo menos 10 caracteres.').max(500),
      amountCents: z.number({ error: 'Informe um valor.' }).int().min(1, 'Informe um valor.'),
    })),
    defaultValues: { reason: '', amountCents: 0 },
    mode: 'onChange',
  })

  const amountCents = watch('amountCents')
  useEffect(() => { void trigger('amountCents') }, [maxDebitCents, trigger])

  function close() {
    onClose()
    reset({ reason: '', amountCents: 0 })
    setDirection('credit')
  }

  const canSubmit = isValid && (maxDebitCents === undefined || amountCents <= maxDebitCents)

  function onSubmit(data: AdjustBalanceFormData) {
    adjust.mutate(
      { boosterId, amount: direction === 'debit' ? -(data.amountCents / 100) : data.amountCents / 100, reason: data.reason.trim() },
      { onSuccess: close },
    )
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) close() }}
      title="Ajustar saldo do booster"
      description="Credita ou debita diretamente o saldo do booster (booster_ledger_entries) -- use pra fechar um caso em análise junto com o reembolso do cliente."
    >
      <div className="flex gap-2">
        <Button
          variant={direction === 'credit' ? 'primary' : 'secondary'}
          className="flex-1"
          onClick={() => setDirection('credit')}
        >
          Creditar
        </Button>
        <Button
          variant={direction === 'debit' ? 'danger' : 'secondary'}
          className="flex-1"
          onClick={() => setDirection('debit')}
        >
          Debitar
        </Button>
      </div>

      <div>
        <label className="text-xs font-semibold text-ink-secondary block mb-1.5">Valor</label>
        <Controller
          control={control}
          name="amountCents"
          render={({ field }) => (
            <CurrencyMaskedInput valueCents={field.value} onChangeCents={field.onChange} maxCents={maxDebitCents} aria-label="Valor do ajuste" />
          )}
        />
        {maxDebitCents !== undefined && amountCents > maxDebitCents && (
          <p className="text-xs text-danger mt-1">Valor não pode passar do saldo disponível do booster ({currency(totals!.available_balance)}).</p>
        )}
      </div>

      <div>
        <label htmlFor="adjust-balance-reason" className="text-xs font-semibold text-ink-secondary block mb-1.5">Motivo (mín. 10 caracteres)</label>
        <textarea
          id="adjust-balance-reason"
          {...register('reason')}
          placeholder="Descreva o motivo do ajuste…"
          className="input-base w-full min-h-[80px] resize-none text-sm"
          maxLength={500}
        />
      </div>

      {adjust.isError && (
        <ErrorAlert message={adjust.error instanceof Error ? adjust.error.message : 'Erro'} />
      )}

      <ActionBar>
        <Button disabled={adjust.isPending} variant="secondary" onClick={close}>Cancelar</Button>
        <Button
          variant={direction === 'debit' ? 'danger' : 'primary'}
          loading={adjust.isPending}
          disabled={!canSubmit}
          onClick={handleSubmit(onSubmit)}
        >
          Confirmar ajuste
        </Button>
      </ActionBar>
    </Modal>
  )
}
