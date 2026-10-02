/**
 * The alarm chime: three soft rising bell arpeggios, synthesised so there is no
 * file to load. About three seconds, and it resolves before ODIN speaks.
 */
export function playChime(): Promise<void> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return Promise.resolve()
  const ctx = new Ctx()
  const notes = [659.25, 830.61, 987.77] // E5, G#5, B5
  const start = ctx.currentTime + 0.05
  for (let round = 0; round < 3; round++) {
    notes.forEach((f, i) => {
      const t = start + round * 1.0 + i * 0.16
      for (const [mult, gain] of [[1, 0.22], [2.01, 0.06]] as const) {
        const osc = ctx.createOscillator()
        const g = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = f * mult
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(gain, t + 0.01)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1)
        osc.connect(g).connect(ctx.destination)
        osc.start(t)
        osc.stop(t + 1.2)
      }
    })
  }
  return new Promise((resolve) =>
    setTimeout(() => {
      void ctx.close()
      resolve()
    }, 3300),
  )
}
