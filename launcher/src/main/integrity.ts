import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

// SHA-256 do launcher/vendor/deceive/Deceive.exe vendorizado. O launcher so executa o Deceive se o arquivo em disco
// bater com este hash (um .exe trocado por outro programa rodaria com o usuario logado do booster).
// Ao atualizar o Deceive: substitua o .exe, rode `shasum -a 256 launcher/vendor/deceive/Deceive.exe`
// e cole o resultado aqui; o teste shared/launcherIntegrity.test.ts falha se os dois divergirem.
export const DECEIVE_SHA256 = '25dc5427affed66aa38ec1d9103ffa1a47256dab4e698bef32543fbf0cf3d2e5'

export function sha256OfFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function isTrustedFile(path: string, expectedSha256: string): boolean {
  try {
    return sha256OfFile(path) === expectedSha256.toLowerCase()
  } catch {
    return false
  }
}
