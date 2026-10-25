import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// A imagem do captcha vem de https://<ref>.supabase.co/functions/v1/accept-challenge-image; sem img-src liberando
// o host, o navegador bloqueia o <img> e o booster nao consegue aceitar pedidos.
describe('CSP do vercel.json', () => {
  const config = JSON.parse(readFileSync(resolve(__dirname, '../../../vercel.json'), 'utf8')) as {
    headers: { headers: { key: string; value: string }[] }[]
  }
  const csp = config.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy')?.value ?? ''
  const imgSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('img-src ')) ?? ''

  it('img-src permite a imagem do captcha servida pela Edge Function do Supabase', () => {
    expect(imgSrc.split(/\s+/)).toContain('https://yrynfqjxqblrbxxiobty.supabase.co')
  })

  it('nao abre img-src para wildcard, blob: nem http: genericos', () => {
    expect(imgSrc).not.toMatch(/\bblob:|\shttp:|\s\*(\s|$)|\*\.supabase\.co/)
  })
})
