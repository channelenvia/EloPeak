import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// public/.htaccess (Hostinger/Apache) replica os headers de seguranca do vercel.json.
const root = join(__dirname, '..')
const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as {
  headers: { source: string; headers: { key: string; value: string }[] }[]
}
const htaccess = readFileSync(join(root, 'public', '.htaccess'), 'utf8')

describe('.htaccess x vercel.json', () => {
  it.each(vercel.headers[0].headers)('replica o header $key', ({ key, value }) => {
    expect(htaccess).toContain(`Header always set ${key} "${value}"`)
  })

  it('tem fallback do SPA para index.html', () => {
    expect(htaccess).toContain('RewriteRule ^ /index.html [L]')
  })
})
