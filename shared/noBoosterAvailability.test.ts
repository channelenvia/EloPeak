import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Verificação estática: o conceito de booster "disponível/indisponível" como
// TOGGLE MANUAL (badge setado pelo booster, coluna crua is_available, view
// derivada) foi removido em favor de "visto por último" (last_active_at via
// formatLastSeen()). Este teste garante que esse toggle manual/binário não
// volta a aparecer escondido em algum arquivo tocado pela reforma.
//
// isBoosterOnline() (lib/utils.ts) é uma exceção deliberada: não é um toggle
// manual, é só "last_active_at nos últimos 5min" -- a mesma fonte da verdade
// de formatLastSeen(), sem coluna nova nem input do booster. Por isso só
// is_available e o rótulo "Disponível/Indisponível" continuam banidos aqui.
const root = join(__dirname, '..')

function read(relPath: string): string {
  return readFileSync(join(root, relPath), 'utf-8')
}

const BOOSTER_FACING_FILES = [
  'src/types/index.ts',
  'src/lib/database.types.ts',
  'src/features/public/pages/BoostersPage.tsx',
  'src/features/public/pages/BoosterPublicProfilePage.tsx',
  'src/features/public/pages/HomePage.tsx',
  'src/features/admin/pages/BoosterDetail.tsx',
  'src/api/boosters/hooks.ts',
  'src/components/ui/Avatar.tsx',
  'src/components/UserAccountBadge.tsx',
]

describe('Ausência do conceito de disponibilidade manual/binária de booster', () => {
  for (const file of BOOSTER_FACING_FILES) {
    it(`${file} não referencia is_available nem rótulo Disponível/Indisponível`, () => {
      const content = read(file)
      expect(content).not.toContain('is_available')
      expect(content.toLowerCase()).not.toMatch(/isponível/)
    })
  }
})
