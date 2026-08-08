import { describe, it, expect } from 'vitest'
import { matchesCoachPackageFilters, activeFilterCount, type CoachPackageLike } from './coachFilters'

const midMacro: CoachPackageLike = { title: 'Coaching de Meio', description: 'foco em macro', lanes: ['mid'], specialties: ['macro'] }
const topTrades: CoachPackageLike = { title: 'Topo agressivo', description: null, lanes: ['top'], specialties: ['trades'] }
const jungleVision: CoachPackageLike = { title: 'Selva', description: 'controle de objetivos', lanes: ['jungle'], specialties: ['vision', 'objectives'] }

const NONE = { search: '', lanes: new Set<string>(), specialties: new Set<string>() }

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

  it('busca casa título, descrição ou nome do coach, sem diferenciar maiúsculas/espaços', () => {
    expect(matchesCoachPackageFilters(midMacro, 'Fulano', { ...NONE, search: '  MACRO ' })).toBe(true) // descrição
    expect(matchesCoachPackageFilters(topTrades, 'Beltrano', { ...NONE, search: 'beltrano' })).toBe(true) // nome do coach
    expect(matchesCoachPackageFilters(topTrades, 'Fulano', { ...NONE, search: 'inexistente' })).toBe(false)
  })

  it('pacote sem lanes/specialties é excluído quando há filtro daquele grupo', () => {
    const semTags: CoachPackageLike = { title: 'Genérico', description: null, lanes: null, specialties: null }
    expect(matchesCoachPackageFilters(semTags, 'x', { ...NONE, lanes: new Set(['mid']) })).toBe(false)
    expect(matchesCoachPackageFilters(semTags, 'x', NONE)).toBe(true) // sem filtro, passa
  })
})

describe('activeFilterCount', () => {
  it('conta rotas + especialidades, ignora a busca', () => {
    expect(activeFilterCount({ lanes: new Set(['mid', 'top']), specialties: new Set(['macro']) })).toBe(3)
    expect(activeFilterCount({ lanes: new Set(), specialties: new Set() })).toBe(0)
  })
})
