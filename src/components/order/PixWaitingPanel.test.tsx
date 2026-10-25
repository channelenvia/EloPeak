// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PixWaitingPanel, type PixWaitingPanelProps } from './PixWaitingPanel'

const BASE: PixWaitingPanelProps = {
  totalPrice: 89.9, qrCode: '00020126PIXCODECOMPLETO6304ABCD', qrCodeBase64: 'AAAA', remaining: 600,
  countdownLabel: '10:00', copied: false, copyError: null, onCopy: () => {}, onCancel: () => {}, cancelling: false,
}

describe('PixWaitingPanel', () => {
  it('mostra o QR code acima e o código completo abaixo, em coluna única', () => {
    render(<PixWaitingPanel {...BASE} />)
    const qr = screen.getByAltText('QR Code PIX')
    const code = screen.getByText(BASE.qrCode)
    expect(qr.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const cancel = screen.getByRole('button', { name: /cancelar pedido/i })
    const copy = screen.getByRole('button', { name: /^copiar código$/i })
    expect(cancel.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('10:00')).toBeInTheDocument()
  })

  it('copiar e cancelar disparam os callbacks', () => {
    const onCopy = vi.fn(); const onCancel = vi.fn()
    render(<PixWaitingPanel {...BASE} onCopy={onCopy} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: /^copiar código$/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancelar pedido/i }))
    expect(onCopy).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('sem imagem do QR mostra o placeholder e mantém o código copiável', () => {
    render(<PixWaitingPanel {...BASE} qrCodeBase64={null} copied />)
    expect(screen.queryByAltText('QR Code PIX')).not.toBeInTheDocument()
    expect(screen.getByText(/Gerando o QR code/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copiado/i })).toBeInTheDocument()
  })
})
