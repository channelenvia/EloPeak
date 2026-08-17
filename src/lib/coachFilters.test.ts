import { describe, it, expect } from 'vitest'
import { matchesCoachPackageFilters, activeFilterCount, type CoachPackageLike } from './coachFilters'

const midMacro: CoachPackageLike = { title: 'Coaching de Meio', description: 'foco em macro', lanes: ['mid'], specialties: ['macro'], champions: ['Ahri'], tempo: '1 hora', price: 100 }
const topTrades: CoachPackageLike = { title: 'Topo agressivo', description: null, lanes: ['top'], specialties: ['trades'], champions: ['Darius', 'Garen'], tempo: '2 horas', price: 200 }
const jungleVision: CoachPackageLike = { title: 'Selva', description: 'controle de objetivos', lanes: ['jungle'], specialties: ['vision', 'objectives'], champions: null, tempo: null, price: 50 }

const NONE = { search: '', lanes: new Set<string>(), specialties: new Set<string>(), tempo: new Set<string>(), priceMin: null, priceMax: null }

describe('matchesCoachPackageFilters', () => {
  it('sem nenhum filtro, todo pacote passa', () => {
    for (const p of [midMacro, topTrades, jungleVision]) {
      expect(matchesCoachPackageFilters(p, 'Fulano', NONE)).toBe(true)
    }
  })

  it('OU dentro do grupo de rotas: marcar mid+top mostra pacotes de qualquer uma', () => {
    const filters = { ...NONE, lanes: new Set(['mid', 'top']) }
    expect(matchesCoachPackageFilters(midMacro, 'x', filters)).toBe(true)
    expect(matchesCoachPackageFilters(topTrades, 'x', filters)).toBe(true)
    expect(matchesCoachPackageFilters(jungleVision, 'x', filters)).toBe(false) // selva não está marcada
  })

  it('E entre grupos: precisa bater rota E especialidade', () => {
    const filters = { ...NONE, lanes: new Set(['mid']), specialties: new Set(['macro']) }
    expect(matchesCoachPackageFilters(midMacro, 'x', filters)).toBe(true)
    // rota bate (mid) mas especialidade não (top é 'trades', não 'macro')
    expect(matchesCoachPackageFilters({ ...midMacro, specialties: ['trades'] }, 'x', filters)).toBe(false)
  })

  it('busca casa título, descrição, nome do coach ou champion, sem diferenciar maiúsculas/espaços', () => {
    expect(matchesCoachPackageFilters(midMacro, 'Fulano', { ...NONE, search: '  MACRO ' })).toBe(true) // descrição
    expect(matchesCoachPackageFilters(topTrades, 'Beltrano', { ...NONE, search: 'beltrano' })).toBe(true) // nome do coach
    expect(matchesCoachPackageFilters(topTrades, 'Fulano', { ...NONE, search: 'darius' })).toBe(true) // champion
    expect(matchesCoachPackageFilters(topTrades, 'Fulano', { ...NONE, search: 'inexistente' })).toBe(false)
  })

  it('pacote sem lanes/specialties é excluído quando há filtro daquele grupo', () => {
    const semTags: CoachPackageLike = { title: 'Genérico', description: null, lanes: null, specialties: null, champions: null, tempo: null, price: 0 }
    expect(matchesCoachPackageFilters(semTags, 'x', { ...NONE, lanes: new Set(['mid']) })).toBe(false)
    expect(matchesCoachPackageFilters(semTags, 'x', NONE)).toBe(true) // sem filtro, passa
  })

  it('duração: OU dentro do grupo, pacote sem tempo é excluído quando há filtro', () => {
    const filters = { ...NONE, tempo: new Set(['1 hora', '2 horas']) }
    expect(matchesCoachPackageFilters(midMacro, 'x', filters)).toBe(true) // 1 hora
    expect(matchesCoachPackageFilters(topTrades, 'x', filters)).toBe(true) // 2 horas
    expect(matchesCoachPackageFilters(jungleVision, 'x', filters)).toBe(false) // sem tempo
  })

  it('faixa de preço: min e max são inclusivos', () => {
    expect(matchesCoachPackageFilters(midMacro, 'x', { ...NONE, priceMin: 100, priceMax: 100 })).toBe(true)
    expect(matchesCoachPackageFilters(midMacro, 'x', { ...NONE, priceMin: 101 })).toBe(false)
    expect(matchesCoachPackageFilters(midMacro, 'x', { ...NONE, priceMax: 99 })).toBe(false)
  })
})

describe('activeFilterCount', () => {
  it('conta rotas + especialidades + duração + faixa de preço, ignora a busca', () => {
    expect(activeFilterCount({ lanes: new Set(['mid', 'top']), specialties: new Set(['macro']), tempo: new Set(), priceMin: null, priceMax: null })).toBe(3)
    expect(activeFilterCount({ lanes: new Set(), specialties: new Set(), tempo: new Set(['1 hora']), priceMin: null, priceMax: null })).toBe(1)
    expect(activeFilterCount({ lanes: new Set(), specialties: new Set(), tempo: new Set(), priceMin: 50, priceMax: null })).toBe(1)
    expect(activeFilterCount({ lanes: new Set(), specialties: new Set(), tempo: new Set(), priceMin: null, priceMax: null })).toBe(0)
  })
})
