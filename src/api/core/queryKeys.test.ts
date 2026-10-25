import { describe, expect, it } from 'vitest'
import { queryKeys } from './queryKeys'

const startsWith = (key: readonly unknown[], prefix: readonly unknown[]) =>
  prefix.every((part, i) => key[i] === part)

describe('queryKeys: escopos são prefixo das chaves detalhadas', () => {
  it('orders.customerScope cobre a lista e as abas do cliente', () => {
    expect(startsWith(queryKeys.orders.customerList('c1'), queryKeys.orders.customerScope)).toBe(true)
  })
  it('orders.adminScope cobre a lista do admin', () => {
    expect(startsWith(queryKeys.orders.adminList({ status: 'paid' }), queryKeys.orders.adminScope)).toBe(true)
  })
  it('orders.duoAccountHistoryScope cobre o histórico por pedido', () => {
    expect(startsWith(queryKeys.orders.duoAccountHistory('o1'), queryKeys.orders.duoAccountHistoryScope)).toBe(true)
  })
  it('boosters.publicProfileScope cobre o perfil público', () => {
    expect(startsWith(queryKeys.boosters.publicProfile('b1'), queryKeys.boosters.publicProfileScope)).toBe(true)
  })
  it('resumableOrder.all cobre a chave por perfil', () => {
    expect(startsWith(queryKeys.resumableOrder.forProfile('p1'), queryKeys.resumableOrder.all)).toBe(true)
  })
  it('payouts.all cobre totais e CPF do admin', () => {
    expect(startsWith(queryKeys.payouts.adminCpf('r1'), queryKeys.payouts.all)).toBe(true)
    expect(startsWith(queryKeys.payouts.totals('b1'), queryKeys.payouts.all)).toBe(true)
  })
})
