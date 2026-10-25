import { useRef } from 'react'
import { clamp } from './math'
import { useScene, useSceneEngine } from './useScene'

interface KaraokeTextProps {
  /** Palavras entre asteriscos ganham a cor da marca. */
  text: string
  className?: string
}

const TAIL_WORDS = 8
const PHRASE_OFFSET = 0.82
const PHRASE_SPAN = 0.4

// Frase que acende palavra por palavra conforme cruza a tela (--p de 0 a 1).
export function KaraokeText({ text, className }: KaraokeTextProps) {
  const engine = useSceneEngine()
  const ref = useRef<HTMLParagraphElement>(null)
  const spoken = useRef(-1)
  const words = text.trim().split(/\s+/).map((w) => {
    const hl = w.length > 2 && w.startsWith('*') && w.endsWith('*')
    return { label: hl ? w.slice(1, -1) : w, hl }
  })

  useScene(() => {
    const el = ref.current
    if (!el || !engine.near(el)) return
    const r = engine.rect(el)
    const p = clamp((innerHeight * PHRASE_OFFSET - r.top) / (r.height + innerHeight * PHRASE_SPAN))
    el.style.setProperty('--p', p.toFixed(4))
    const now = Math.floor(p * (words.length + TAIL_WORDS) - 1)
    if (now === spoken.current) return
    el.children[spoken.current]?.classList.remove('now')
    el.children[now]?.classList.add('now')
    spoken.current = now
  })

  return (
    <p
      ref={ref}
      aria-label={words.map((w) => w.label).join(' ')}
      className={`lp-reveal ${className ?? ''}`}
      style={{ '--n': words.length } as React.CSSProperties}
    >
      {words.map((w, i) => (
        <span key={i} aria-hidden="true" className={w.hl ? 'w hl' : 'w'} style={{ '--i': i } as React.CSSProperties}>
          {w.label}{' '}
        </span>
      ))}
    </p>
  )
}
