import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Check } from 'lucide-react'
import { cn } from '@/lib/cn'
import { HEADER_HEIGHT, SERVICES } from './homeContent'
import { clamp, mapRange } from './math'
import { usePinnedScene, useSceneEngine } from './useScene'

// 0–OPEN a janela cresce de .46 até a tela toda e os títulos se afastam;
// OPEN–1 uma cena por serviço, cada uma num trecho de rolagem.
const OPEN = 0.24
const CAPTION_AT = 0.3
const START_SCALE = 0.46
const SCENE_COUNT = SERVICES.length

export function ServicesWindow() {
  const engine = useSceneEngine()
  const sectionRef = useRef<HTMLElement>(null)
  const windowRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const capRef = useRef<HTMLDivElement>(null)
  const hintRef = useRef<HTMLParagraphElement>(null)
  const leftRef = useRef<HTMLSpanElement>(null)
  const rightRef = useRef<HTMLSpanElement>(null)
  const [current, setCurrent] = useState(0)
  const lastCurrent = useRef(0)

  usePinnedScene(sectionRef, (p) => {
    const win = windowRef.current, inner = innerRef.current, cap = capRef.current
    const hint = hintRef.current, left = leftRef.current, right = rightRef.current
    if (!win || !inner || !cap || !hint || !left || !right) return
    win.style.transform = `scale(${mapRange(p, [0, OPEN * 0.3, OPEN], [START_SCALE, START_SCALE, 1]).toFixed(4)})`
    inner.style.opacity = String(mapRange(p, [OPEN * 0.45, OPEN * 0.9], [0, 1]))
    left.style.transform = `translateX(${mapRange(p, [0, OPEN], [0, -42])}vw)`
    right.style.transform = `translateX(${mapRange(p, [0, OPEN], [0, 42])}vw)`
    const titleOpacity = String(mapRange(p, [0, OPEN * 0.6, OPEN], [1, 0.9, 0]))
    left.style.opacity = titleOpacity
    right.style.opacity = titleOpacity
    hint.style.opacity = String(mapRange(p, [0, 0.05], [1, 0]))
    cap.style.opacity = String(mapRange(p, [CAPTION_AT - 0.04, CAPTION_AT], [0, 1]))
    cap.style.translate = `-50% ${mapRange(p, [CAPTION_AT - 0.04, CAPTION_AT], [30, 0])}px`
    cap.style.visibility = p > CAPTION_AT - 0.05 ? '' : 'hidden'
    const next = p < CAPTION_AT ? 0 : Math.min(SCENE_COUNT - 1, Math.floor(((p - CAPTION_AT) / (1 - CAPTION_AT)) * SCENE_COUNT))
    if (next !== lastCurrent.current) { lastCurrent.current = next; setCurrent(next) }
  }, { stick: HEADER_HEIGHT, stillProgress: 1 })

  const go = (i: number) => {
    const section = sectionRef.current
    if (!section) return
    const target = clamp(i, 0, SCENE_COUNT - 1)
    if (engine.still) { lastCurrent.current = target; setCurrent(target); return }
    engine.scrollToProgress(section, CAPTION_AT + ((target + 0.5) / SCENE_COUNT) * (1 - CAPTION_AT), HEADER_HEIGHT)
  }

  const service = SERVICES[current]
  const Icon = service.icon
  return (
    <section ref={sectionRef} aria-labelledby="services-h" className="relative h-[100svh] motion-safe:h-[520svh]">
      <div className="sticky overflow-hidden" style={{ top: HEADER_HEIGHT, height: `calc(100svh - ${HEADER_HEIGHT}px)` }}>
        <h2 id="services-h" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-between px-6 pb-[max(40px,9vh)] pt-[max(48px,8vh)] font-display text-[clamp(30px,5.2vw,76px)] font-black leading-[1.05] tracking-tight">
          <span ref={leftRef} className="block whitespace-nowrap rounded-[0.5em_0.5em_0.5em_0.16em] border border-border-strong bg-bg-raised px-[0.5em] pb-[0.2em] pt-[0.14em] will-change-transform">Do Ferro ao Challenger.</span>
          <span ref={rightRef} className="block whitespace-nowrap rounded-[0.5em_0.5em_0.16em_0.5em] bg-brand px-[0.5em] pb-[0.2em] pt-[0.14em] text-ink-inverse shadow-brand will-change-transform">Do jeito que você precisa.</span>
        </h2>

        <div ref={windowRef} className="absolute inset-2.5 z-[1] overflow-hidden rounded-[40px_40px_40px_14px] border border-border-strong bg-[radial-gradient(70%_60%_at_50%_45%,rgb(20_58_35),rgb(10_20_14)_70%)] shadow-[0_40px_80px_-40px_rgb(0_0_0_/_0.8)] will-change-transform max-sm:inset-1.5 max-sm:rounded-[28px_28px_28px_10px]">
          <div ref={innerRef} className="absolute inset-0 grid place-items-center px-[5vw] pb-36 pt-[6vh]">
            <article key={service.title} className="lp-swap grid w-full max-w-3xl gap-6 rounded-[32px_32px_32px_12px] border border-border-strong bg-bg-surface/90 p-[clamp(24px,4vw,48px)] shadow-card-hover backdrop-blur-md">
              <div className="flex items-center justify-between gap-4">
                <div className={cn('flex h-16 w-16 items-center justify-center rounded-2xl', service.color)}>
                  <Icon className="h-8 w-8" />
                </div>
                <span className="rounded-full border border-brand/25 bg-brand/15 px-3 py-1 text-xs font-bold text-brand">{service.badge}</span>
              </div>
              <h3 className="font-display text-[clamp(32px,4.4vw,56px)] font-black leading-none tracking-tight text-ink">{service.title}</h3>
              <p className="max-w-[44ch] text-base leading-relaxed text-ink-secondary sm:text-lg">{service.desc}</p>
              <ul className="flex flex-wrap gap-2">
                {service.points.map((point) => (
                  <li key={point} className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-raised px-3 py-1.5 text-sm font-semibold text-ink">
                    <Check className="h-4 w-4 text-brand" />{point}
                  </li>
                ))}
              </ul>
              <Link to={service.href} className="focus-ring inline-flex w-fit items-center gap-1.5 rounded-lg text-sm font-bold text-brand">
                Pedir agora <ChevronRight className="h-4 w-4" />
              </Link>
            </article>
          </div>
          <p ref={hintRef} aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-7 z-[3] m-0 text-center font-mono text-[11px] uppercase tracking-[0.3em] text-ink-muted">Role para abrir</p>
        </div>

        <div ref={capRef} className="absolute bottom-6 left-1/2 z-[4] flex w-[min(860px,calc(100%-24px))] items-center gap-4 rounded-[28px_28px_28px_10px] border border-border-strong bg-bg-raised/95 p-3 pl-3.5 opacity-0 shadow-card-hover backdrop-blur-md max-sm:bottom-4 max-sm:gap-2.5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-brand/15 font-display text-sm font-semibold tabular-nums text-brand">{String(current + 1).padStart(2, '0')}</span>
          <div className="min-w-0 flex-1" aria-live="polite">
            <b className="block font-display text-lg">{service.title}</b>
            <span className="line-clamp-2 text-sm leading-snug text-ink-secondary">{service.badge} · {service.points.join(' · ')}</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-bg-base px-3 py-2.5 max-sm:hidden" aria-hidden="true">
            {SERVICES.map((s, i) => (
              <i key={s.title} className={cn('h-[7px] rounded-full transition-[width,background-color] duration-[400ms] ease-[cubic-bezier(.23,1,.32,1)]', i === current ? 'w-6 bg-brand' : 'w-[7px] bg-ink-muted')} />
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" className="focus-ring grid h-10 w-10 place-items-center rounded-full border border-border-strong bg-bg-base text-ink disabled:opacity-40" aria-label="Serviço anterior" disabled={current === 0} onClick={() => go(current - 1)}><ChevronLeft className="h-5 w-5" /></button>
            <button type="button" className="focus-ring grid h-10 w-10 place-items-center rounded-full bg-brand text-ink-inverse shadow-brand disabled:opacity-40" aria-label="Próximo serviço" disabled={current === SCENE_COUNT - 1} onClick={() => go(current + 1)}><ChevronRight className="h-5 w-5" /></button>
          </div>
        </div>
      </div>
    </section>
  )
}
