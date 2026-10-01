import { useStore } from '../store'
import { WaveField } from './WaveField'

/**
 * The start gate.
 *
 * Browsers refuse to play audio or start speech synthesis until the user has
 * interacted with the page, so something has to be clicked before JARVIS can
 * make a sound. Rather than hide that behind a permissions banner, it's the
 * cold open: a dead interface waiting to be switched on.
 *
 * Deliberately NOT wrapped in AnimatePresence, and the reason is worth keeping.
 *
 * It used to be, for the sake of a blur-and-fade on the way out, and the exit
 * never completed — the node reached opacity 0 and then stayed in the DOM for
 * the rest of the session. Which would be a cosmetic non-event, except this is
 * a `position: fixed; inset: 0` button: invisible, unremovable, and the topmost
 * hit-testable thing under every single point on the screen.
 *
 * Everything that aims by hit-testing died on it. Hand control resolves its
 * target with elementFromPoint, so every pinch — focus, grab, drag, close —
 * landed on an invisible button instead of a blade, silently, with no error and
 * nothing on screen to suggest why. It cost an entire evening of looking at the
 * gesture code, which was fine.
 *
 * Two attempted fixes failed and are worth recording so nobody re-attempts
 * them. Giving the child a `key` did not make the exit complete. Adding a
 * phase-dependent `pointerEvents` did not help either, because AnimatePresence
 * renders an exiting child from a frozen snapshot of its last props — inside
 * that copy the phase is forever 'offline', so a guard written in terms of it
 * can never fire.
 *
 * A plain conditional cannot strand anything. The fade-in survives because
 * mounting is not the dangerous direction; the fade-out is gone, and the boot
 * sequence takes the screen immediately anyway, so there is nothing to see.
 */
export function Ignition({ onStart }: { onStart: () => void }) {
  const phase = useStore((s) => s.phase)
  if (phase !== 'offline') return null

  return (
    <button className="ignition" onClick={onStart} aria-label="Iniciar Odín">
      <WaveField />

      {/* The liquid wobble on the title and the smoke under it. */}
      <svg className="ignition-defs" aria-hidden="true">
        <filter id="odin-liquid" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.006 0.012" numOctaves="1" seed="3">
            <animate attributeName="baseFrequency" dur="14s" repeatCount="indefinite"
              values="0.006 0.012;0.009 0.016;0.006 0.012" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" scale="3" />
        </filter>
        <filter id="odin-smoke" x="-30%" y="-10%" width="160%" height="260%">
          <feTurbulence type="fractalNoise" baseFrequency="0.045 0.007" numOctaves="3" seed="8">
            <animate attributeName="seed" dur="9s" values="8;14;8" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" scale="80" />
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </svg>

      <span className="ignition-label">
        <span className="ignition-title" data-text="ODÍN">
          <span className="ignition-smoke" aria-hidden="true">ODÍN</span>
          <span className="ignition-chrome">ODÍN</span>
        </span>
        <span className="ignition-word">INICIAR</span>
        <span className="ignition-ring" />
      </span>
    </button>
  )
}
