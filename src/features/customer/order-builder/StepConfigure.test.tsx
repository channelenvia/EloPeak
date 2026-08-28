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

  it('com rank atual Grão-Mestre, Duo Boost fica desabilitado e o motivo aparece', () => {
    useOrderBuilderStore.getState().setCurrentRank({ tier: 'grandmaster', division: null })
    renderStepConfigure()

    expect(screen.getByRole('button', { name: /^Duo Boost/ })).toBeDisabled()
    expect(screen.getByText('Indisponível a partir de Mestre — Duo Boost é só até Diamante.')).toBeInTheDocument()
    // setCurrentRank já força solo automaticamente a partir de Mestre (store).
    expect(useOrderBuilderStore.getState().boostMode).toBe('solo')
  })

  it('com rank atual Mestre, Duo Boost também fica desabilitado (Duo Boost é Iron-Diamond only agora)', () => {
    useOrderBuilderStore.getState().setCurrentRank({ tier: 'master', division: null })
    renderStepConfigure()

    expect(screen.getByRole('button', { name: /^Duo Boost/ })).toBeDisabled()
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

  it('antes de verificar o Riot ID, mostra a dica de detecção automática (sem botões clicáveis)', () => {
    renderStepConfigure()
    expect(screen.getByText('Detectamos automaticamente se é Vitórias ou MD5 pelo rank da sua conta, ao verificar o Riot ID abaixo.')).toBeInTheDocument()
    // Não é mais um par de botões -- nunca foi uma escolha manual livre, e o
    // botão "simulando" a escolha virou só uma linha de texto.
    expect(screen.queryByRole('button', { name: /^Vitórias/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^MD5/ })).not.toBeInTheDocument()
    expect(useOrderBuilderStore.getState().isMd5).toBe(false)
  })

  it('depois de verificado com isMd5=true, mostra a mensagem de MD5 ativado automaticamente', () => {
    useOrderBuilderStore.getState().setRiotVerified(true)
    useOrderBuilderStore.getState().setIsMd5(true)
    renderStepConfigure()

    expect(screen.getByText(/garantia de 80%\+ de win rate/)).toBeInTheDocument()
  })

  it('depois de verificado com isMd5=false (conta já rankeada), mostra o modo Vitórias detectado', () => {
    useOrderBuilderStore.getState().setRiotVerified(true)
    useOrderBuilderStore.getState().setIsMd5(false)
    renderStepConfigure()

    expect(screen.getByText(/sua conta já possui rank nesta fila/)).toBeInTheDocument()
  })

  it('Vitórias: Duo bloqueado a partir de Grão-Mestre (regra própria, diferente de Elo Boost que agora é Iron-Diamond only)', () => {
    useOrderBuilderStore.getState().setCurrentRank({ tier: 'grandmaster', division: null })
    renderStepConfigure()

    expect(screen.getByRole('button', { name: /^Duo Vitórias/ })).toBeDisabled()
    expect(screen.getByText('Indisponível a partir de Grão-Mestre.')).toBeInTheDocument()
  })

  it('MD5: Duo nunca é bloqueado por rank, mesmo em Grão-Mestre (rank é da temporada passada)', () => {
    useOrderBuilderStore.getState().setIsMd5(true)
    useOrderBuilderStore.getState().setCurrentRank({ tier: 'grandmaster', division: null })
    renderStepConfigure()

    expect(screen.getByRole('button', { name: /^Duo MD5/ })).not.toBeDisabled()
  })
})
