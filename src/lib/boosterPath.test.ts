import { describe, expect, it } from 'vitest'
import { boosterProfilePath, escapeLikePattern, isBoosterProfileId } from './boosterPath'

describe('boosterProfilePath', () => {
  it('usa o nome de exibicao do booster, codificado', () => {
    expect(boosterProfilePath({ display_name: 'Fulano #1' })).toBe('/boosters/Fulano%20%231')
    expect(boosterProfilePath({ display_name: 'Neo' })).toBe('/boosters/Neo')
  })
})

describe('isBoosterProfileId', () => {
  it('distingue uuid de nome de exibicao', () => {
    expect(isBoosterProfileId('0f8fad5b-d9cb-469f-a165-70867728950e')).toBe(true)
    expect(isBoosterProfileId('Fulano')).toBe(false)
  })
})

describe('escapeLikePattern', () => {
  it('escapa curingas do LIKE para casar o nome literal', () => {
    expect(escapeLikePattern('Neo_100%')).toBe('Neo\\_100\\%')
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b')
    expect(escapeLikePattern('Neo')).toBe('Neo')
  })
})
