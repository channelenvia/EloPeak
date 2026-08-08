import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Verificação estática: as vitrines públicas de descoberta de boosters usam
// a seleção sistemática (get_top_boosters) em vez de uma lista fixa de "Top
// 5" baseada no flag is_top3. is_top3 continua existindo — é usado pra bônus
// de slot de pedido concorrente do booster (booster_active_slot_counts) e
// pelo badge de reconhecimento no perfil público — mas não deve voltar a
// aparecer nas telas de descoberta/recomendação verificadas aqui.
const root = join(__dirname, '..')

function read(relPath: string): string {
  return readFileSync(join(root, relPath), 'utf-8')
}

describe('Vitrines de descoberta usam get_top_boosters, não lista fixa de Top 5', () => {
  const discoveryFiles = [
    'src/features/public/pages/BoostersPage.tsx',
    'src/features/public/pages/HomePage.tsx',
  ]

  for (const file of discoveryFiles) {
    it(`${file} chama get_top_boosters`, () => {
      expect(read(file)).toContain('get_top_boosters')
    })

    it(`${file} não ordena/filtra boosters por is_top3`, () => {
      expect(read(file)).not.toContain('is_top3')
    })

    it(`${file} não exibe o rótulo "Top 5"`, () => {
      expect(read(file)).not.toMatch(/Top\s*5/)
    })
  }
})
