import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useStore } from '../store'

/**
 * The start-up sequence, in the register of Blade Runner 2049: black, a warm
 * amber haze, hairlines, thin wide type and a lot of empty frame.
 *
 * Four beats, in order:
 *   1. haze — amber fog rises from the floor while a single horizon line draws
 *      outward from the centre; tiny telemetry sits in the four corners;
 *   2. name — "ODIN" resolves out of blur one letter at a time;
 *   3. check — three systems report in, right-aligned on hairline rules;
 *   4. sun — a blurred disc rises behind the horizon and the frame brightens,
 *      which is the hand-off into the live scene behind it.
 *
 * One full-frame overlay driven by a small stage clock, so the timing is
 * legible in one place. Everything is CSS and SVG — nothing to load late.
 */

/** Stage boundaries in milliseconds from power-on. App owns the hand-off
 *  (9.2 s); this is only for pacing. */
const T = { name: 2600, check: 5200, sun: 7200 }

const CHECKS = [
  ['VOZ', 'ENLAZADA'],
  ['CALENDARIO', 'ENLAZADO'],
  ['NÚCLEO', 'ESTABLE'],
]

type Stage = 'haze' | 'name' | 'check' | 'sun'

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

export function Boot() {
  const phase = useStore((s) => s.phase)
  const reduced = !!useReducedMotion()
  const [t, setT] = useState(0)

  // A single clock: elapsed milliseconds since the boot phase began.
  //
  // Driven by setInterval over wall-clock time, NOT requestAnimationFrame —
  // rAF is throttled to a crawl (and paused outright) whenever the tab is not
  // the focused one, which froze the sequence on its first beat.
  useEffect(() => {
    if (phase !== 'boot') {
      setT(0)
      return
    }
    const start = Date.now()
    setT(0)
    const id = setInterval(() => setT(Date.now() - start), 50)
    return () => clearInterval(id)
  }, [phase])

  if (phase !== 'boot') return null

  const stage: Stage =
    t >= T.sun ? 'sun' : t >= T.check ? 'check' : t >= T.name ? 'name' : 'haze'

  const now = new Date()
  const stamp = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}  ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  const pct = Math.min(100, Math.round((t / 9000) * 100))
  const sector = (0x3f2a + Math.floor(t / 37)).toString(16).toUpperCase()

  return (
    <AnimatePresence>
      <motion.div
        className="boot br"
        data-stage={stage}
        data-reduced={reduced ? '1' : '0'}
        initial={{ opacity: 1 }}
        exit={{ opacity: 0, filter: 'blur(14px) brightness(1.6)' }}
        transition={{ duration: 1.1 }}
      >
        <div className="br-haze" />
        <div className="br-sun" />
        <div className="br-horizon" />

        {/* ---- telemetry, one line per corner ---- */}
        <div className="br-corner br-tl">ODIN&nbsp;&nbsp;/&nbsp;&nbsp;N-01</div>
        <div className="br-corner br-tr">{stamp}</div>
        <div className="br-corner br-bl">SECUENCIA DE ARRANQUE&nbsp;&nbsp;·&nbsp;&nbsp;0x{sector}</div>
        <div className="br-corner br-br">{pad(pct, 3)}</div>

        {/* ---- beat 2: the name ---- */}
        {stage !== 'haze' && (
          <div className="br-name-wrap">
            <h1 className="br-name" aria-label="ODÍN">
              {'ODÍN'.split('').map((ch, i) => (
                <motion.span
                  key={i}
                  initial={reduced ? { opacity: 1 } : { opacity: 0, filter: 'blur(12px)', y: 6 }}
                  animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
                  transition={{ duration: 1.1, delay: i * 0.22, ease: [0.2, 0.7, 0.2, 1] }}
                >
                  {ch}
                </motion.span>
              ))}
            </h1>
            <motion.div
              className="br-sub"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1.2, delay: reduced ? 0 : 1.1 }}
            >
              ASISTENTE PERSONAL
            </motion.div>
          </div>
        )}

        {/* ---- beat 3: systems reporting in ---- */}
        {(stage === 'check' || stage === 'sun') && (
          <div className="br-checks">
            {CHECKS.map(([k, v], i) => (
              <motion.div
                key={k}
                className="br-check"
                initial={reduced ? { opacity: 1 } : { opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.7, delay: i * 0.35 }}
              >
                <span>{k}</span>
                <span className="br-rule" />
                <span className="br-val">{v}</span>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
