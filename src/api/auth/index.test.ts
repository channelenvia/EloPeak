import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }))

import { updateBoosterCpf } from './index'

describe('updateBoosterCpf (M-27)', () => {
  beforeEach(() => rpc.mockReset())

  it('CPF duplicado (23505) vira mensagem clara com code cpf_taken', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } })
    await expect(updateBoosterCpf({ cpf: '52998224725' })).rejects.toMatchObject({
      code: 'cpf_taken', message: 'Este CPF já está cadastrado em outra conta.',
    })
  })

  it('sucesso nao lanca', async () => {
    rpc.mockResolvedValue({ data: { success: true }, error: null })
    await expect(updateBoosterCpf({ cpf: '52998224725' })).resolves.toBeUndefined()
  })
})
