// The end-of-session chime (spec §A4: "a gentle end-of-session chime").
//
// GENTLE IS THE SPEC, not a garnish: this thing interrupts someone who is writing. So it is a soft
// two-note bell (a rising fifth) on sine oscillators with a slow release — no square waves, no
// alarm, no repetition. It never fires more than once per phase change.
//
// WebAudio is created LAZILY, on the first chime — an AudioContext constructed at import time is
// blocked by autoplay policy anyway (no user gesture yet) and costs an audio thread for a feature
// that is off by default.

let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  if (ctx) return ctx
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
    return ctx
  } catch {
    return null // no audio device / blocked — silence is an acceptable degradation
  }
}

/** One soft bell note. */
function note(ac: AudioContext, freq: number, startAt: number, gain: number): void {
  const osc = ac.createOscillator()
  const amp = ac.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  // A quick-but-not-clicky attack and a long exponential release = a bell, not a beep.
  amp.gain.setValueAtTime(0.0001, startAt)
  amp.gain.exponentialRampToValueAtTime(gain, startAt + 0.02)
  amp.gain.exponentialRampToValueAtTime(0.0001, startAt + 1.6)
  osc.connect(amp).connect(ac.destination)
  osc.start(startAt)
  osc.stop(startAt + 1.7)
}

const MUTE_KEY = 'inkwave:ledgerChimeOff'

export function chimeMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

export function setChimeMuted(on: boolean): void {
  try {
    if (on) localStorage.setItem(MUTE_KEY, '1')
    else localStorage.removeItem(MUTE_KEY)
  } catch { /* private mode */ }
}

/**
 * Play the chime. `kind` only shapes the interval — work ending rises (C5→G5, "come back to it"),
 * a break ending settles (G4→C5). Never throws; silent when muted or unavailable.
 */
export function playChime(kind: 'work-end' | 'break-end' = 'work-end'): void {
  if (chimeMuted()) return
  const ac = audio()
  if (!ac) return
  try {
    // A tab that has been idle suspends the context; resume() is a no-op when already running.
    void ac.resume?.()
    const t = ac.currentTime + 0.02
    const [a, b] = kind === 'work-end' ? [523.25, 783.99] : [392.0, 523.25]
    note(ac, a, t, 0.12)
    note(ac, b, t + 0.18, 0.09)
  } catch { /* audio blocked — the visible phase change is still the real signal */ }
}
