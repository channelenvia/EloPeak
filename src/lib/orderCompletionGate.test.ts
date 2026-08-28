import { describe, it, expect } from 'vitest'
import { canMarkOrderComplete, type CompletionGateOrder } from './orderCompletionGate'

function order(overrides: Partial<CompletionGateOrder>): CompletionGateOrder {
  return {
    service_type: 'elo_boost',
    wins_played: 0,
    losses_played: 0,
    wins_purchased: null,
    match_sync_started_at: '2026-08-01T12:00:00.000Z',
    target_rank: null,
    ...overrides,
  }
}

describe('canMarkOrderComplete', () => {
  it('coaching is always allowed regardless of matches', () => {
    const result = canMarkOrderComplete(order({ service_type: 'coaching' }), new Date('2026-08-01T13:00:00.000Z'))
    expect(result).toEqual({ allowed: true })
  })

  it('elo_boost with zero matches played is blocked', () => {
    const result = canMarkOrderComplete(order({ service_type: 'elo_boost', wins_played: 0, losses_played: 0 }), new Date())
    expect(result).toEqual({ allowed: false, reason: 'no_matches_played' })
  })

  it('elo_boost with at least one synced match is allowed', () => {
    const result = canMarkOrderComplete(order({ service_type: 'elo_boost', wins_played: 0, losses_played: 1 }), new Date())
    expect(result).toEqual({ allowed: true })
  })

  it('elo_boost with a target_rank set requires Riot rank verification instead of match evidence alone', () => {
    const result = canMarkOrderComplete(
      order({ service_type: 'elo_boost', wins_played: 5, losses_played: 1, target_rank: { tier: 'gold', division: 'II' } }),
      new Date(),
    )
    expect(result).toEqual({ allowed: false, reason: 'requires_rank_verification' })
  })

  it('placement_matches follows the same match-evidence rule as elo_boost', () => {
    const result = canMarkOrderComplete(order({ service_type: 'placement_matches', wins_played: 1, losses_played: 0 }), new Date())
    expect(result).toEqual({ allowed: true })
  })

  it('win_boost blocks when wins_played is below wins_purchased, even with match evidence', () => {
    const result = canMarkOrderComplete(
      order({ service_type: 'win_boost', wins_purchased: 3, wins_played: 1, losses_played: 2 }),
      new Date(),
    )
    expect(result).toEqual({ allowed: false, reason: 'objective_not_reached' })
  })

  it('win_boost blocks on no match evidence even if wins_purchased is already met (defense in depth)', () => {
    const result = canMarkOrderComplete(
      order({ service_type: 'win_boost', wins_purchased: 0 as unknown as number, wins_played: 0, losses_played: 0 }),
      new Date(),
    )
    expect(result).toEqual({ allowed: false, reason: 'no_matches_played' })
  })

  it('win_boost allows once wins_played meets wins_purchased with no losses', () => {
    const result = canMarkOrderComplete(
      order({ service_type: 'win_boost', wins_purchased: 3, wins_played: 3, losses_played: 0 }),
      new Date(),
    )
    expect(result).toEqual({ allowed: true })
  })

  // Garantia de saldo líquido do win_boost (StepReview.tsx explica isso ao
  // cliente): toda derrota precisa ser compensada com uma vitória extra --
  // raw wins_played atingir wins_purchased NÃO basta se houve derrota no
  // meio do caminho.
  it('win_boost blocks when raw wins_played meets wins_purchased but a loss still leaves the net balance short', () => {
    const result = canMarkOrderComplete(
      order({ service_type: 'win_boost', wins_purchased: 3, wins_played: 3, losses_played: 1 }),
      new Date(),
    )
    expect(result).toEqual({ allowed: false, reason: 'objective_not_reached' })
  })

  it('win_boost allows once the loss has been compensated by an extra win (net balance meets wins_purchased)', () => {
    const result = canMarkOrderComplete(
      order({ service_type: 'win_boost', wins_purchased: 3, wins_played: 4, losses_played: 1 }),
      new Date(),
    )
    expect(result).toEqual({ allowed: true })
  })

  it('win_boost with 2 losses needs 2 extra wins to compensate before it unblocks', () => {
    const blocked = canMarkOrderComplete(
      order({ service_type: 'win_boost', wins_purchased: 5, wins_played: 6, losses_played: 2 }),
      new Date(),
    )
    expect(blocked).toEqual({ allowed: false, reason: 'objective_not_reached' })

    const allowed = canMarkOrderComplete(
      order({ service_type: 'win_boost', wins_purchased: 5, wins_played: 7, losses_played: 2 }),
      new Date(),
    )
    expect(allowed).toEqual({ allowed: true })
  })

  // md5 é garantia de win RATE (80%+), não de saldo líquido 1:1 -- continua
  // olhando só vitórias cruas, sem compensação de derrota igual ao win_boost.
  it('md5 is unaffected by losses -- raw wins_played meeting wins_purchased is enough', () => {
    const result = canMarkOrderComplete(
      order({ service_type: 'md5', wins_purchased: 3, wins_played: 3, losses_played: 1 }),
      new Date(),
    )
    expect(result).toEqual({ allowed: true })
  })

  it('clash is blocked before 23:00 America/Sao_Paulo on the start day', () => {
    // 2026-08-01 is a Saturday; match_sync_started_at at 20:00 BRT (23:00 UTC)
    const result = canMarkOrderComplete(
      order({ service_type: 'clash', match_sync_started_at: '2026-08-01T23:00:00.000Z' }),
      new Date('2026-08-02T00:00:00.000Z'), // 21:00 BRT same evening -- still before 23:00 local
    )
    expect(result).toEqual({ allowed: false, reason: 'clash_completion_window_closed' })
  })

  it('clash is allowed once local time passes 23:00 on the start day', () => {
    const result = canMarkOrderComplete(
      order({ service_type: 'clash', match_sync_started_at: '2026-08-01T23:00:00.000Z' }), // 20:00 BRT
      new Date('2026-08-02T02:30:00.000Z'), // 23:30 BRT same evening
    )
    expect(result).toEqual({ allowed: true })
  })

  it('clash stays allowed the next calendar day (no re-lock after unlock)', () => {
    const result = canMarkOrderComplete(
      order({ service_type: 'clash', match_sync_started_at: '2026-08-01T23:00:00.000Z' }), // 20:00 BRT sat
      new Date('2026-08-02T13:00:00.000Z'), // 10:00 BRT sunday -- well past unlock, hour < 23
    )
    expect(result).toEqual({ allowed: true })
  })

  it('clash with match_sync_started_at already after 23:00 local unlocks the next day', () => {
    const result = canMarkOrderComplete(
      order({ service_type: 'clash', match_sync_started_at: '2026-08-02T02:30:00.000Z' }), // 23:30 BRT sat (already past 23h)
      new Date('2026-08-03T02:00:00.000Z'), // 23:00 BRT sun -- next day's unlock instant
    )
    expect(result).toEqual({ allowed: true })
  })
})
