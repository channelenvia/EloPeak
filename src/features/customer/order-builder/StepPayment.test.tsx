// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import { useAuthStore } from '@/stores/authStore'
import { EdgeFunctionError } from '@/lib/invokeEdgeFunction'
import { generatePix, getCustomerOrderState, savePendingOrderFromIntent } from '@/api/orders'
import { StepPayment } from './StepPayment'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/api/core/realtime', () => ({ useRealtimeInvalidate: () => {} }))
vi.mock('@/hooks/useBoostAddons', () => ({ useBoostAddons: () => ({ data: undefined }), EMPTY_ADDONS: [] }))
vi.mock('@/lib/invokeEdgeFunction', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/invokeEdgeFunction')>()),
  invokeEdgeFunction: vi.fn().mockResolvedValue({}),
}))
vi.mock('@/api/orders', () => ({
  getCustomerOrderState: vi.fn(),
  savePendingOrderFromIntent: vi.fn(),
  generatePix: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks()
  useOrderBuilderStore.getState().reset()
  useOrderBuilderStore.setState({ serviceType: 'coaching', gameId: UUID, serviceId: UUID, basePrice: 100, extrasPrice: 0 })
  useAuthStore.setState({ profile: { id: 'user-1' } as never })
  vi.mocked(savePendingOrderFromIntent).mockResolvedValue({ ...PIX } as never)
  vi.mocked(generatePix).mockResolvedValue({ ...PIX } as never)
  vi.mocked(getCustomerOrderState).mockResolvedValue({ payment_confirmed: false, can_pay: true } as never)
})

describe('StepPayment (popup do PIX)', () => {
  it('gera o pedido e o PIX uma única vez ao abrir, mostrando o QR e o código', async () => {
    renderPayment()
    expect(await screen.findByText('PIXCODE123')).toBeInTheDocument()
    expect(screen.getByAltText('QR Code PIX')).toBeInTheDocument()
    expect(savePendingOrderFromIntent).toHaveBeenCalledTimes(1)
    expect(generatePix).toHaveBeenCalledTimes(1)
    expect(generatePix).toHaveBeenCalledWith(ORDER_ID)
  })

  it('envia sempre a mesma idempotency key e nenhum preço do cliente', async () => {
    renderPayment()
    await screen.findByText('PIXCODE123')
    const call = vi.mocked(savePendingOrderFromIntent).mock.calls[0][0]
    expect(call.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(JSON.stringify(call.intent)).not.toMatch(/total_price|base_price/)
  })

  it('se o PIX falhar, "Gerar PIX" tenta de novo no MESMO pedido (sem criar outro)', async () => {
    vi.mocked(generatePix).mockRejectedValueOnce(new EdgeFunctionError({
      status: 502, message: 'Falha ao criar pagamento PIX', body: { error: 'x', order_id: ORDER_ID },
    }))
    renderPayment()
    const retry = await screen.findByRole('button', { name: /gerar pix/i })
    await waitFor(() => expect(retry).toBeEnabled())
    await userEvent.click(retry)
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
    expect(await screen.findByText('Muitas tentativas seguidas. Aguarde 17s e tente novamente.')).toBeInTheDocument()
    expect(screen.queryByText(/Too many requests/)).not.toBeInTheDocument()
  })

  it('erro de servidor não expõe detalhes técnicos', async () => {
    vi.mocked(generatePix).mockRejectedValueOnce(new EdgeFunctionError({
      status: 500, code: 'ORDER_LOAD_FAILED', message: 'Failed to load order', body: null,
    }))
    renderPayment()
    expect(await screen.findByText('Não foi possível gerar o PIX agora. Tente novamente em instantes.')).toBeInTheDocument()
    expect(screen.queryByText(/ORDER_LOAD_FAILED/)).not.toBeInTheDocument()
  })

  it('pago mas ainda em revisão do admin (payment_confirmed false) também leva ao detalhe', async () => {
    vi.mocked(getCustomerOrderState).mockResolvedValue({ payment_confirmed: false, payment_status: 'paid', status: 'pending_review', can_pay: false } as never)
    renderPayment()
    expect(await screen.findByText('detalhe do pedido', {}, { timeout: 4000 })).toBeInTheDocument()
  })

  it('pagamento confirmado leva ao detalhe do pedido', async () => {
    vi.mocked(getCustomerOrderState).mockResolvedValue({ payment_confirmed: true, can_pay: false } as never)
    renderPayment()
    expect(await screen.findByText('detalhe do pedido', {}, { timeout: 4000 })).toBeInTheDocument()
  })
})
