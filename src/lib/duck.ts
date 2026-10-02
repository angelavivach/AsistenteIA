import { BRIDGE_HTTP_URL } from '../config'
import { useStore, type Phase } from '../store'

/**
 * Lowers Spotify while ODIN is awake and brings it back when he goes quiet, so
 * the microphone hears the user instead of the song. The bridge does the work
 * (it holds the Spotify login); this only tells it when.
 *
 * The restore waits a moment, so the gap between "listening" and "speaking"
 * inside one conversation does not pump the volume up and down.
 */
const AWAKE: Phase[] = ['waking', 'listening', 'thinking', 'tooling', 'speaking']
const RESTORE_AFTER_MS = 1500

let isDucked = false
let restoreTimer: ReturnType<typeof setTimeout> | null = null

function send(on: boolean) {
  isDucked = on
  void fetch(`${BRIDGE_HTTP_URL}/spotify/duck`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ on }),
  }).catch(() => {})
}

let started = false

export function startDucking() {
  if (started) return
  started = true
  useStore.subscribe((s, prev) => {
    if (s.phase === prev.phase) return
    const awake = AWAKE.includes(s.phase)
    if (awake) {
      if (restoreTimer) clearTimeout(restoreTimer)
      restoreTimer = null
      if (!isDucked) send(true)
    } else if (isDucked && !restoreTimer) {
      restoreTimer = setTimeout(() => {
        restoreTimer = null
        if (!AWAKE.includes(useStore.getState().phase)) send(false)
      }, RESTORE_AFTER_MS)
    }
  })
}
