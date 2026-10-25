import { useEffect, useRef, useState } from 'react'
import { animate, useInView } from 'framer-motion'

interface AnimatedNumberProps {
  value: number
  /** Como exibir o número em andamento (moeda, sufixo...). Recebe valores fracionários. */
  format?: (n: number) => string
  className?: string
}

const COUNT_DURATION_S = 0.8
const COUNT_EASE = [0.16, 1, 0.3, 1] as const

const defaultFormat = (n: number) => Math.round(n).toLocaleString('pt-BR')

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

// Conta de 0 até `value` quando entra na tela e, se `value` mudar depois, desliza do
// número atual para o novo. Com reduced-motion mostra o valor final direto.
export function AnimatedNumber({ value, format = defaultFormat, className }: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  const [still] = useState(prefersReducedMotion)
  const [shown, setShown] = useState(0)
  const from = useRef(0)

  useEffect(() => {
    if (still || !inView) return
    const controls = animate(from.current, value, {
      duration: COUNT_DURATION_S,
      ease: COUNT_EASE,
      onUpdate: (n) => { from.current = n; setShown(n) },
    })
    return () => controls.stop()
  }, [inView, still, value])

  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {format(still ? value : shown)}
    </span>
  )
}
