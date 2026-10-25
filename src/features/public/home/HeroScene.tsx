import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui'
import { RANK_TIER_LABEL, RANK_TIER_ORDER } from '@/lib/utils'
import { CrestStack } from './CrestStack'
import { DotField } from './DotField'
import { HEADER_HEIGHT } from './homeContent'
import { clamp, mapRange } from './math'
import { usePinnedScene } from './useScene'

const FLOATIES = [
  { label: 'Elo Boost', cls: 'left-[9%] top-[18%] -rotate-[8deg] bg-brand text-ink-inverse', delay: '0s' },
  { label: 'Win Boost', cls: 'right-[10%] top-[10%] rotate-[7deg] bg-accent text-bg-base', delay: '-1s' },
  { label: 'Clash', cls: 'right-[4%] top-[52%] -rotate-[5deg] bg-info text-white max-sm:hidden', delay: '-2s' },
  { label: 'Coaching', cls: 'left-[3%] top-[58%] rotate-[9deg] bg-success text-ink-inverse max-sm:hidden', delay: '-3s' },
] as const

const NOTE_BASE =
  'absolute left-1/2 z-[3] w-max max-w-[min(90vw,760px)] -translate-x-1/2 opacity-0 px-7 py-5 font-display font-bold leading-[1.08] tracking-tight text-[clamp(22px,3.4vw,44px)]'

// Hero fixado: o card fica parado e a rolagem conduz o emblema. 0–.3 o texto sobe e
// some · até .42 o emblema sobe · .6–.86 primeira nota · .86 segunda nota · sobe de elo o tempo todo.
export function HeroScene() {
  const sectionRef = useRef<HTMLElement>(null)
  const copyRef = useRef<HTMLDivElement>(null)
  const floatiesRef = useRef<HTMLDivElement>(null)
  const emblemRef = useRef<HTMLDivElement>(null)
  const note1Ref = useRef<HTMLParagraphElement>(null)
  const note2Ref = useRef<HTMLParagraphElement>(null)
  const reachRef = useRef(0.75)
  const [tier, setTier] = useState(0)
  const lastTier = useRef(0)

  usePinnedScene(sectionRef, (p) => {
    const copy = copyRef.current, floaties = floatiesRef.current, emblem = emblemRef.current
    const n1 = note1Ref.current, n2 = note2Ref.current
    if (!copy || !floaties || !emblem || !n1 || !n2) return
    copy.style.transform = `translateY(${mapRange(p, [0, 0.3], [0, -90])}px)`
    copy.style.opacity = String(mapRange(p, [0, 0.24], [1, 0]))
    copy.style.visibility = p > 0.26 ? 'hidden' : ''
    floaties.style.opacity = String(mapRange(p, [0, 0.22], [1, 0]))
    floaties.style.transform = `translateY(${mapRange(p, [0, 0.3], [0, -60])}px) scale(${mapRange(p, [0, 0.3], [1, 1.12])})`
    emblem.style.transform = `translateY(${mapRange(p, [0, 0.42, 0.58, 0.88], [0, -42, -42, 40])}%) scale(${mapRange(p, [0, 0.42, 0.88], [1, 1.08, 0.96])})`
    n1.style.opacity = String(mapRange(p, [0.6, 0.68, 0.8, 0.86], [0, 1, 1, 0]))
    n1.style.transform = `translate(0, ${mapRange(p, [0.6, 0.68], [24, 0])}px)`
    n2.style.opacity = String(mapRange(p, [0.86, 0.93], [0, 1]))
    n2.style.transform = `translate(0, ${mapRange(p, [0.86, 0.93], [24, 0])}px)`
    reachRef.current = mapRange(p, [0, 0.42, 0.62, 0.9], [0.75, 1.05, 1.05, 0.4])
    const next = clamp(Math.floor(mapRange(p, [0.08, 0.9], [0, RANK_TIER_ORDER.length])), 0, RANK_TIER_ORDER.length - 1)
    if (next !== lastTier.current) { lastTier.current = next; setTier(next) }
  }, { stick: HEADER_HEIGHT, stillProgress: 0 })

  const label = RANK_TIER_LABEL[RANK_TIER_ORDER[tier]]
  return (
    <header ref={sectionRef} className="relative h-[100svh] motion-safe:h-[250svh]">
      <div className="sticky p-2.5 max-sm:p-1.5" style={{ top: HEADER_HEIGHT, height: `calc(100svh - ${HEADER_HEIGHT}px)` }}>
        <div className="relative isolate h-full overflow-hidden rounded-[40px_40px_40px_14px] border border-border-subtle bg-bg-base max-sm:rounded-[28px_28px_28px_10px]">
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-hero-glow" />
          <DotField reachRef={reachRef} className="absolute inset-0 -z-[5]" />

          <div ref={copyRef} className="absolute inset-x-0 top-[max(40px,7vh)] z-[3] grid justify-items-center gap-5 px-5 text-center will-change-transform max-sm:top-8 max-sm:gap-4">
            <span className="lp-intro badge border border-brand/30 bg-brand/10 text-brand" style={{ '--d': 0 } as React.CSSProperties}>
              Boosters verificados · Garantia 100%
            </span>
            <h1 className="lp-intro text-[clamp(46px,8.6vw,104px)] font-black leading-[0.98] tracking-tight text-ink" style={{ '--d': 1 } as React.CSSProperties}>
              SUBA DE <span className="text-gradient-brand">ELO.</span>
            </h1>
            <p className="lp-intro max-w-2xl text-[clamp(17px,2vw,20px)] leading-relaxed text-ink-secondary" style={{ '--d': 2 } as React.CSSProperties}>
              Solo boost, duo boost, coaching e MD5 profissionais — com transparência total, chat ao vivo e{' '}
              <span className="font-semibold text-ink">garantia de 100% de conclusão</span>.
            </p>
            <div className="lp-intro flex flex-wrap items-center justify-center gap-3" style={{ '--d': 3 } as React.CSSProperties}>
              <Button asChild size="lg"><Link to="/orders/new">Começar Agora <ArrowRight className="h-5 w-5" /></Link></Button>
              <Button asChild size="lg" variant="secondary"><Link to="/apply?booster=1">Seja Booster</Link></Button>
            </div>
          </div>

          <p ref={note1Ref} aria-hidden="true" className={`${NOTE_BASE} top-[24%] rounded-[34px_34px_34px_10px] border border-border-strong bg-bg-raised text-ink`}>
            <small className="mb-1.5 block font-mono text-xs tracking-[0.14em] text-ink-muted">BOOSTER</small>
            Assumi sua conta. Foco total na sua subida.
          </p>
          <p ref={note2Ref} aria-hidden="true" className={`${NOTE_BASE} top-[30%] rounded-[34px_34px_10px_34px] bg-brand text-ink-inverse shadow-brand`}>
            <small className="mb-1.5 block font-mono text-xs tracking-[0.14em] text-ink-inverse/70">VOCÊ</small>
            Cheguei no rank que eu queria!
            <span className="mt-3 flex w-fit rounded-full bg-ink-inverse/15 px-3 py-1 font-sans text-sm font-bold tracking-normal">✓ Pedido concluído</span>
          </p>

          <div ref={floatiesRef} aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 z-[3] h-[48%] will-change-transform">
            {FLOATIES.map(({ label: text, cls, delay }) => (
              <span key={text} className={`lp-bob absolute rounded-[18px_18px_18px_5px] px-4 py-2 font-display text-[clamp(14px,1.6vw,18px)] font-semibold shadow-card ${cls}`} style={{ animationDelay: delay }}>
                {text}
              </span>
            ))}
          </div>

          <p aria-hidden="true" className="absolute bottom-4 left-1/2 z-[4] -translate-x-1/2 rounded-full border border-border-strong bg-bg-base/70 px-4 py-1.5 font-mono text-xs uppercase tracking-[0.3em] text-brand backdrop-blur-md">{label}</p>

          <div ref={emblemRef} aria-hidden="true" className="absolute bottom-0 left-1/2 z-[2] w-[min(560px,80%)] -translate-x-1/2 origin-bottom will-change-transform">
            <div className="translate-y-[calc(100%-min(300px,34svh))]">
              <div className="lp-pop relative">
                <CrestStack activeIndex={tier} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
