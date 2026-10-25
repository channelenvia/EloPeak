import { useEffect, useRef, type MutableRefObject } from 'react'

interface DotFieldProps {
  /** Alcance da onda como fração do maior lado; a cena do hero escreve aqui. */
  reachRef: MutableRefObject<number>
  className?: string
}

const GAP = 14
// Período comum das duas ondas: 2π / 0.8.
const PERIOD = (Math.PI * 2) / 0.8
const BASE_ALPHA = 0.55

const VERTEX = `
attribute vec3 a; uniform vec2 res; uniform float t, reach, dpr, motion;
varying float vr, va, vs, vk;
void main() {
  float k = 1.0 - a.z / reach;
  if (k <= 0.0) { gl_Position = vec4(2.0, 2.0, 0.0, 1.0); gl_PointSize = 0.0; return; }
  float wave = motion * (sin(a.z / 38.0 - t * 1.6) * 0.5 + 0.5);
  float sway = motion * sin(a.x / 46.0 - t * 2.4 + a.y / 120.0) * k * 7.0;
  float r = 0.6 + k * (2.2 + wave * 1.4);
  vec2 pos = vec2(a.x, a.y + sway) / res * 2.0 - 1.0;
  gl_Position = vec4(pos.x, -pos.y, 0.0, 1.0);
  vs = (2.0 * r + 2.0) * dpr; vr = r * dpr; va = 0.35 + k * 0.65; vk = k;
  gl_PointSize = vs;
}`

const FRAGMENT = `
precision mediump float; uniform vec3 base, brand; varying float vr, va, vs, vk;
void main() {
  float d = length((gl_PointCoord - 0.5) * vs);
  float a = clamp(vr - d + 0.5, 0.0, 1.0) * va * ${BASE_ALPHA.toFixed(2)};
  vec3 c = mix(base, brand, vk * vk);
  gl_FragColor = vec4(c * a, a);
}`

type Rgb = [number, number, number]

// Os tokens do tema são trios "R G B" (ver globals.css).
function readToken(name: string, fallback: Rgb): Rgb {
  const parts = getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).map(Number)
  return parts.length === 3 && parts.every(Number.isFinite) ? [parts[0], parts[1], parts[2]] : fallback
}

interface Renderer {
  resize: () => void
  draw: (now: number) => void
}

function buildGrid(w: number, h: number) {
  const cx = w / 2
  const cy = h * 1.02
  const out: number[] = []
  for (let y = GAP / 2; y < h; y += GAP) {
    for (let x = GAP / 2; x < w; x += GAP) out.push(x, y, Math.hypot(x - cx, (y - cy) * 1.4))
  }
  return new Float32Array(out)
}

function createWebglRenderer(canvas: HTMLCanvasElement, reachRef: MutableRefObject<number>, still: boolean): Renderer | null {
  const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: true, alpha: true })
  if (!gl) return null
  const compile = (type: number, src: string) => {
    const shader = gl.createShader(type)
    if (!shader) throw new Error('createShader falhou')
    gl.shaderSource(shader, src)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader')
    return shader
  }
  const program = gl.createProgram()
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX))
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link')
  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  const loc = gl.getAttribLocation(program, 'a')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0)
  const u = Object.fromEntries(['res', 't', 'reach', 'dpr', 'motion', 'base', 'brand'].map((n) => [n, gl.getUniformLocation(program, n)]))
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

  const t0 = performance.now()
  let w = 0, h = 0, dpr = 1, count = 0
  const base = readToken('--color-ink-muted', [135, 139, 146]).map((v) => v / 255)
  const brand = readToken('--color-brand', [34, 197, 94]).map((v) => v / 255)
  return {
    resize() {
      dpr = Math.min(2, devicePixelRatio || 1)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      gl.viewport(0, 0, canvas.width, canvas.height)
      const grid = buildGrid(w, h)
      count = grid.length / 3
      gl.bufferData(gl.ARRAY_BUFFER, grid, gl.STATIC_DRAW)
    },
    draw(now) {
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.uniform2f(u.res, w, h)
      gl.uniform1f(u.t, ((now - t0) / 1000) % PERIOD)
      gl.uniform1f(u.reach, Math.max(w, h) * reachRef.current)
      gl.uniform1f(u.dpr, dpr)
      gl.uniform1f(u.motion, still ? 0 : 1)
      gl.uniform3f(u.base, base[0], base[1], base[2])
      gl.uniform3f(u.brand, brand[0], brand[1], brand[2])
      gl.drawArrays(gl.POINTS, 0, count)
    },
  }
}

function createCanvas2dRenderer(canvas: HTMLCanvasElement, reachRef: MutableRefObject<number>, still: boolean): Renderer {
  const ctx = canvas.getContext('2d')
  const t0 = performance.now()
  let w = 0, h = 0, dpr = 1
  let grid: Float32Array = new Float32Array(0)
  const base = readToken('--color-ink-muted', [135, 139, 146])
  const brand = readToken('--color-brand', [34, 197, 94])
  return {
    resize() {
      dpr = Math.min(2, devicePixelRatio || 1)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      grid = buildGrid(w, h)
    },
    draw(now) {
      if (!ctx) return
      const t = (now - t0) / 1000
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const reach = Math.max(w, h) * reachRef.current
      for (let i = 0; i < grid.length; i += 3) {
        const x = grid[i], y = grid[i + 1], d = grid[i + 2]
        const k = 1 - d / reach
        if (k <= 0) continue
        const wave = still ? 0 : Math.sin(d / 38 - t * 1.6) * 0.5 + 0.5
        const sway = still ? 0 : Math.sin(x / 46 - t * 2.4 + y / 120) * k * 7
        const m = k * k
        const rgb = base.map((v, c) => Math.round(v + (brand[c] - v) * m))
        ctx.fillStyle = `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`
        ctx.globalAlpha = (0.35 + k * 0.65) * BASE_ALPHA
        ctx.beginPath()
        ctx.arc(x, y + sway, 0.6 + k * (2.2 + wave * 1.4), 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    },
  }
}

/** Campo de pontos que cresce perto do emblema e ondula como som saindo dele. */
export function DotField({ reachRef, className }: DotFieldProps) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    // Qualquer falha no WebGL (sem suporte, shader recusado) cai no canvas 2D,
    // num canvas novo -- um contexto já criado não troca de tipo.
    const mount = (): { canvas: HTMLCanvasElement; renderer: Renderer } => {
      const canvas = document.createElement('canvas')
      canvas.className = 'h-full w-full'
      host.replaceChildren(canvas)
      try {
        const renderer = createWebglRenderer(canvas, reachRef, still)
        if (renderer) return { canvas, renderer }
      } catch {
        // cai para o 2D abaixo
      }
      const fallback = document.createElement('canvas')
      fallback.className = 'h-full w-full'
      host.replaceChildren(fallback)
      return { canvas: fallback, renderer: createCanvas2dRenderer(fallback, reachRef, still) }
    }
    const { canvas, renderer } = mount()
    renderer.resize()

    let visible = true
    let frame = 0
    const loop = (now: number) => {
      renderer.draw(now)
      frame = visible && !still ? requestAnimationFrame(loop) : 0
    }
    const wake = () => { if (!frame) frame = requestAnimationFrame(loop) }
    wake()

    const onResize = () => { renderer.resize(); if (still) renderer.draw(performance.now()) }
    addEventListener('resize', onResize)
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      if (visible) wake()
    })
    io.observe(canvas)
    return () => {
      cancelAnimationFrame(frame)
      removeEventListener('resize', onResize)
      io.disconnect()
      host.replaceChildren()
    }
  }, [reachRef])

  return <div ref={hostRef} aria-hidden="true" className={className} />
}
