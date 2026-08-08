import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface PopoverProps {
  open: boolean
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement | null>
  children: React.ReactNode
  className?: string
  /** Alinhamento horizontal do painel em relação à borda do anchor. */
  align?: 'start' | 'end'
}

/**
 * Popover ancorado que escapa de qualquer ancestral com `overflow: auto/hidden`
 * (ex.: o wrapper `overflow-auto` de <Table>) via portal pra `document.body` +
 * posicionamento `fixed` calculado a partir do bounding rect do anchor.
 * Diferente de um popover `position: absolute` comum, não fica preso/cortado
 * dentro do container que o chama, sem precisar recorrer a um modal de tela
 * inteira. Fecha ao clicar fora ou pressionar Escape; reposiciona em scroll/resize.
 */
export function Popover({ open, onClose, anchorRef, children, className, align = 'end' }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) { setPos(null); return }

    function updatePosition() {
      const anchor = anchorRef.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const panelWidth = panelRef.current?.offsetWidth ?? 320
      const panelHeight = panelRef.current?.offsetHeight ?? 0
      let left = align === 'end' ? rect.right - panelWidth : rect.left
      left = Math.min(Math.max(8, left), window.innerWidth - panelWidth - 8)

      // Se não couber embaixo do anchor até o fim da viewport, abre pra cima.
      const spaceBelow = window.innerHeight - rect.bottom
      const openUpward = spaceBelow < panelHeight + 16 && rect.top > panelHeight + 16
      const top = openUpward ? rect.top - panelHeight - 8 : rect.bottom + 8

      setPos({ top, left })
    }

    updatePosition()
    // Segunda passada no próximo frame -- a primeira mede o painel recém-montado
    // com offsetHeight ainda zerado antes do layout assentar.
    const raf = requestAnimationFrame(updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, anchorRef, align])

  useEffect(() => {
    if (!open) return
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (panelRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose, anchorRef])

  if (!open) return null

  return createPortal(
    <div
      ref={panelRef}
      style={pos ? { position: 'fixed', top: pos.top, left: pos.left } : { position: 'fixed', top: -9999, left: -9999 }}
      className={cn('z-[100] bg-bg-surface border border-bg-elevated rounded-xl shadow-2xl', className)}
    >
      {children}
    </div>,
    document.body,
  )
}
