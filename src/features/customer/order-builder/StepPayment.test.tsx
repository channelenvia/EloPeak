// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import { useAuthStore } from '@/stores/authStore'
import { EdgeFunctionError } from '@/lib/invokeEdgeFunction'
import { generatePix, getCustomerOrderState, savePendingOrderFromIntent, useOrderPaymentInfo } from '@/api/orders'
import { StepPayment } from './StepPayment'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/api/core/realtime', () => ({ useRealtimeInvalidate: () => {} }))
vi.mock('@/hooks/useBoostAddons', () => ({ useBoostAddons: () => ({ data: undefined }), EMPTY_ADDONS: [] }))
vi.mock('@/lib/invokeEdgeFunction', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/invokeEdgeFunction')>()),
  invokeEdgeFunction: vi.fn().mockResolvedValue({}),
}))
vi.mock('@/components/order/CardPaymentPanel', () => ({
  CardPaymentPanel: ({ orderId, onAccepted }: { orderId: string; onAccepted: (a: 'approved' | 'pending') => void }) => (
    <div>
      formulário do cartão {orderId}
      <button onClick={() => onAccepted('approved')}>simular aprovado</button>
      <button onClick={() => onAccepted('pending')}>simular em análise</button>
    </div>
  ),
}))
vi.mock('@/api/orders', () => ({
  getCustomerOrderState: vi.fn(),
  savePendingOrderFromIntent: vi.fn(),
  generatePix: vi.fn(),
  useOrderPaymentInfo: vi.fn(() => ({ data: null })),
}))

const UUID = '11111111-1111-4111-8111-111111111111'
const ORDER_ID = '22222222-2222-4222-8222-222222222222'
const PIX = {
  order_id: ORDER_ID, total_price: 100, payment_id: 'p1', qr_code: 'PIXCODE123', qr_code_base64: 'IMG',
  expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
}

function renderPayment() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/orders/new']}>
        <Routes>
          <Route path="/orders/new" element={<StepPayment insideModal />} />
          <Route path="/orders/:id" element={<div>detalhe do pedido</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function choose(name: RegExp) {
  await userEvent.click(await screen.findByRole('button', { name }))
}

beforeEach(() => {
  vi.clearAllMocks()
  useOrderBuilderStore.getState().reset()
  useOrderBuilderStore.setState({ serviceType: 'coaching', gameId: UUID, serviceId: UUID, basePrice: 100, extrasPrice: 0 })
  useAuthStore.setState({ profile: { id: 'user-1' } as never })
  vi.mocked(savePendingOrderFromIntent).mockResolvedValue({ ...PIX } as never)
  vi.mocked(generatePix).mockResolvedValue({ ...PIX } as never)
  vi.mocked(getCustomerOrderState).mockResolvedValue({ payment_confirmed: false, can_pay: true } as never)
  vi.mocked(useOrderPaymentInfo).mockReturnValue({ data: null } as never)
})

describe('StepPayment (popup de pagamento)', () => {
  it('oferece cartão e PIX sem criar pedido até o cliente escolher', async () => {
    renderPayment()
    expect(await screen.findByRole('button', { name: /cartão/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /pix/i })).toBeInTheDocument()
    expect(savePendingOrderFromIntent).not.toHaveBeenCalled()
  })

  it('gera o pedido e o PIX uma única vez ao escolher PIX, mostrando o QR e o código', async () => {
    renderPayment()
    await choose(/pix/i)
    expect(await screen.findByText('PIXCODE123')).toBeInTheDocument()
    expect(screen.getByAltText('QR Code PIX')).toBeInTheDocument()
    expect(savePendingOrderFromIntent).toHaveBeenCalledTimes(1)
    expect(generatePix).toHaveBeenCalledTimes(1)
    expect(generatePix).toHaveBeenCalledWith(ORDER_ID)
  })

  it('envia sempre a mesma idempotency key e nenhum preço do cliente', async () => {
    renderPayment()
    await choose(/pix/i)
    await screen.findByText('PIXCODE123')
    const call = vi.mocked(savePendingOrderFromIntent).mock.calls[0][0]
    expect(call.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(JSON.stringify(call.intent)).not.toMatch(/total_price|base_price/)
  })

  it('se o PIX falhar, escolher PIX de novo tenta no MESMO pedido (sem criar outro)', async () => {
    vi.mocked(generatePix).mockRejectedValueOnce(new EdgeFunctionError({
      status: 502, message: 'Falha ao criar pagamento PIX', body: { error: 'x', order_id: ORDER_ID },
    }))
    renderPayment()
    await choose(/pix/i)
    await screen.findByText(/Não foi possível gerar o PIX agora/)
    await choose(/pix/i)
    expect(await screen.findByText('PIXCODE123')).toBeInTheDocument()
    expect(savePendingOrderFromIntent).toHaveBeenCalledTimes(1)
    expect(generatePix).toHaveBeenCalledTimes(2)
    expect(vi.mocked(generatePix).mock.calls.every(([id]) => id === ORDER_ID)).toBe(true)
  })

  it('limite de requisições (429) mostra mensagem amigável com o tempo de espera', async () => {
    vi.mocked(generatePix).mockRejectedValueOnce(new EdgeFunctionError({
      status: 429, message: 'Too many requests', retryAfter: 17, body: { error: 'Too many requests' },
    }))
    renderPayment()
    await choose(/pix/i)
    expect(await screen.findByText('Muitas tentativas seguidas. Aguarde 17s e tente novamente.')).toBeInTheDocument()
    expect(screen.queryByText(/Too many requests/)).not.toBeInTheDocument()
  })

  it('erro de servidor não expõe detalhes técnicos', async () => {
    vi.mocked(generatePix).mockRejectedValueOnce(new EdgeFunctionError({
      status: 500, code: 'ORDER_LOAD_FAILED', message: 'Failed to load order', body: null,
    }))
    renderPayment()
    await choose(/pix/i)
    expect(await screen.findByText('Não foi possível gerar o PIX agora. Tente novamente em instantes.')).toBeInTheDocument()
    expect(screen.queryByText(/ORDER_LOAD_FAILED/)).not.toBeInTheDocument()
  })

  it('mostra "Salvando…" centralizado enquanto salva e só então libera o PIX', async () => {
    let finishSave!: (value: unknown) => void
    vi.mocked(savePendingOrderFromIntent).mockReturnValueOnce(new Promise((resolve) => { finishSave = resolve }) as never)
    renderPayment()
    await choose(/pix/i)
    expect(await screen.findByRole('status')).toHaveTextContent('Salvando…')
    expect(screen.queryByRole('button', { name: /pix/i })).not.toBeInTheDocument()
    finishSave({ ...PIX })
    expect(await screen.findByText('PIXCODE123')).toBeInTheDocument()
  })

  it('cartão: salva o pedido e só então libera o formulário (sem gerar PIX)', async () => {
    renderPayment()
    await choose(/cartão/i)
    expect(await screen.findByText(`formulário do cartão ${ORDER_ID}`)).toBeInTheDocument()
    expect(savePendingOrderFromIntent).toHaveBeenCalledTimes(1)
    expect(generatePix).not.toHaveBeenCalled()
  })

  it('cartão: se salvar falhar, volta à escolha com o erro e sem formulário', async () => {
    vi.mocked(savePendingOrderFromIntent).mockRejectedValueOnce(new EdgeFunctionError({
      status: 500, message: 'x', body: null,
    }))
    renderPayment()
    await choose(/cartão/i)
    expect(await screen.findByText(/Não foi possível gerar o PIX agora/)).toBeInTheDocument()
    expect(screen.queryByText(/formulário do cartão/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cartão/i })).toBeInTheDocument()
  })

  it('cartão em análise avisa que o pedido está salvo em Meus Pedidos', async () => {
    renderPayment()
    await choose(/cartão/i)
    await userEvent.click(await screen.findByRole('button', { name: 'simular em análise' }))
    expect(await screen.findByText('Pagamento em análise')).toBeInTheDocument()
  })

  it('pedido com cartão já em análise mostra o aviso em vez de oferecer pagar de novo', async () => {
    vi.mocked(useOrderPaymentInfo).mockReturnValue({ data: { method: 'credit_card', status: 'pending' } } as never)
    renderPayment()
    expect(await screen.findByText('Pagamento em análise')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pix/i })).not.toBeInTheDocument()
  })

  it('cartão aprovado leva ao detalhe do pedido quando a confirmação chega', async () => {
    renderPayment()
    await choose(/cartão/i)
    vi.mocked(getCustomerOrderState).mockResolvedValue({ payment_confirmed: true, can_pay: false } as never)
    await userEvent.click(await screen.findByRole('button', { name: 'simular aprovado' }))
    expect(await screen.findByText('detalhe do pedido', {}, { timeout: 9000 })).toBeInTheDocument()
  }, 15_000)

  it('pago mas ainda em revisão do admin (payment_confirmed false) também leva ao detalhe', async () => {
    vi.mocked(getCustomerOrderState).mockResolvedValue({ payment_confirmed: false, payment_status: 'paid', status: 'pending_review', can_pay: false } as never)
    renderPayment()
    await choose(/pix/i)
    expect(await screen.findByText('detalhe do pedido', {}, { timeout: 4000 })).toBeInTheDocument()
  })

  it('pagamento confirmado leva ao detalhe do pedido', async () => {
    vi.mocked(getCustomerOrderState).mockResolvedValue({ payment_confirmed: true, can_pay: false } as never)
    renderPayment()
    await choose(/pix/i)
    expect(await screen.findByText('detalhe do pedido', {}, { timeout: 4000 })).toBeInTheDocument()
  })
})
