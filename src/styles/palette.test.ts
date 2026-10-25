import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Trava da paleta: a identidade visual (verde de marca, dourado, base neutra)
// não pode mudar numa padronização. Alterar de propósito => atualizar aqui.
const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8')
const PALETTE: Record<string, string> = {
  '--color-bg-base': '14  14  16', '--color-bg-surface': '20  20  23', '--color-bg-raised': '27  27  31',
  '--color-bg-elevated': '31  31  36', '--color-bg-interactive': '35  35  40',
  '--color-border-subtle': '40  40  45', '--color-border-strong': '60  60  67',
  '--color-ink': '237 238 239', '--color-ink-secondary': '160 163 168', '--color-ink-muted': '135 139 146',
  '--color-brand': '34  197 94', '--color-brand-hover': '22  163 74', '--color-accent': '245 184 0',
  '--color-success': '61  220 132', '--color-warning': '245 158 11', '--color-danger': '239 68  68', '--color-info': '59  130 246',
}

describe('paleta de cores', () => {
  it.each(Object.entries(PALETTE))('%s permanece %s', (token, value) => {
    expect(css).toMatch(new RegExp(`${token}:\\s*${value};`))
  })
})
