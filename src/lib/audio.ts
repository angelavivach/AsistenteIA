/**
 * A single shared microphone stream plus an analyser, so the reactor can pulse
 * with the user's voice. Opening the mic more than once causes Chrome to drop
 * the earlier stream, so everything that needs audio goes through here.
 */

let stream: MediaStream | null = null
let ctx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let buf: Uint8Array | null = null

/**
 * One AudioContext for listening, created inside the INICIAR click.
 *
 * Chrome only lets an AudioContext start running during a user gesture, and
 * that permission lapses after a few seconds. The boot sequence is longer than
 * that, so a context created when it finishes starts out suspended — the mic is
 * open but nothing is analysed, and ODIN does not hear "Odín" until some key
 * press happens to wake it. Creating it in the click avoids all of that.
 */
let shared: AudioContext | null = null

/** Call synchronously from the click handler, before any await. */
export function primeAudio(): void {
  if (shared && shared.state !== 'closed') {
    void shared.resume()
    return
  }
  shared = new AudioContext()
  void shared.resume()
}

/** The primed context, kept running: if anything suspends it, the next touch or key resumes it. */
export function listeningContext(): AudioContext {
  if (!shared || shared.state === 'closed') shared = new AudioContext()
  const c = shared
  if (c.state !== 'running') {
    const wake = () => void c.resume()
    window.addEventListener('pointerdown', wake, { once: true })
    window.addEventListener('keydown', wake, { once: true })
    void c.resume()
  }
  return c
}

export async function getMic(): Promise<MediaStream> {
  if (stream) return stream
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
      // Chrome's voice isolation, where the platform provides it: keeps the
      // speaking voice and strips music and background noise. Ignored by
      // browsers that do not know it, so it costs nothing to ask.
      voiceIsolation: true,
    } as MediaTrackConstraints,
  })
  return stream
}

export async function startAnalyser(): Promise<void> {
  if (analyser) return
  const s = await getMic()
  ctx = listeningContext()
  const src = ctx.createMediaStreamSource(s)
  analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  analyser.smoothingTimeConstant = 0.75
  src.connect(analyser)
  buf = new Uint8Array(analyser.frequencyBinCount)
}

/** 0..1 loudness. Returns 0 before the analyser is up. */
export function micLevel(): number {
  if (!analyser || !buf) return 0
  analyser.getByteFrequencyData(buf as Uint8Array<ArrayBuffer>)
  let sum = 0
  // Skip the lowest bins — they're mostly rumble and mains hum.
  for (let i = 4; i < buf.length; i++) sum += buf[i]
  const avg = sum / (buf.length - 4) / 255
  // Voice sits low in this range; stretch it so the visuals actually move.
  return Math.min(1, avg * 3.2)
}

/** Analyser fed from an <audio> element, so the orb reacts while JARVIS talks. */
export function attachOutputAnalyser(el: HTMLAudioElement): () => number {
  const c = new AudioContext()
  const src = c.createMediaElementSource(el)
  const a = c.createAnalyser()
  a.fftSize = 512
  a.smoothingTimeConstant = 0.7
  src.connect(a)
  a.connect(c.destination)
  const b = new Uint8Array(a.frequencyBinCount)
  return () => {
    a.getByteFrequencyData(b as Uint8Array<ArrayBuffer>)
    let sum = 0
    for (let i = 2; i < b.length; i++) sum += b[i]
    return Math.min(1, sum / (b.length - 2) / 255 * 3)
  }
}

// Dev-only probe: the state of the listening context, for checking the boot
// hand-off from the console (`__odinAudio()`).
if (import.meta.env.DEV) {
  ;(window as unknown as { __odinAudio: () => string }).__odinAudio = () =>
    shared ? `${shared.state} · ${shared.currentTime.toFixed(1)}s` : 'none'
}
