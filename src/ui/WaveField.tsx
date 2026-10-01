import { useEffect, useRef } from 'react'

/**
 * Two ribbons of dots drifting through the corners of the start screen — one
 * sweeping down from the top-left, one rising into the bottom-right — shaded
 * violet → pink → orange along their length.
 *
 * Plain canvas 2D rather than the WebGL scene: the scene sits behind the start
 * gate and is not running its full pipeline yet, and a few thousand dots a
 * frame is nothing for 2D. Each ribbon is a grid of points on a sheet that
 * curls with a couple of sine waves; perspective is faked by shrinking and
 * dimming the rows further back.
 */

type Ribbon = {
  /** Centreline as a quadratic curve: start, control, end — fractions of the viewport. */
  p0: [number, number]
  c: [number, number]
  p1: [number, number]
  phase: number
}

/** Each ribbon hugs a corner; its depth spreads outward, away from the title. */
const RIBBONS: Ribbon[] = [
  { p0: [-0.12, 0.78], c: [0.12, 0.12], p1: [0.78, -0.12], phase: 0 },
  { p0: [0.22, 1.12], c: [0.88, 0.9], p1: [1.12, 0.22], phase: 2.1 },
]

const COLS = 170
const ROWS = 34

/** violet → pink → orange → pink, by position along the ribbon. */
function shade(t: number, a: number): string {
  const stops = [
    [110, 70, 255],
    [190, 60, 255],
    [255, 70, 170],
    [255, 140, 80],
    [230, 70, 200],
  ]
  const f = Math.min(0.999, Math.max(0, t)) * (stops.length - 1)
  const i = Math.floor(f)
  const k = f - i
  const c = stops[i].map((v, j) => Math.round(v + (stops[i + 1][j] - v) * k))
  return `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`
}

export function WaveField() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let w = 0
    let h = 0
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    let raf = 0
    const start = performance.now()
    const draw = (now: number) => {
      const t = (now - start) / 1000
      ctx.clearRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'
      const span = Math.hypot(w, h)

      const cx = w / 2
      const cy = h / 2
      for (const r of RIBBONS) {
        const P0x = r.p0[0] * w, P0y = r.p0[1] * h
        const Cx = r.c[0] * w, Cy = r.c[1] * h
        const P1x = r.p1[0] * w, P1y = r.p1[1] * h
        const depth = span * 0.17

        for (let j = 0; j < ROWS; j++) {
          const v = j / (ROWS - 1) // 0 = edge nearest the title, 1 = deep in the corner
          const persp = 1 - v * 0.5
          for (let i = 0; i < COLS; i++) {
            const u = i / (COLS - 1)
            const iu = 1 - u
            // Point and tangent on the curved centreline.
            const bx = iu * iu * P0x + 2 * iu * u * Cx + u * u * P1x
            const by = iu * iu * P0y + 2 * iu * u * Cy + u * u * P1y
            const tx = 2 * iu * (Cx - P0x) + 2 * u * (P1x - Cx)
            const ty = 2 * iu * (Cy - P0y) + 2 * u * (P1y - Cy)
            const tl = Math.hypot(tx, ty) || 1
            let nx = -ty / tl
            let ny = tx / tl
            // Point the normal away from the centre of the screen.
            if (nx * (bx - cx) + ny * (by - cy) < 0) {
              nx = -nx
              ny = -ny
            }
            // The curl: a long swell plus a shorter ripple, both drifting.
            const lift =
              Math.sin(u * 4.4 + t * 0.32 + r.phase + v * 2.2) * 0.6 +
              Math.sin(u * 9.5 - t * 0.45 + v * 3.4 + r.phase) * 0.22
            const off = v * depth + lift * span * 0.07 * (0.35 + v)
            const x = bx + nx * off
            const y = by + ny * off
            if (x < -10 || y < -10 || x > w + 10 || y > h + 10) continue

            // Crests catch the light; both ends and both edges fade out softly.
            const crest = Math.max(0, lift) * 0.7
            const ends = Math.pow(Math.sin(Math.PI * u), 0.8)
            const edges = Math.sin(Math.PI * Math.min(1, v * 1.15 + 0.04))
            const a = Math.min(1, (0.3 + crest * 1.6) * ends * edges * persp * 2.2)
            if (a < 0.02) continue
            ctx.fillStyle = shade(u * 0.85 + lift * 0.12, a)
            const sz = 1.8 * persp + crest * 1.4
            ctx.fillRect(x, y, sz, sz)
          }
        }
      }
      if (!reduced) raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={ref} className="wavefield" aria-hidden="true" />
}
