import { describe, expect, it } from 'vitest'
import { sortOrdersByStatusPriority } from './orderStatusPriority'
import type { OrderStatus } from '@/types'

const o = (status: OrderStatus, created_at: string) => ({ status, created_at })
const list = [o('completed', '2026-01-03'), o('in_progress', '2026-01-01'), o('pending_review', '2026-01-02'), o('in_progress', '2026-01-04')]

describe('sortOrdersByStatusPriority', () => {
  it('admin vê aguardando aprovação primeiro, depois em andamento (mais recente antes)', () => {
    expect(sortOrdersByStatusPriority(list, 'admin').map((x) => x.created_at))
      .toEqual(['2026-01-02', '2026-01-04', '2026-01-01', '2026-01-03'])
  })
  it('cliente e booster começam por em andamento', () => {
    expect(sortOrdersByStatusPriority(list, 'customer').map((x) => x.status))
      .toEqual(['in_progress', 'in_progress', 'pending_review', 'completed'])
  })
})
