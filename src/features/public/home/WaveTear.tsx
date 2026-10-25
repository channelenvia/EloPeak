import { useRef, useState } from 'react'
import { RANK_TIER_ORDER } from '@/lib/utils'
import { cn } from '@/lib/cn'
import { HEADER_HEIGHT } from './homeContent'
import { clamp, easeInOutCubic, mapRange } from './math'
import { usePinnedScene } from './useScene'

const BAR_COUNT = 56
const SHADE_LAYERS = 5
const MID_Y = 52

type Point = readonly [number, number]

// Onda de voz: senoide rápida dentro de um envelope que sobe e desce como sílabas.
// Em telas estreitas e altas, % de largura e de altura viram poucos pixels e muitos:
// menos ciclos e menos altura para a onda não virar agulhas.
function voice(amp: number, t: number): Point[] {
  const k = clamp(innerWidth / innerHeight, 0.45, 1)
  const f = 0.9 * clamp(innerWidth / 1200, 0.45, 1)
  const pts: Point[] = []
  for (let x = -2; x <= 103; x += 0.6) {
    const env = Math.sin(Math.PI * clamp(x / 100)) * (0.55 + 0.45 * Math.sin(x / 6.5 + t * 1.3)) * (0.7 + 0.3 * Math.sin(x / 2.3 - t * 2.1))
    pts.push([x, MID_Y + amp * k * env * Math.sin(x * f - t * 7)])
  }
  return pts
}

// Recorta as duas metades pela mesma linha, para que se encaixem.
function clipPaths(pts: Point[]): { top: string; bottom: string; line: string } {
  const poly = pts.map(([x, y]) => `${x.toFixed(1)}% ${y.toFixed(2)}%`)
  const y0 = pts[0][1].toFixed(2)
  const y1 = pts[pts.length - 1][1].toFixed(2)
  return {
    top: `polygon(-5% -5%, 105% -5%, 105% ${y1}%, ${[...poly].reverse().join(', ')}, -5% ${y0}%)`,
    bottom: `polygon(-5% ${y0}%, ${poly.join(', ')}, 105% ${y1}%, 105% 105%, -5% 105%)`,
    line: pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(2)}`).join(' '),
  }
}

function Poster() {
  return (
    <div className="grid place-content-center justify-items-center gap-[1.5vh] bg-bg-base text-center">
      <small className="pl-[0.34em] font-mono text-[clamp(11px,1.5vw,20px)] uppercase tracking-[0.34em] text-ink-muted">Quando o elo trava</small>
      <b className="font-display text-[clamp(64px,19vw,300px)] font-black leading-[0.86] tracking-[-0.05em] text-brand">ELOPEAK</b>
    </div>
  )
}

// O rasgo (270svh): uma onda sonora cruza o cartaz, cresce como uma voz e o abre ao meio.
// .04–.24 a voz cresce · .15–.27 o cartaz zumbe · .24–.72 as metades abrem · .72 a nota sobe.
export function WaveTear() {
  const sectionRef = useRef<HTMLElement>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const crackSvgRef = useRef<SVGSVGElement>(null)
  const crackRef = useRef<SVGPolylineElement>(null)
  const noteRef = useRef<HTMLParagraphElement>(null)
  const hintRef = useRef<HTMLParagraphElement>(null)
  const crestRef = useRef<HTMLDivElement>(null)
  const ringsRef = useRef<HTMLDivElement>(null)
  const barsRef = useRef<HTMLDivElement>(null)
  const [lit, setLit] = useState(0)
  const lastLit = useRef(0)

  usePinnedScene(sectionRef, (p, t) => {
    const top = topRef.current, bottom = bottomRef.current, svg = crackSvgRef.current, crack = crackRef.current
    const note = noteRef.current, hint = hintRef.current, crest = crestRef.current, rings = ringsRef.current, bars = barsRef.current
    if (!top || !bottom || !svg || !crack || !note || !hint || !crest || !rings || !bars) return
    const time = t / 1000
    const open = easeInOutCubic(mapRange(p, [0.24, 0.72], [0, 1]))
    const rise = mapRange(p, [0.2, 0.62], [0, 1])
    const amp = mapRange(p, [0.04, 0.18, 0.24, 0.5], [0.6, 4.5, 7, 9])
    const clips = clipPaths(voice(amp, time))
    for (const el of top.children) (el as HTMLElement).style.clipPath = clips.top
    for (const el of bottom.children) (el as HTMLElement).style.clipPath = clips.bottom
    crack.setAttribute('points', clips.line)
    crack.style.strokeDashoffset = String(1 - mapRange(p, [0.05, 0.2], [0, 1]))
    const buzz = mapRange(p, [0.15, 0.21, 0.27], [0, 1, 0]) * Math.sin(time * 60) * 3
    top.style.transform = `translateY(calc(${(-open * 58).toFixed(2)}vh + ${buzz.toFixed(2)}px))`
    bottom.style.transform = `translateY(calc(${(open * 55).toFixed(2)}vh - ${buzz.toFixed(2)}px))`
    svg.style.opacity = String(mapRange(p, [0.24, 0.34], [1, 0]))
    rings.style.opacity = String(mapRange(p, [0.3, 0.5], [0, 1]))
    crest.style.transform = `translateY(${((1 - rise) * 34).toFixed(2)}%) scale(${(0.9 + 0.1 * rise).toFixed(4)})`
    note.style.opacity = String(mapRange(p, [0.72, 0.8], [0, 1]))
    note.style.translate = `-50% ${mapRange(p, [0.72, 0.8], [20, 0])}px`
    hint.style.opacity = String(mapRange(p, [0, 0.08], [1, 0]))
    const level = mapRange(p, [0.26, 0.5], [0, 1])
    Array.from(bars.children).forEach((bar, i) => {
      const env = Math.sin(Math.PI * (i / (BAR_COUNT - 1))) ** 1.5
      const n = 0.5 + 0.5 * Math.sin(time * (4 + (i % 5)) + i * 1.7) * Math.sin(time * 2.3 + i * 0.6)
      ;(bar as HTMLElement).style.height = `${(6 + level * env * (0.25 + 0.75 * n) * 46).toFixed(1)}vh`
    })
    const next = Math.round(mapRange(p, [0.3, 0.7], [0, RANK_TIER_ORDER.length]))
    if (next !== lastLit.current) { lastLit.current = next; setLit(next) }
  }, { stick: HEADER_HEIGHT, stillProgress: 1 })

  return (
    <section ref={sectionRef} aria-label="O EloPeak aparece quando você precisa" className="relative h-[100svh] motion-safe:h-[270svh]">
      <div className="sticky overflow-hidden" style={{ top: HEADER_HEIGHT, height: `calc(100svh - ${HEADER_HEIGHT}px)` }}>
        <div className="absolute inset-0 bg-[radial-gradient(80%_70%_at_50%_60%,rgb(20_58_35)_0%,rgb(10_24_16)_55%,rgb(6_10_8)_100%)]">
          <div ref={barsRef} aria-hidden="true" className="absolute inset-0 flex items-center justify-center gap-[clamp(3px,0.55vw,9px)] px-[3vw]">
            {Array.from({ length: BAR_COUNT }, (_, i) => (
              <i key={i} className="h-[6vh] max-w-3 flex-1 rounded-full bg-gradient-to-b from-brand-light via-brand to-brand-light opacity-40" />
            ))}
          </div>
          <div ref={ringsRef} aria-hidden="true" className="absolute left-1/2 top-[46%] opacity-0">
            <i className="lp-ring" /><i className="lp-ring" /><i className="lp-ring" />
          </div>
          <div ref={crestRef} aria-hidden="true" className="absolute left-1/2 top-[44%] w-[min(380px,60vw)] -translate-x-1/2 -translate-y-1/2 will-change-transform">
            <img src="/ranks/challenger.svg" alt="" className="w-full drop-shadow-[0_0_48px_rgb(34_197_94_/_0.45)]" />
          </div>
          <ul aria-hidden="true" className="absolute inset-x-0 bottom-[16%] flex justify-center gap-[clamp(6px,1.6vw,22px)]">
            {RANK_TIER_ORDER.map((tier, i) => (
              <li key={tier} className={cn('transition-[opacity,scale] duration-500 ease-[cubic-bezier(.34,1.56,.64,1)]', i < lit ? 'scale-100 opacity-100' : 'scale-75 opacity-25')}>
                <img src={`/ranks/${tier}.svg`} alt="" className="h-[clamp(22px,4vw,48px)] w-[clamp(22px,4vw,48px)]" loading="lazy" />
              </li>
            ))}
          </ul>
        </div>
        <div ref={topRef} aria-hidden="true" className="lp-half top">
          {Array.from({ length: SHADE_LAYERS }, (_, i) => <div key={i} className="lp-shade" />)}
          <div className="lp-edge" />
          <Poster />
        </div>
        <div ref={bottomRef} aria-hidden="true" className="lp-half bottom">
          <div className="lp-edge" />
          <Poster />
        </div>
        <svg ref={crackSvgRef} aria-hidden="true" className="pointer-events-none absolute -inset-[12%] h-[124%] w-[124%] overflow-visible [filter:drop-shadow(0_0_6px_rgb(34_197_94_/_0.8))]" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polyline ref={crackRef} pathLength={1} strokeDasharray={1} strokeDashoffset={1} className="fill-none stroke-brand [stroke-linecap:round] [stroke-linejoin:round]" strokeWidth={3.5} vectorEffect="non-scaling-stroke" />
        </svg>
        <p ref={noteRef} className="pointer-events-none absolute bottom-[7%] left-1/2 z-[3] m-0 whitespace-nowrap rounded-full border border-border-strong bg-bg-raised px-6 py-3 font-display text-[clamp(14px,1.6vw,20px)] font-semibold opacity-0 shadow-card-hover">
          Quando o elo trava, o EloPeak aparece.
        </p>
        <p ref={hintRef} aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-7 m-0 text-center font-mono text-[11px] uppercase tracking-[0.3em] text-ink-muted">
          Role para abrir
        </p>
      </div>
    </section>
  )
}
