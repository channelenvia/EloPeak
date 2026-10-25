// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ActionBar } from './ActionBar'

describe('ActionBar', () => {
  it('com dois botões, separa cancelar (esquerda) de confirmar (direita)', () => {
    render(<ActionBar><button>Cancelar</button><button>Salvar</button></ActionBar>)
    const bar = screen.getByText('Salvar').parentElement!
    expect(bar.className).toContain('sm:justify-between')
    expect(bar.className).not.toContain('sm:justify-end')
    expect(bar.firstElementChild).toHaveTextContent('Cancelar')
    expect(bar.lastElementChild).toHaveTextContent('Salvar')
  })

  it('com um botão só, alinha à direita', () => {
    render(<ActionBar><button>Gerar PIX</button></ActionBar>)
    expect(screen.getByText('Gerar PIX').parentElement!.className).toContain('sm:justify-end')
  })

  it('ignora filhos falsos ao decidir o alinhamento', () => {
    render(<ActionBar>{false}<button>Confirmar</button></ActionBar>)
    expect(screen.getByText('Confirmar').parentElement!.className).toContain('sm:justify-end')
  })
})
