// Regressão do bug relatado: reatribuir/dropar falhavam com "sincronize as
// partidas antes" sem explicar que o sync automático (bestEffortSyncBefore
// Action) tinha rodado e falhado silenciosamente -- assertRpcSuccessAfterSync
// é o ponto que decide se o erro do RPC vira uma mensagem genérica ou
// enriquecida com o motivo real da falha de sync.
import { describe, expect, it } from 'vitest'
import { assertRpcSuccessAfterSync } from './mutations'

const MESSAGES = {
  sync_required_before_reassign: 'Sincronize as partidas do pedido antes de reatribuir.',
  order_not_active: 'Este pedido não está mais em um status que aceita esta ação.',
}

describe('assertRpcSuccessAfterSync', () => {
  it('anexa o motivo da falha de sync quando o RPC pede sync_required e o sync automático falhou', () => {
    const syncError = new Error('Falha ao carregar o pedido para sincronizar')

    expect(() =>
      assertRpcSuccessAfterSync({ success: false, error: 'sync_required_before_reassign' }, MESSAGES, syncError),
    ).toThrow(/Falha ao carregar o pedido para sincronizar/)
  })

  it('usa a mensagem genérica quando o sync automático teve sucesso (syncError nulo)', () => {
    expect(() =>
      assertRpcSuccessAfterSync({ success: false, error: 'sync_required_before_reassign' }, MESSAGES, null),
    ).toThrow('Sincronize as partidas do pedido antes de reatribuir.')
  })

  it('não mexe em erros que não são de sync (comportamento normal de assertRpcSuccess)', () => {
    const syncError = new Error('Falha ao carregar o pedido para sincronizar')

    expect(() =>
      assertRpcSuccessAfterSync({ success: false, error: 'order_not_active' }, MESSAGES, syncError),
    ).toThrow('Este pedido não está mais em um status que aceita esta ação.')
  })

  it('retorna o resultado normalmente quando o RPC teve sucesso', () => {
    const result = { success: true }
    expect(assertRpcSuccessAfterSync(result, MESSAGES, null)).toBe(result)
  })
})
