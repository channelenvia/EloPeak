import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'

export interface SegmentedBarProps {
  /** Quantos blocos a barra é dividida -- cada um fecha 100% antes do
   * próximo começar a preencher. Pensado pra bater com a MESMA unidade usada
   * no cálculo de drop/reatribuição (apply_order_drop): 1 vitória contratada,
   * 1 divisão de rank, ou 1 quarto de PDL restante (Master+) -- nunca uma
   * fração contínua solta, sem relação com o valor efetivamente pago. */
  segments: number
  /** Quantos segmentos preenchidos, como fração (ex.: 2.4 = 2 cheios + 40% do 3º). */
  filled: number
  tone?: 'brand' | 'success'
  locked?: boolean
  height?: string
  className?: string
}

export function SegmentedBar({ segments, filled, tone = 'brand', locked = false, height = 'h-2', className }: SegmentedBarProps) {
  const safeSegments = Math.max(1, Math.round(segments))
  const clampedFilled = Math.max(0, Math.min(safeSegments, filled))
  // Primeira pintura em 0 para a barra encher na montagem; depois só acompanha `filled`.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return (
    <div
      className={cn('flex gap-1', locked && 'blur-[3px] opacity-60', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={safeSegments}
      aria-valuenow={Math.round(clampedFilled * 10) / 10}
    >
      {Array.from({ length: safeSegments }, (_, i) => {
        const segmentPct = mounted ? Math.max(0, Math.min(1, clampedFilled - i)) * 100 : 0
        return (
          <div key={i} className={cn('flex-1 min-w-0 rounded-full bg-bg-raised overflow-hidden', height)}>
            <div
              className={cn('h-full w-full transition-[clip-path] duration-[700ms] ease-out', tone === 'success' ? 'bg-success' : 'bg-brand')}
              // clip-path em vez de width: não dispara layout, e a ponta continua arredondada.
              style={{ clipPath: `inset(0 ${100 - segmentPct}% 0 0 round 9999px)` }}
            />
          </div>
        )
      })}
    </div>
  )
}
