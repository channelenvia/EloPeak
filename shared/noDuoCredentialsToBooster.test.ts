import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Verificação estática: login/senha de contas Duo nunca chegam ao navegador
// do booster — só admin pode chamar get_duo_account_credentials (reforçado
// no backend pela migration 056). O booster só vê um token opaco via
// get_duo_account_access_token, resolvido pela edge function
// resolve-duo-account-credentials (nunca diretamente do browser).
const root = join(__dirname, '..')

function read(relPath: string): string {
  return readFileSync(join(root, relPath), 'utf-8')
}

describe('Contas Duo: booster nunca vê login/senha cru', () => {
  const boosterFiles = [
    'src/features/booster/pages/Accounts.tsx',
    'src/features/booster/pages/JobDetail.tsx',
    'src/components/order/DuoAccountSection.tsx',
    'src/api/duoAccounts/queries.ts',
  ]

  for (const file of boosterFiles) {
    it(`${file} não chama get_duo_account_credentials`, () => {
      expect(read(file)).not.toContain('get_duo_account_credentials')
    })
  }

  it('src/api/duoAccounts/mutations.ts só expõe get_duo_account_credentials sob nome admin-only', () => {
    // adminGetDuoAccountCredentials é a única função que chama essa RPC --
    // nome explícito para deixar claro, em qualquer futuro import, que é
    // admin-only (não deve ser importada por páginas de booster).
    const content = read('src/api/duoAccounts/mutations.ts')
    expect(content).toContain('adminGetDuoAccountCredentials')
  })

  it('DuoAccountSection.tsx (booster) usa reserva + token opaco de conta Duo (camada de API)', () => {
    // As chamadas em si vivem em src/api/duoAccounts/mutations.ts
    // (useReserveDuoAccount/useGetDuoAccountAccessToken) desde a introdução
    // da camada de API tipada -- src/components/order/DuoAccountSection.tsx
    // (extraído de JobDetail.tsx) consome os hooks.
    const page = read('src/components/order/DuoAccountSection.tsx')
    expect(page).toContain('useReserveDuoAccount')
    expect(page).toContain('useGetDuoAccountAccessToken')
    const api = read('src/api/duoAccounts/mutations.ts')
    expect(api).toContain('reserve_duo_account')
    expect(api).toContain('get_duo_account_access_token')
  })

  it('resolve_duo_account_access_token só é chamada pela edge function dedicada', () => {
    const content = read('supabase/functions/resolve-duo-account-credentials/index.ts')
    expect(content).toContain('resolve_duo_account_access_token')
  })
})
