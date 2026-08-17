// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useOrderBuilderStore } from '@/stores/orderBuilderStore'
import { StepConfigure } from './StepConfigure'

// StepConfigure importa @/lib/supabase (createClient real, lança se faltar
// env var) e @/lib/invokeEdgeFunction (chamada de rede real) -- nenhum dos
// dois deve rodar de verdade num teste de componente. Mock mínimo, só o
// suficiente pra sustentar as duas queries que o componente dispara
// (master-plus-price, riot-league-cutoffs), nenhuma delas relevante pros
// dois seletores testados aqui (Modalidade Solo/Duo, Vitórias/MD5). O
// vi.mock() é hoisted pro topo do arquivo pelo Vitest, então funciona mesmo
// vindo depois do import acima.
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              lte: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: () => Promise.resolve({ data: null, error: null }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  },
}))

vi.mock('@/lib/invokeEdgeFunction', () => ({
  invokeEdgeFunction: vi.fn().mockResolvedValue({ grandmaster_cutoff: null, challenger_cutoff: null }),
}))

function renderStepConfigure() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <StepConfigure />
    </QueryClientProvider>,
  )
}

describe('StepConfigure — Modalidade (Solo/Duo Boost)', () => {
  beforeEach(() => {
    useOrderBuilderStore.getState().reset()
    useOrderBuilderStore.getState().setService('elo_boost', 'elo_boost')
  })

  it('mostra Solo Boost e Duo Boost, Solo selecionado por padrão', () => {
    renderStepConfigure()
    expect(screen.getByRole('button', { name: /^Solo Boost/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Duo Boost/ })).toBeInTheDocument()
    expect(useOrderBuilderStore.getState().boostMode).toBe('solo')
  })

  it('clicar em Duo Boost seta boostMode para duo', async () => {
    const user = userEvent.setup()
    renderStepConfigure()

    await user.click(screen.getByRole('button', { name: /Duo Boost/ }))
    expect(useOrderBuilderStore.getState().boostMode).toBe('duo')
  })

  it('com rank atual Mestre+, Duo Boost fica desabilitado e o motivo aparece', () => {
    useOrderBuilderStore.getState().setCurrentRank({ tier: 'grandmaster', division: null })
    renderStepConfigure()

    expect(screen.getByRole('button', { name: /^Duo Boost/ })).toBeDisabled()
    expect(screen.getByText('Indisponível para Mestre ou superior.')).toBeInTheDocument()
    // setCurrentRank já força solo automaticamente pra Mestre+ (store).
    expect(useOrderBuilderStore.getState().boostMode).toBe('solo')
  })

  it('não renderiza pra outros tipos de serviço (ex.: coaching)', () => {
    useOrderBuilderStore.getState().setService('coaching', 'coaching')
    renderStepConfigure()
    expect(screen.queryByRole('button', { name: 'Solo Boost' })).not.toBeInTheDocument()
  })
})

describe('StepConfigure — Vitórias ou MD5 (nunca escolha livre, só o Riot ID decide)', () => {
  beforeEach(() => {
    useOrderBuilderStore.getState().reset()
    useOrderBuilderStore.getState().setService('win_boost', 'win_boost')
  })

  it('antes de verificar o Riot ID, mostra Vitórias como padrão e a dica de detecção automática', () => {
    renderStepConfigure()
    expect(screen.getByText('Ativa se sua conta já tiver rank nesta fila.')).toBeInTheDocument()
    expect(useOrderBuilderStore.getState().isMd5).toBe(false)
  })

  it('os dois botões são sempre não-clicáveis -- nunca uma escolha manual livre', async () => {
    const user = userEvent.setup()
    renderStepConfigure()

    // Nome parcial (regex ancorada no início) -- "Solo Vitórias"/"Duo
    // Vitórias" do seletor de Modalidade (StepConfigure.tsx) também contêm
    // a substring "Vitórias" e quebrariam um match solto.
    const vitoriasBtn = screen.getByRole('button', { name: /^Vitórias/ })
    const md5Btn = screen.getByRole('button', { name: /^MD5/ })
    expect(vitoriasBtn).toBeDisabled()
    expect(md5Btn).toBeDisabled()

    await user.click(md5Btn)
    expect(useOrderBuilderStore.getState().isMd5).toBe(false) // clique num botão disabled não faz nada
  })

  it('depois de verificado com isMd5=true, mostra a mensagem de MD5 ativado automaticamente', () => {
    useOrderBuilderStore.getState().setRiotVerified(true)
    useOrderBuilderStore.getState().setIsMd5(true)
    renderStepConfigure()

    expect(screen.getByText(/garantia de 80%\+ de win rate/)).toBeInTheDocument()
  })

  it('depois de verificado com isMd5=false (conta já rankeada), mostra a mensagem de MD5 indisponível', () => {
    useOrderBuilderStore.getState().setRiotVerified(true)
    useOrderBuilderStore.getState().setIsMd5(false)
    renderStepConfigure()

    expect(screen.getByText('Indisponível — conta já possui rank nesta fila.')).toBeInTheDocument()
  })
})
