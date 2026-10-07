import { useEffect, useMemo, useRef, useState } from 'react'
import { CardPayment, StatusScreen, initMercadoPago } from '@mercadopago/sdk-react'
import { ErrorAlert } from '@/components/ui'
import { EdgeFunctionError } from '@/lib/invokeEdgeFunction'
import { useCurrency } from '@/hooks/useCurrency'
import { payWithCard } from '@/api/orders'
import type { CardPaymentResponse } from '@/api/orders'
import { useAuthStore } from '@/stores/authStore'
import { Loader2, ShieldCheck } from 'lucide-react'

const MP_PUBLIC_KEY = import.meta.env.VITE_MP_PUBLIC_KEY as string | undefined
const MAX_INSTALLMENTS = 12

export type CardPaymentAcceptance = 'approved' | 'pending'

export interface CardPaymentPanelProps {
  orderId: string
  totalPrice: number
  onAccepted: (acceptance: CardPaymentAcceptance) => void
}

const REJECTION_MESSAGES: Record<string, string> = {
  cc_rejected_insufficient_amount: 'Saldo ou limite insuficiente neste cartão. Tente outro cartão ou use o PIX.',
  cc_rejected_bad_filled_card_number: 'Número do cartão incorreto. Confira e tente novamente.',
  cc_rejected_bad_filled_date: 'Data de validade incorreta. Confira e tente novamente.',
  cc_rejected_bad_filled_security_code: 'Código de segurança incorreto. Confira e tente novamente.',
  cc_rejected_bad_filled_other: 'Algum dado do cartão está incorreto. Confira e tente novamente.',
  cc_rejected_call_for_authorize: 'O banco pede autorização para este pagamento. Fale com ele ou use outro cartão.',
  cc_rejected_card_disabled: 'Este cartão está desativado. Ative-o com o banco ou use outro.',
  cc_rejected_duplicated_payment: 'Você já fez um pagamento igual a este. Confira Meus Pedidos.',
  cc_rejected_high_risk: 'Não foi possível aprovar este pagamento por segurança. Use o PIX ou outro cartão.',
  cc_rejected_max_attempts: 'Limite de tentativas atingido para este cartão. Use outro cartão ou o PIX.',
}
const DEFAULT_REJECTION = 'Pagamento recusado. Tente outro cartão ou use o PIX.'

// O Brick vive num iframe/DOM próprio e só aceita cores literais, não classes:
// lê os tokens do tema (triplas RGB em :root) na hora de montar.
function readThemeVariables() {
  const style = getComputedStyle(document.documentElement)
  const rgb = (token: string, fallback: string) => {
    const value = style.getPropertyValue(token).trim()
    return value ? `rgb(${value.split(/\s+/).join(', ')})` : fallback
  }
  return {
    formBackgroundColor: rgb('--color-bg-surface', '#141417'),
    inputBackgroundColor: rgb('--color-bg-raised', '#1B1B1F'),
    textPrimaryColor: rgb('--color-ink', '#EDEEEF'),
    textSecondaryColor: rgb('--color-ink-secondary', '#A0A3A8'),
    baseColor: rgb('--color-brand', '#22C55E'),
    baseColorFirstVariant: rgb('--color-bg-raised', '#1B1B1F'),
    baseColorSecondVariant: rgb('--color-bg-raised', '#1B1B1F'),
    errorColor: rgb('--color-danger', '#EF4444'),
    successColor: rgb('--color-success', '#3DDC84'),
    outlinePrimaryColor: rgb('--color-brand', '#22C55E'),
    outlineSecondaryColor: rgb('--color-border-strong', '#3C3C43'),
    buttonTextColor: rgb('--color-ink-inverse', '#0E0E10'),
    borderRadiusMedium: '12px',
    formPadding: '0px',
  }
}

// Falha de rede/servidor: o MP pode ter cobrado -- manter a chave devolve o
// mesmo pagamento no retry. Qualquer outra resposta definitiva (inclusive uma
// cobrança já desfeita pelo servidor) pede chave nova.
function isRetryableWithSameKey(err: unknown) {
  if (!(err instanceof EdgeFunctionError) || err.code === 'PAYMENT_REVERSED') return false
  return err.code === 'NETWORK_ERROR' || err.status >= 500
}


function cardErrorMessage(err: unknown) {
  if (!(err instanceof EdgeFunctionError)) return 'Não foi possível processar o cartão. Tente novamente.'
  if (err.status === 401) return 'Sua sessão expirou. Entre novamente para pagar.'
  if (err.status === 429) return `Muitas tentativas seguidas. Aguarde ${Math.max(1, Math.ceil(err.retryAfter ?? 10))}s e tente novamente.`
  if (err.code === 'NETWORK_ERROR') return 'Não foi possível conectar. Tente novamente.'
  return err.message
}

// Formulário de cartão (Card Payment Brick do Mercado Pago). O número do cartão
// nunca passa pelo nosso servidor: o Brick tokeniza e só o token segue adiante.
export function CardPaymentPanel({ orderId, totalPrice, onAccepted }: CardPaymentPanelProps) {
  const currency = useCurrency()
  const [sdkReady, setSdkReady] = useState(false)
  const [brickReady, setBrickReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<{ paymentId: string; url: string; creq: string } | null>(null)
  const email = useAuthStore((s) => s.profile?.email) ?? undefined
  const idempotencyKeyRef = useRef(crypto.randomUUID())

  useEffect(() => {
    if (!MP_PUBLIC_KEY) return
    initMercadoPago(MP_PUBLIC_KEY, { locale: 'pt-BR' })
    setSdkReady(true)
  }, [])

  // Mudar essas props recria o Brick e apaga o que o cliente já digitou.
  const customization = useMemo(() => ({
    paymentMethods: { maxInstallments: MAX_INSTALLMENTS },
    visual: {
      hideFormTitle: true,
      style: { theme: 'dark' as const, customVariables: readThemeVariables() },
      texts: { formSubmit: 'Pagar com cartão' },
    },
  }), [])

  const challengeCustomization = useMemo(() => ({
    visual: { style: { theme: 'dark' as const, customVariables: readThemeVariables() } },
  }), [])

  if (!MP_PUBLIC_KEY) {
    return <ErrorAlert message="Pagamento por cartão indisponível no momento. Use o PIX." />
  }

  // true = tratado (aprovado, em análise ou desafio 3DS); false = recusado.
  function handleResult(result: CardPaymentResponse): boolean {
    if (result.status === 'approved') { onAccepted('approved'); return true }
    if (result.three_ds_info) {
      setChallenge({ paymentId: String(result.payment_id), url: result.three_ds_info.external_resource_url, creq: result.three_ds_info.creq })
      return true
    }
    if (['pending', 'in_process', 'authorized'].includes(result.status)) { onAccepted('pending'); return true }

    idempotencyKeyRef.current = crypto.randomUUID()
    setError(REJECTION_MESSAGES[result.status_detail ?? ''] ?? DEFAULT_REJECTION)
    return false
  }

  async function handleSubmit(data: Parameters<NonNullable<React.ComponentProps<typeof CardPayment>['onSubmit']>>[0]) {
    setError(null)
    try {
      const result = await payWithCard({
        orderId,
        idempotencyKey: idempotencyKeyRef.current,
        token: data.token,
        paymentMethodId: data.payment_method_id,
        issuerId: data.issuer_id,
        installments: data.installments,
        identification: data.payer?.identification ?? null,
      })
      if (handleResult(result)) return
    } catch (err) {
      // Pago no MP mas o pedido ainda não avançou (corrida com o webhook):
      // trata como aprovado -- o acompanhamento do pedido confirma e redireciona.
      if (err instanceof EdgeFunctionError && err.code === 'ALREADY_PAID') return onAccepted('approved')
      if (!isRetryableWithSameKey(err)) idempotencyKeyRef.current = crypto.randomUUID()
      setError(cardErrorMessage(err))
    }
    // Rejeitar devolve o Brick ao estado editável para outra tentativa.
    throw new Error('card_payment_not_accepted')
  }

  // Autenticação 3DS pedida pelo banco: o Status Screen abre o desafio e depois
  // mostra o resultado. A confirmação do pedido chega pelo acompanhamento do
  // pedido (polling/webhook) nas telas que usam este painel.
  if (challenge) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-ink-secondary">Seu banco pediu uma confirmação extra para liberar este pagamento.</p>
        <StatusScreen
          initialization={{ paymentId: challenge.paymentId, additionalInfo: { externalResourceURL: challenge.url, creq: challenge.creq } }}
          customization={challengeCustomization}
          locale="pt-BR"
          onError={() => setError('Não foi possível exibir a confirmação do banco. Acompanhe o pedido em Meus Pedidos.')}
        />
        {error && <ErrorAlert message={error} />}
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-4 rounded-2xl border border-border-subtle bg-bg-surface p-4 sm:p-5">
      <div>
        <p className="text-xs font-medium text-ink-muted">Total a pagar</p>
        <p className="text-2xl font-extrabold text-brand tabular-figures" data-tabular>{currency(totalPrice)}</p>
      </div>

      {error && <ErrorAlert message={error} />}

      <div className="relative min-h-40 border-t border-border-subtle pt-4">
        {!brickReady && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-ink-secondary">
            <Loader2 className="h-8 w-8 animate-spin text-brand" />
            Carregando formulário…
          </div>
        )}
        {sdkReady && (
          <CardPayment
            initialization={{ amount: totalPrice, payer: { email } }}
            customization={customization}
            locale="pt-BR"
            onSubmit={handleSubmit}
            onReady={() => setBrickReady(true)}
            onError={() => setError('Não foi possível carregar o formulário do cartão. Recarregue a página ou use o PIX.')}
          />
        )}
      </div>

      <p className="flex items-start gap-2 text-xs text-ink-muted">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
        Processado pelo Mercado Pago. Os dados do cartão não passam pelos nossos servidores.
      </p>
    </div>
  )
}
