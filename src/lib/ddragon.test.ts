import { describe, expect, it } from 'vitest'
import { championIconUrl, normalizeChampionName, resolveChampionName } from './ddragon'

describe('Data Dragon champion icons', () => {
  it.each([
    ['leesin', 'leesin'],
    ['Lee Sin', 'leesin'],
    ['Lee sin', 'leesin'],
    ["Cho'Gath", 'chogath'],
    ['Kai’Sa', 'kaisa'],
    ['Nunu & Willump', 'nunuwillump'],
  ])('normaliza %s para %s', (input, expected) => {
    expect(normalizeChampionName(input)).toBe(expected)
  })

  it('usa o id canônico retornado pelo catálogo', () => {
    const catalog = {
      leesin: { id: 'LeeSin', name: 'Lee Sin' },
      wukong: { id: 'MonkeyKing', name: 'Wukong' },
    }

    expect(championIconUrl('Lee sin', '16.1.1', catalog)).toBe(
      'https://ddragon.leagueoflegends.com/cdn/16.1.1/img/champion/LeeSin.png',
    )
    expect(championIconUrl('WUKONG', '16.1.1', catalog)).toBe(
      'https://ddragon.leagueoflegends.com/cdn/16.1.1/img/champion/MonkeyKing.png',
    )
  })

  it('corrige o texto digitado para o nome oficial de exibição', () => {
    const leeSin = { id: 'LeeSin', name: 'Lee Sin' }
    const mordekaiser = { id: 'Mordekaiser', name: 'Mordekaiser' }
    const catalog = { leesin: leeSin, mordekaiser }

    expect(resolveChampionName('lee sin', catalog)).toBe('Lee Sin')
    expect(resolveChampionName('LEESIN', catalog)).toBe('Lee Sin')
    expect(resolveChampionName('lee simn', catalog)).toBe('Lee Sin')
    expect(resolveChampionName('morde kahser', catalog)).toBe('Mordekaiser')
    expect(resolveChampionName('nome desconhecido', catalog)).toBe('nome desconhecido')
  })
})
