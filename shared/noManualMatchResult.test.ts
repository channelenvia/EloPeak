import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Verificação estática: o fluxo manual de resultado de partida (+1 Win / +1
// Loss, log_match_result) foi substituído por sincronização automática via
// Riot Match-V5 (sync-order-matches). Nenhum arquivo do booster deve voltar
// a chamar log_match_result nem oferecer incremento manual de vitória/derrota.
const root = join(__dirname, '..')

function read(relPath: string): string {
  return readFileSync(join(root, relPath), 'utf-8')
}

describe('Ausência do fluxo manual de resultado de partida', () => {
  const filesToCheck = [
    'src/features/booster/pages/JobDetail.tsx',
    'src/features/customer/pages/OrderDetail.tsx',
  ]

  for (const file of filesToCheck) {
    it(`${file} não referencia log_match_result`, () => {
      expect(read(file)).not.toContain('log_match_result')
    })
  }

  it('JobDetail.tsx não tem botões de incremento manual de vitória/derrota', () => {
    const content = read('src/features/booster/pages/JobDetail.tsx')
    expect(content).not.toMatch(/\+1\s*Win/i)
    expect(content).not.toMatch(/\+1\s*Loss/i)
  })

  it('JobDetail.tsx oferece sincronização via sync-order-matches (camada de API)', () => {
    // A chamada em si vive em src/api/orders/mutations.ts (useSyncOrderMatches)
    // desde a introdução da camada de API tipada -- JobDetail.tsx consome o
    // hook em vez de chamar a Edge Function diretamente.
    const page = read('src/features/booster/pages/JobDetail.tsx')
    expect(page).toContain('useSyncOrderMatches')
    const api = read('src/api/orders/mutations.ts')
    expect(api).toContain('sync-order-matches')
  })
})
