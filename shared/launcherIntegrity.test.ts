import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DECEIVE_SHA256, isTrustedFile, sha256OfFile } from '../launcher/src/main/integrity'

const DECEIVE_EXE = join(__dirname, '..', 'launcher', 'vendor', 'deceive', 'Deceive.exe')

describe('integridade do Deceive vendorizado', () => {
  it('o hash esperado no codigo bate com o Deceive.exe do repositorio (atualize integrity.ts ao trocar o binario)', () => {
    expect(sha256OfFile(DECEIVE_EXE)).toBe(DECEIVE_SHA256)
    expect(isTrustedFile(DECEIVE_EXE, DECEIVE_SHA256)).toBe(true)
  })

  it('arquivo adulterado, ausente ou com hash diferente nao e confiavel', () => {
    const dir = mkdtempSync(join(tmpdir(), 'deceive-'))
    try {
      const fake = join(dir, 'Deceive.exe')
      writeFileSync(fake, 'MZ not the real deceive')
      expect(isTrustedFile(fake, DECEIVE_SHA256)).toBe(false)
      expect(isTrustedFile(join(dir, 'missing.exe'), DECEIVE_SHA256)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
