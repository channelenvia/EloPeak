import { useRef, useState } from 'react'
import { Check, MessageCircle, ShieldCheck } from 'lucide-react'
import { RankBadge } from '@/components/ui'
import { cn } from '@/lib/cn'
import { HEADER_HEIGHT, STEPS } from './homeContent'
import { WordsHeading } from './WordsHeading'
import { usePinnedScene, useSceneEngine } from './useScene'

const STEP_COUNT = STEPS.length
const FILL_STEEPNESS = (STEP_COUNT + 1) / STEP_COUNT // a barra completa um passo antes do fim

// Ilustrações dos passos: só estado visual, sem números inventados.
function StepScene({ index }: { index: number }) {
  if (index === 0) {
    return (
      <div className="grid w-[min(420px,100%)] gap-4 rounded-2xl border border-border-strong bg-bg-surface p-5 shadow-card-hover">
        <p className="section-label">Seu pedido</p>
        <div className="flex items-center justify-between">
          <RankBadge tier="gold" division="IV" size="md" showLabel />
          <span aria-hidden="true" className="font-display text-2xl text-brand">→</span>
          <RankBadge tier="diamond" division="IV" size="md" showLabel />
        </div>
        <div className="rounded-xl bg-brand py-3 text-center text-sm font-semibold text-ink-inverse shadow-brand">Pagar com segurança</div>
      </div>
    )
  }
  if (index === 1) {
    return (
      <div className="grid w-[min(420px,100%)] gap-4 rounded-2xl border border-border-strong bg-bg-surface p-5 shadow-card-hover">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-brand/15 text-brand"><ShieldCheck className="h-6 w-6" /></span>
          <div><b className="block font-display">Booster verificado</b><span className="text-sm text-ink-secondary">aceitou o seu pedido</span></div>
        </div>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-success/10 px-3 py-1 text-sm font-bold text-success"><Check className="h-4 w-4" />Atribuído em até 30 minutos</span>
      </div>
    )
  }
  return (
    <div className="grid w-[min(420px,100%)] gap-4 rounded-2xl border border-border-strong bg-bg-surface p-5 shadow-card-hover">
      <div className="h-2.5 overflow-hidden rounded-full bg-bg-interactive"><div className="h-full w-[62%] rounded-full bg-gradient-brand" /></div>
      <div className="grid gap-2 text-sm">
        <p className="max-w-[85%] rounded-2xl rounded-bl-md border border-border-subtle bg-bg-raised px-3.5 py-2.5">Subimos mais uma divisão. Seguimos!</p>
        <p className="flex max-w-[85%] items-center gap-1.5 justify-self-end rounded-2xl rounded-br-md bg-brand px-3.5 py-2.5 text-ink-inverse"><MessageCircle className="h-4 w-4" />Valeu, booster!</p>
      </div>
    </div>
  )
}

// Passo a passo fixado: as abas enchem com a rolagem e a cena troca a cada terço.
export function StepsPinned() {
  const engine = useSceneEngine()
  const sectionRef = useRef<HTMLElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const [current, setCurrent] = useState(0)
  const last = useRef(0)

  usePinnedScene(sectionRef, (p) => {
    fillRef.current?.style.setProperty('transform', `scaleX(${Math.min(1, p * FILL_STEEPNESS).toFixed(4)})`)
    const next = Math.min(STEP_COUNT - 1, Math.floor(p * STEP_COUNT))
    if (next !== last.current) { last.current = next; setCurrent(next) }
  }, { stick: HEADER_HEIGHT, stillProgress: 1 / STEP_COUNT })

  const go = (i: number) => {
    const section = sectionRef.current
    if (!section) return
    if (engine.still) { last.current = i; setCurrent(i); return }
    engine.scrollToProgress(section, (i + 0.55) / STEP_COUNT, HEADER_HEIGHT)
  }

  const step = STEPS[current]
  return (
    <section ref={sectionRef} aria-label="Como funciona" className="relative h-auto motion-safe:h-[300svh]">
      <div className="sticky flex flex-col items-center justify-center gap-6 px-4 py-6" style={{ top: HEADER_HEIGHT, minHeight: `calc(100svh - ${HEADER_HEIGHT}px)` }}>
        <div className="grid justify-items-center gap-3 text-center">
          <p className="section-label">Processo simples</p>
          <WordsHeading text="3 passos para seu rank alvo" className="font-display text-[clamp(30px,4vw,52px)] font-black leading-tight text-ink" highlight={[3, 4]} />
        </div>

        <div className="relative flex gap-[clamp(10px,4vw,56px)]" role="tablist" aria-label="Passos">
          <div aria-hidden="true" className="absolute inset-x-12 top-6 h-1.5 rounded-full bg-bg-interactive" />
          <div aria-hidden="true" ref={fillRef} className="absolute inset-x-12 top-6 h-1.5 origin-left scale-x-0 rounded-full bg-brand" />
          {STEPS.map((s, i) => (
            <button key={s.n} type="button" role="tab" aria-selected={i === current} onClick={() => go(i)}
              className={cn('focus-ring relative z-[1] grid w-[clamp(72px,18vw,128px)] justify-items-center gap-2 rounded-xl text-sm font-bold transition-colors', i === current ? 'text-ink' : 'text-ink-muted')}>
              <span className={cn('grid h-12 w-12 place-items-center rounded-full border font-display text-lg transition-[background-color,scale,color] duration-300 ease-[cubic-bezier(.34,1.56,.64,1)]',
                i <= current ? 'border-brand bg-brand text-ink-inverse shadow-brand' : 'border-border-strong bg-bg-surface', i === current && 'scale-110')}>
                {i < current ? <Check className="h-5 w-5" /> : i + 1}
              </span>
              <span className="max-sm:hidden">{s.label}</span>
            </button>
          ))}
        </div>

        <div className="relative grid min-h-[200px] w-full max-w-3xl place-items-center rounded-[30px] border border-border-subtle bg-bg-surface/60 p-6 backdrop-blur-md">
          <div key={step.n} className="lp-swap grid w-full place-items-center"><StepScene index={current} /></div>
        </div>

        <div key={step.title} className="lp-swap max-w-[52ch] text-center">
          <h3 className="font-display text-xl font-bold text-ink">{step.title}</h3>
          <p className="mt-2 text-ink-secondary">{step.body}</p>
        </div>
      </div>
    </section>
  )
}
