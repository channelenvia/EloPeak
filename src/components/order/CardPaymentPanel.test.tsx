// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EdgeFunctionError } from '@/lib/invokeEdgeFunction'
import { payWithCard } from '@/api/orders'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/api/orders', () => ({ payWithCard: vi.fn() }))
vi.mock('@mercadopago/sdk-react', () => ({
  initMercadoPago: vi.fn(),
  CardPayment: ({ onSubmit, onReady }: { onSubmit: (d: unknown) => Promise<void>; onReady: () => void }) => {
    onReady()
    return (
      <button onClick={() => onSubmit({
        token: 'tok_123', payment_method_id: 'visa', issuer_id: '24', installments: 3,
        payer: { identification: { type: 'CPF', number: '12345678909' } },
      }).catch(() => {})}
      >
        enviar cartão
      </button>
    )
  },
  StatusScreen: ({ initialization }: { initialization: { paymentId: string } }) => <div>desafio 3DS {initialization.paymentId}</div>,
}))

const ORDER_ID = '22222222-2222-4222-8222-222222222222'
const BASE = { order_id: ORDER_ID, payment_id: 99, status_detail: null }

let CardPaymentPanel: typeof import('./CardPaymentPanel').CardPaymentPanel

beforeAll(async () => {
  vi.stubEnv('VITE_MP_PUBLIC_KEY', 'TEST-public-key')
  ;({ CardPaymentPanel } = await import('./CardPaymentPanel'))
})

beforeEach(() => {
  vi.clearAllMocks()
})

async function submitCard(onAccepted = vi.fn()) {
  render(<CardPaymentPanel orderId={ORDER_ID} totalPrice={100} onAccepted={onAccepted} />)
  await userEvent.click(await screen.findByRole('button', { name: 'enviar cartão' }))
  return onAccepted
}

describe('CardPaymentPanel', () => {
  it('envia só token e dados do formulário, nunca valor', async () => {
    vi.mocked(payWithCard).mockResolvedValue({ ...BASE, status: 'approved' })
    const onAccepted = await submitCard()
    expect(onAccepted).toHaveBeenCalledWith('approved')
    const sent = vi.mocked(payWithCard).mock.calls[0][0]
    expect(sent).toMatchObject({ orderId: ORDER_ID, token: 'tok_123', installments: 3 })
    expect(JSON.stringify(sent)).not.toMatch(/amount|price/i)
  })

  it('em análise avisa o pai sem tratar como erro', async () => {
    vi.mocked(payWithCard).mockResolvedValue({ ...BASE, status: 'in_process' })
    expect(await submitCard()).toHaveBeenCalledWith('pending')
  })

  it('recusa mostra o motivo e usa uma idempotency key nova na próxima tentativa', async () => {
    vi.mocked(payWithCard).mockResolvedValue({ ...BASE, status: 'rejected', status_detail: 'cc_rejected_insufficient_amount' })
    const onAccepted = await submitCard()
    expect(await screen.findByText(/Saldo ou limite insuficiente/)).toBeInTheDocument()
    expect(onAccepted).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'enviar cartão' }))
    const keys = vi.mocked(payWithCard).mock.calls.map(([params]) => params.idempotencyKey)
    expect(keys[0]).not.toEqual(keys[1])
  })

  it('erro de servidor repete a MESMA idempotency key (evita cobrar duas vezes)', async () => {
    vi.mocked(payWithCard).mockRejectedValue(new EdgeFunctionError({ status: 500, message: 'x', body: null }))
    await submitCard()
    await screen.findByText(/x/)
    await userEvent.click(screen.getByRole('button', { name: 'enviar cartão' }))
    const keys = vi.mocked(payWithCard).mock.calls.map(([params]) => params.idempotencyKey)
    expect(keys[0]).toEqual(keys[1])
  })

  it('cobrança desfeita pelo servidor (PAYMENT_REVERSED) exige chave nova', async () => {
    vi.mocked(payWithCard).mockRejectedValue(new EdgeFunctionError({ status: 409, code: 'PAYMENT_REVERSED', message: 'desfeita', body: null }))
    await submitCard()
    await screen.findByText('desfeita')
    await userEvent.click(screen.getByRole('button', { name: 'enviar cartão' }))
    const keys = vi.mocked(payWithCard).mock.calls.map(([params]) => params.idempotencyKey)
    expect(keys[0]).not.toEqual(keys[1])
  })

  it('já pago (ALREADY_PAID) é tratado como aprovado, sem erro', async () => {
    vi.mocked(payWithCard).mockRejectedValue(new EdgeFunctionError({ status: 409, code: 'ALREADY_PAID', message: 'pago', body: null }))
    expect(await submitCard()).toHaveBeenCalledWith('approved')
  })

  it('desafio 3DS abre a confirmação do banco em vez de erro', async () => {
    vi.mocked(payWithCard).mockResolvedValue({
      ...BASE, status: 'pending', status_detail: 'pending_challenge',
      three_ds_info: { external_resource_url: 'https://acs.example.com/c', creq: 'creq' },
    })
    const onAccepted = await submitCard()
    expect(await screen.findByText('desafio 3DS 99')).toBeInTheDocument()
    expect(onAccepted).not.toHaveBeenCalled()
  })
})
