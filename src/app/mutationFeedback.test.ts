import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleMutationError, handleMutationSuccess } from './mutationFeedback'
import { notifyError, notifySuccess } from '@/lib/notify'

vi.mock('@/lib/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }))

describe('mutationFeedback', () => {
  beforeEach(() => {
    vi.mocked(notifyError).mockClear()
    vi.mocked(notifySuccess).mockClear()
  })

  it('mostra a mensagem normalizada do erro como toast', () => {
    handleMutationError(new Error('boom'), undefined)
    expect(notifyError).toHaveBeenCalledTimes(1)
    expect(typeof vi.mocked(notifyError).mock.calls[0][0]).toBe('string')
  })

  it('não mostra toast quando a tela já exibe o erro (silentError)', () => {
    handleMutationError(new Error('boom'), { silentError: true })
    expect(notifyError).not.toHaveBeenCalled()
  })

  it('mostra toast de sucesso só quando há successMessage', () => {
    handleMutationSuccess({ successMessage: 'Salvo' })
    handleMutationSuccess({})
    handleMutationSuccess(undefined)
    expect(notifySuccess).toHaveBeenCalledTimes(1)
    expect(notifySuccess).toHaveBeenCalledWith('Salvo')
  })
})
