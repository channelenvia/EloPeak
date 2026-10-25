import { describe, expect, it } from 'vitest'
import { boosterEarningsShare, getOrderStatusGroup, safeOpggUrl, type OrderStatusGroup } from './utils'
import type { OrderStatus } from '@/types'

describe('safeOpggUrl (A14-12)', () => {
  it('so aceita http/https; javascript:/data:/vazio viram undefined', () => {
    expect(safeOpggUrl('javascript:alert(1)')).toBeUndefined()
    expect(safeOpggUrl('data:text/html,<script>alert(1)</script>')).toBeUndefined()
    expect(safeOpggUrl('')).toBeUndefined()
    expect(safeOpggUrl(null)).toBeUndefined()
    expect(safeOpggUrl('nao e url')).toBeUndefined()
  })

  it('devolve a url normalizada para op.gg valido', () => {
    expect(safeOpggUrl('https://www.op.gg/summoners/br/Nome-BR1')).toBe('https://www.op.gg/summoners/br/Nome-BR1')
  })
})

describe('getOrderStatusGroup (A14-12)', () => {
  // Tabela completa: um status novo no enum sem grupo aqui falha o typecheck E este teste.
  const EXPECTED: Record<OrderStatus, OrderStatusGroup> = {
    draft: 'awaiting_payment',
    awaiting_payment: 'awaiting_payment',
    paid: 'awaiting_booster',
    pending_review: 'awaiting_booster',
    awaiting_assignment: 'awaiting_booster',
    assigned: 'in_progress',
    in_progress: 'in_progress',
    paused: 'in_progress',
    drop_requested: 'drop_requested',
    awaiting_customer: 'awaiting_credentials', // sem booster atribuido
    completed: 'completed',
    disputed: 'hidden',
    under_review: 'hidden',
    refunded: 'hidden',
    canceled: 'hidden',
  }

  it.each(Object.entries(EXPECTED) as [OrderStatus, OrderStatusGroup][])('%s -> %s', (status, group) => {
    expect(getOrderStatusGroup({ status, assigned_booster_id: null })).toBe(group)
  })

  it('awaiting_customer com booster atribuido e "em andamento"', () => {
    expect(getOrderStatusGroup({ status: 'awaiting_customer', assigned_booster_id: 'b1' })).toBe('in_progress')
  })
})

describe('boosterEarningsShare (regra do negocio)', () => {
  it('coaching 70%, top 3 60%, demais 55%', () => {
    expect(boosterEarningsShare(false, 'coaching')).toBe(0.7)
    expect(boosterEarningsShare(true, 'elo_boost')).toBe(0.6)
    expect(boosterEarningsShare(false, 'elo_boost')).toBe(0.55)
    expect(boosterEarningsShare(null, undefined)).toBe(0.55)
  })
})
