import { useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Wallet, Banknote, PiggyBank, Hourglass, Send, FileText, XCircle, ShieldAlert, CalendarClock } from 'lucide-react'
import { Button, Card, Skeleton, EmptyState, StatCard, ErrorAlert, CurrencyMaskedInput } from '@/components/ui'
import { formatDateTime, cn, PAYOUT_REQUEST_STATUS_LABEL, PAYOUT_REQUEST_STATUS_COLOR } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { useCurrency } from '@/hooks/useCurrency'
import { useBoosterActiveDropWarnings, useBoosterBlockedUntil } from '@/api/boosters'
import { isWithdrawalWindowOpen, nextWithdrawalDayLabel } from '@/lib/payoutWithdrawalWindow'
import {
  useBoosterPayoutTotals, useBoosterPayoutRequests, useRequestPayout, useCancelPayoutRequest,
  getPayoutProofSignedUrl, MIN_PAYOUT_AMOUNT,
} from '@/api/payouts'

const STATUS_LABEL = PAYOUT_REQUEST_STATUS_LABEL
const STATUS_COLOR = PAYOUT_REQUEST_STATUS_COLOR

interface PayoutFormData {
  cents: number
}

function RequestPayoutCard({ available }: { available: number }) {
  const { profile } = useAuthStore()
  const currency = useCurrency()
  const requestPayout = useRequestPayout(profile?.id)

  const availableCents = Math.round(available * 100)
  const hasBalance = availableCents >= MIN_PAYOUT_AMOUNT * 100
  const rangeMessage = `Informe um valor entre ${currency(MIN_PAYOUT_AMOUNT)} e ${currency(available)}.`

  // Backend (RPC request_payout) sempre reforça o limite de saldo -- esse
  // schema é só pra dar feedback imediato e consistente com o resto do
  // projeto (mesmo padrão de zodResolver de BoosterApplicationForm.tsx).
  const schema = z.object({
    cents: z.number({ invalid_type_error: 'Informe um valor de saque.' })
      .int()
      .min(MIN_PAYOUT_AMOUNT * 100, rangeMessage)
      .max(availableCents, rangeMessage),
  })

  const {
    control, handleSubmit, setValue, watch, trigger, reset,
    formState: { errors, isValid },
  } = useForm<PayoutFormData>({
    resolver: zodResolver(schema),
    defaultValues: { cents: 0 },
    mode: 'onChange',
  })

  const cents = watch('cents')

  // formState.isValid parte como `true` (otimista) até a primeira validação
  // rodar -- sem isso, o botão "Solicitar" ficaria habilitado por um
  // instante antes de qualquer interação, mesmo com valor 0.
  useEffect(() => {
    trigger('cents')
  }, [trigger, availableCents])

  function onSubmit(data: PayoutFormData) {
    requestPayout.mutate(data.cents / 100, { onSuccess: () => reset({ cents: 0 }) })
  }

  return (
    <Card padding="md" className="ring-1 ring-brand/20">
      <div className="flex items-center gap-2 mb-3">
        <Send className="h-4 w-4 text-brand" />
        <h3 className="text-sm font-semibold text-ink">Solicitar saque</h3>
      </div>
      <p className="text-xs text-ink-muted mb-4">
        Disponível: <span className="font-bold text-ink" data-tabular>{currency(available)}</span>
        {' · '}Mínimo: <span className="font-bold text-ink" data-tabular>{currency(MIN_PAYOUT_AMOUNT)}</span>
      </p>
      <form className="flex gap-2" onSubmit={handleSubmit(onSubmit)}>
        <Controller
          control={control}
          name="cents"
          render={({ field }) => (
            <CurrencyMaskedInput
              valueCents={field.value}
              onChangeCents={field.onChange}
              maxCents={availableCents}
              disabled={!hasBalance}
              className="flex-1 text-sm"
              aria-label="Valor do saque"
            />
          )}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={!hasBalance}
          onClick={() => setValue('cents', availableCents, { shouldValidate: true })}
        >
          Max
        </Button>
        <Button
          type="submit"
          loading={requestPayout.isPending}
          disabled={!hasBalance || !isValid}
        >
          Solicitar
        </Button>
      </form>
      {!hasBalance ? (
        <p className="text-xs text-ink-muted mt-2">
          Você precisa de pelo menos {currency(MIN_PAYOUT_AMOUNT)} disponível pra solicitar um saque.
        </p>
      ) : cents > 0 && errors.cents && (
        <p className="text-xs text-danger mt-2">{errors.cents.message}</p>
      )}
      {requestPayout.isError && (
        <ErrorAlert className="mt-2" message={requestPayout.error instanceof Error ? requestPayout.error.message : 'Erro ao solicitar saque.'} />
      )}
    </Card>
  )
}

function WithdrawalWindowClosedCard() {
  return (
    <Card padding="md" className="ring-1 ring-border-subtle">
      <div className="flex items-center gap-2 mb-1">
        <CalendarClock className="h-4 w-4 text-ink-muted" />
        <h3 className="text-sm font-semibold text-ink">Solicitação de saque fechada</h3>
      </div>
      <p className="text-xs text-ink-secondary">
        Saques só podem ser solicitados nos dias 15 e 30 de cada mês. Próxima janela:{' '}
        <span className="font-bold text-ink">{nextWithdrawalDayLabel(new Date())}</span>.
      </p>
    </Card>
  )
}

export function BoosterPaymentsPage() {
  const { profile } = useAuthStore()
  const currency = useCurrency()
  const withdrawalWindowOpen = isWithdrawalWindowOpen(new Date())

  const { data: totals, isLoading: loadingTotals } = useBoosterPayoutTotals(profile?.id)
  const { data: requests, isLoading: loadingRequests } = useBoosterPayoutRequests(profile?.id)
  const cancelRequest = useCancelPayoutRequest(profile?.id)
  const { data: activeWarnings } = useBoosterActiveDropWarnings(profile?.id)
  const { data: blockedUntil } = useBoosterBlockedUntil(profile?.id)
  const isBlocked = !!blockedUntil && new Date(blockedUntil) > new Date()

  const BALANCE_BOXES = [
    { label: 'Total Ganho', value: totals?.total_earned ?? 0, icon: Wallet, color: 'text-success bg-success/10' },
    { label: 'Disponível para saque', value: totals?.available_balance ?? 0, icon: PiggyBank, color: 'text-success bg-success/10' },
    { label: 'Reservado (em análise)', value: totals?.reserved ?? 0, icon: Hourglass, color: 'text-warning bg-warning/10' },
    { label: 'Total Pago', value: totals?.total_paid ?? 0, icon: Banknote, color: 'text-brand bg-brand/10' },
  ]

  async function viewProof(proofUrl: string) {
    const url = await getPayoutProofSignedUrl(proofUrl)
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Pagamentos</h1>
        <p className="text-ink-secondary mt-1">Saldo, saques e histórico de solicitações.</p>
      </div>

      {(!!activeWarnings || isBlocked) && (
        <Card padding="md" className="ring-1 ring-warning/30">
          <div className="flex items-center gap-2 mb-1">
            <ShieldAlert className="h-4 w-4 text-warning" />
            <h3 className="text-sm font-semibold text-ink">Advertências de drop</h3>
          </div>
          <p className="text-xs text-ink-secondary">
            <span className="font-bold text-ink">{activeWarnings ?? 0}/5</span> advertências ativas (expiram 30 dias após serem geradas).
            {isBlocked && (
              <> Você está impedido de pegar novos pedidos até <span className="font-bold text-danger">{formatDateTime(blockedUntil!)}</span>.</>
            )}
          </p>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {BALANCE_BOXES.map(({ label, value, icon, color }) => (
          <StatCard key={label} label={label} icon={icon} color={color} value={loadingTotals ? <Skeleton className="h-6 w-20" /> : currency(value)} />
        ))}
      </div>

      {withdrawalWindowOpen ? (
        <RequestPayoutCard available={totals?.available_balance ?? 0} />
      ) : (
        <WithdrawalWindowClosedCard />
      )}

      <Card padding="md">
        <h3 className="text-sm font-semibold text-ink mb-4">Histórico de solicitações</h3>
        {loadingRequests ? (
          <Skeleton className="h-32 w-full" />
        ) : !requests?.length ? (
          <EmptyState icon={Wallet} title="Nenhuma solicitação de saque ainda." />
        ) : (
          <div className="space-y-2">
            {requests.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 py-3 border-b border-border-subtle last:border-0">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-ink" data-tabular>{currency(r.amount)}</p>
                  <p className="text-xs text-ink-muted">{formatDateTime(r.requested_at)}</p>
                  {r.admin_note && <p className="text-xs text-ink-secondary mt-0.5">{r.admin_note}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', STATUS_COLOR[r.status])}>
                    {STATUS_LABEL[r.status]}
                  </span>
                  {r.status === 'paid' && r.proof_url && (
                    <Button size="xs" variant="secondary" leftIcon={<FileText className="h-3.5 w-3.5" />} onClick={() => viewProof(r.proof_url!)}>
                      Comprovante
                    </Button>
                  )}
                  {(r.status === 'requested' || r.status === 'under_review') && (
                    <Button size="xs" variant="danger-ghost" leftIcon={<XCircle className="h-3.5 w-3.5" />} loading={cancelRequest.isPending} onClick={() => cancelRequest.mutate(r.id)}>
                      Cancelar
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
