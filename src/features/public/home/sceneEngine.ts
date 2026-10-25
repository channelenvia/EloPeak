import Lenis from 'lenis'
import { clamp } from './math'

export type SceneFn = (time: number) => void

interface Geometry { top: number; height: number }

const SMOOTH_LERP = 0.1
const SCROLL_DURATION_S = 1.4

/**
 * Um único laço por quadro para todas as cenas presas à rolagem. A posição de
 * cada seção fica em cache: ler o retângulo a cada quadro, entre escritas de
 * estilo, forçaria o navegador a refazer o layout. O cache cai quando algo
 * muda de tamanho (resize, fontes, conteúdo assíncrono).
 */
export class SceneEngine {
  private readonly scenes = new Set<SceneFn>()
  private readonly geometry = new Map<Element, Geometry>()
  private lenis: Lenis | null = null
  private observer: ResizeObserver | null = null
  private frame = 0
  private readonly clearGeometry = () => this.geometry.clear()

  /** Quem pediu menos movimento: sem Lenis, sem laço; cenas ficam no estado final. */
  constructor(readonly still: boolean) {}

  start(): void {
    if (this.still || this.frame) return
    this.lenis = new Lenis({ lerp: SMOOTH_LERP })
    this.observer = new ResizeObserver(this.clearGeometry)
    this.observer.observe(document.body)
    addEventListener('resize', this.clearGeometry)
    const loop = (time: number) => {
      this.lenis?.raf(time)
      for (const scene of this.scenes) scene(time)
      this.frame = requestAnimationFrame(loop)
    }
    this.frame = requestAnimationFrame(loop)
  }

  stop(): void {
    cancelAnimationFrame(this.frame)
    this.frame = 0
    this.lenis?.destroy()
    this.lenis = null
    this.observer?.disconnect()
    this.observer = null
    removeEventListener('resize', this.clearGeometry)
    this.geometry.clear()
  }

  register(scene: SceneFn): () => void {
    this.scenes.add(scene)
    return () => { this.scenes.delete(scene) }
  }

  rect(el: Element): { top: number; height: number; bottom: number } {
    let g = this.geometry.get(el)
    if (!g) {
      const r = el.getBoundingClientRect()
      g = { top: r.top + scrollY, height: r.height }
      this.geometry.set(el, g)
    }
    const top = g.top - scrollY
    return { top, height: g.height, bottom: top + g.height }
  }

  /** 0 quando o stage gruda (topo da seção em `stick`), 1 quando a seção acaba. */
  pinned(el: Element, stick = 0): number {
    const { top, height } = this.rect(el)
    return clamp((stick - top) / (height - (innerHeight - stick) || 1))
  }

  near(el: Element): boolean {
    const { top, bottom } = this.rect(el)
    return bottom > -innerHeight * 0.5 && top < innerHeight * 1.5
  }

  /** Rola até o progresso `p` (0..1) de uma seção fixada. */
  scrollToProgress(el: Element, p: number, stick = 0): void {
    const { height } = this.rect(el)
    const top = el.getBoundingClientRect().top + scrollY
    const y = top - stick + (height - (innerHeight - stick)) * clamp(p)
    if (this.lenis) this.lenis.scrollTo(y, { duration: SCROLL_DURATION_S })
    else scrollTo({ top: y, behavior: 'auto' })
  }
}
