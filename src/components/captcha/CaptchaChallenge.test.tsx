// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CaptchaChallenge } from './CaptchaChallenge'

const issueAcceptChallenge = vi.fn()
const verifyAcceptChallenge = vi.fn()
vi.mock('@/api/orders', () => ({
  issueAcceptChallenge: (...args: unknown[]) => issueAcceptChallenge(...args),
  verifyAcceptChallenge: (...args: unknown[]) => verifyAcceptChallenge(...args),
}))

const CHALLENGE = { challenge_id: 'c-1', image_url: 'https://x.supabase.co/functions/v1/accept-challenge-image?id=c-1', expires_in: 180 }

function renderCaptcha(onSuccess = vi.fn()) {
  render(<CaptchaChallenge open orderId="order-1" onOpenChange={() => {}} onSuccess={onSuccess} />)
  return { onSuccess }
}

describe('CaptchaChallenge — desafio validado no servidor', () => {
  beforeEach(() => {
    issueAcceptChallenge.mockReset().mockResolvedValue(CHALLENGE)
    verifyAcceptChallenge.mockReset()
  })

  it('pede o desafio do pedido ao servidor e mostra a imagem mascarada (sem nome de campeão na URL)', async () => {
    renderCaptcha()
    await waitFor(() => expect(document.querySelector('img')?.getAttribute('src')).toBe(CHALLENGE.image_url))
    expect(issueAcceptChallenge).toHaveBeenCalledWith('order-1')
    expect(CHALLENGE.image_url).not.toMatch(/kaisa|champion\/[A-Za-z]+\.png/i)
  })

  it('resposta certa (decidida pelo servidor) chama onSuccess com o id do desafio', async () => {
    verifyAcceptChallenge.mockResolvedValue({ success: true })
    const user = userEvent.setup()
    const { onSuccess } = renderCaptcha()
    await user.type(await screen.findByPlaceholderText('Nome do campeão'), "Kai'Sa")
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('c-1'))
    expect(verifyAcceptChallenge).toHaveBeenCalledWith('c-1', "Kai'Sa")
  })

  it('resposta errada mostra as tentativas restantes e não chama onSuccess', async () => {
    verifyAcceptChallenge.mockResolvedValue({ success: false, error: 'wrong_answer', attempts_left: 2 })
    const user = userEvent.setup()
    const { onSuccess } = renderCaptcha()
    await user.type(await screen.findByPlaceholderText('Nome do campeão'), 'ahri')
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByText(/ainda tem 2 tentativa/)).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('sem tentativas restantes pede uma imagem nova', async () => {
    verifyAcceptChallenge.mockResolvedValue({ success: false, error: 'wrong_answer', attempts_left: 0 })
    const user = userEvent.setup()
    renderCaptcha()
    await user.type(await screen.findByPlaceholderText('Nome do campeão'), 'ahri')
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(issueAcceptChallenge).toHaveBeenCalledTimes(2))
  })

  it('falha ao carregar o desafio mostra erro e permite tentar de novo', async () => {
    issueAcceptChallenge.mockRejectedValueOnce(new Error('order_unavailable'))
    renderCaptcha()
    expect(await screen.findByText('order_unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
  })
})
