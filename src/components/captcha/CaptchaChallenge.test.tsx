// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CaptchaChallenge } from './CaptchaChallenge'

// Catálogo com um único campeão (com apóstrofo, o caso mais sensível pra
// validação exata) -- deixa o sorteio determinístico sem precisar mockar
// pickRandomChampion, exercitando a integração real com ddragon.ts.
const FAKE_VERSION = '16.1.1'
const FAKE_CATALOG = { data: { Kaisa: { id: 'Kaisa', name: "Kai'Sa" } } }

function mockDdragonFetch() {
  global.fetch = vi.fn((url: string | URL | Request) => {
    const href = String(url)
    if (href.includes('versions.json')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([FAKE_VERSION]) } as Response)
    }
    if (href.includes('champion.json')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(FAKE_CATALOG) } as Response)
    }
    return Promise.reject(new Error(`unexpected fetch: ${href}`))
  }) as unknown as typeof fetch
}

function renderCaptcha(onSuccess = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <CaptchaChallenge open onOpenChange={() => {}} onSuccess={onSuccess} />
    </QueryClientProvider>,
  )
  return { ...utils, onSuccess }
}

describe('CaptchaChallenge — desafio de campeão hachurado', () => {
  beforeEach(() => {
    mockDdragonFetch()
  })

  it('carrega o ícone do campeão sorteado do Data Dragon', async () => {
    renderCaptcha()

    // Modal renderiza via portal (fora do `container` do render()) -- busca
    // no document inteiro, igual screen.find* já faz pros outros testes.
    await waitFor(() => {
      const img = document.querySelector('img')
      expect(img?.getAttribute('src')).toBe(
        `https://ddragon.leagueoflegends.com/cdn/${FAKE_VERSION}/img/champion/Kaisa.png`,
      )
    })
  })

  it('rejeita o nome sem a grafia exata (minúsculo, sem apóstrofo) e não chama onSuccess', async () => {
    const user = userEvent.setup()
    const { onSuccess } = renderCaptcha()

    const input = await screen.findByPlaceholderText('Nome do campeão')
    await user.type(input, 'kaisa')
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByText('Nome incorreto, tente novamente com outro campeão.')).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('aceita o nome exatamente como o catálogo retorna (maiúsculas e apóstrofo corretos)', async () => {
    const user = userEvent.setup()
    const { onSuccess } = renderCaptcha()

    const input = await screen.findByPlaceholderText('Nome do campeão')
    await user.type(input, "Kai'Sa")
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
  })

  it('aceita o nome com qualquer capitalização, desde que o apóstrofo esteja certo (case-insensitive)', async () => {
    const user = userEvent.setup()
    const { onSuccess } = renderCaptcha()

    const input = await screen.findByPlaceholderText('Nome do campeão')
    await user.type(input, "KAI'SA")
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
  })
})
