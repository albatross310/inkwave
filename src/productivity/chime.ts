// The end-of-session chime (spec §A4: "a gentle end-of-session chime") — now customisable, with
// previews (Peter, 2026-07-17).
//
// GENTLE IS THE SPEC, not a garnish: this interrupts someone who is writing. Every voice here is
// built from sine partials with a slow exponential release — a struck resonant object, not an
// alarm. There is no sawtooth, no square, no repetition, and nothing plays twice per phase.
//
// WHY SYNTHESISED AND NOT AUDIO FILES: five chimes as assets would be ~hundreds of KB fetched on a
// writing app's load path for a feature that is off by default. These are a few hundred bytes of
// maths, built lazily on first sound.
//
// iOS: an AudioContext starts SUSPENDED until a user gesture. Previews are played from a tap, which
// is exactly the gesture that unlocks it — so previewing a chime also arms the real one. `resume()`
// is called on every play because a backgrounded tab re-suspends the context.

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

/** One partial of a struck note: a frequency ratio, its share of the gain, and how long it rings. */
interface Partial {
  ratio: number
  gain: number
  decay: number
}

export interface ChimeVoice {
  id: string
  /** Shown in the picker. */
  label: string
  /** One line saying what it feels like — the picker is a choice, not a list of ids. */
  hint: string
  /** Root frequencies for the two struck notes (work-end rises, break-end settles). */
  notes: { work: [number, number]; rest: [number, number] }
  partials: Partial[]
  /** Seconds between the two notes. */
  spacing: number
  /** Overall level — each voice is trimmed to feel equally quiet. */
  level: number
}

/**
 * The palette. Deliberately small and deliberately calm: five ways to be told the time is up, none
 * of them urgent. A writer picks the one that doesn't break their concentration, which is the whole
 * point of letting them pick.
 */
export const CHIME_VOICES: ChimeVoice[] = [
  {
    id: 'bell',
    label: 'Bell',
    hint: 'a soft two-note bell',
    notes: { work: [523.25, 783.99], rest: [392.0, 523.25] },
    partials: [{ ratio: 1, gain: 1, decay: 1.6 }, { ratio: 2.01, gain: 0.18, decay: 1.1 }],
    spacing: 0.18,
    level: 0.12,
  },
  {
    id: 'bowl',
    label: 'Singing bowl',
    hint: 'low, long, and slow to fade',
    notes: { work: [261.63, 392.0], rest: [196.0, 261.63] },
    // Inharmonic partials + long decays = struck metal that keeps ringing.
    partials: [{ ratio: 1, gain: 1, decay: 3.4 }, { ratio: 2.7, gain: 0.22, decay: 2.6 }, { ratio: 5.4, gain: 0.08, decay: 1.8 }],
    spacing: 0.5,
    level: 0.14,
  },
  {
    id: 'glass',
    label: 'Glass',
    hint: 'bright and brief',
    notes: { work: [1046.5, 1567.98], rest: [783.99, 1046.5] },
    partials: [{ ratio: 1, gain: 1, decay: 0.9 }, { ratio: 3.0, gain: 0.1, decay: 0.5 }],
    spacing: 0.12,
    level: 0.08,
  },
  {
    id: 'wood',
    label: 'Wood',
    hint: 'a dry, quiet knock',
    notes: { work: [440.0, 587.33], rest: [349.23, 440.0] },
    // Almost no ring: a short fundamental with a knock of upper partial.
    partials: [{ ratio: 1, gain: 1, decay: 0.35 }, { ratio: 4.2, gain: 0.12, decay: 0.12 }],
    spacing: 0.14,
    level: 0.16,
  },
  {
    id: 'harp',
    label: 'Harp',
    hint: 'a rising third, plucked',
    notes: { work: [440.0, 659.25], rest: [329.63, 440.0] },
    partials: [{ ratio: 1, gain: 1, decay: 2.0 }, { ratio: 2, gain: 0.3, decay: 1.2 }, { ratio: 3, gain: 0.12, decay: 0.8 }],
    spacing: 0.22,
    level: 0.1,
  },
]

const VOICE_KEY = 'inkwave:ledgerChime'
const MUTE_KEY = 'inkwave:ledgerChimeOff'

export const DEFAULT_VOICE_ID = 'bell'

export function chimeVoiceId(): string {
  try {
    const id = localStorage.getItem(VOICE_KEY)
    return id && CHIME_VOICES.some((v) => v.id === id) ? id : DEFAULT_VOICE_ID
  } catch {
    return DEFAULT_VOICE_ID
  }
}

export function setChimeVoiceId(id: string): void {
  try {
    if (CHIME_VOICES.some((v) => v.id === id)) localStorage.setItem(VOICE_KEY, id)
  } catch { /* private mode */ }
}

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

/** Strike one note: every partial of it, at `startAt`. */
function strike(ac: AudioContext, voice: ChimeVoice, freq: number, startAt: number, level: number): void {
  for (const p of voice.partials) {
    const osc = ac.createOscillator()
    const amp = ac.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq * p.ratio
    const peak = Math.max(0.0002, level * p.gain)
    // A quick-but-not-clicky attack and an exponential release = struck, not switched on.
    amp.gain.setValueAtTime(0.0001, startAt)
    amp.gain.exponentialRampToValueAtTime(peak, startAt + 0.02)
    amp.gain.exponentialRampToValueAtTime(0.0001, startAt + p.decay)
    osc.connect(amp).connect(ac.destination)
    osc.start(startAt)
    osc.stop(startAt + p.decay + 0.1)
  }
}

function playVoice(voice: ChimeVoice, kind: 'work-end' | 'break-end'): void {
  const ac = audio()
  if (!ac) return
  try {
    void ac.resume?.() // a tab that has been idle suspends the context; no-op when running
    const t = ac.currentTime + 0.02
    const [a, b] = kind === 'work-end' ? voice.notes.work : voice.notes.rest
    strike(ac, voice, a, t, voice.level)
    strike(ac, voice, b, t + voice.spacing, voice.level * 0.75)
  } catch { /* audio blocked — the visible phase change is still the real signal */ }
}

/**
 * Play the writer's chosen chime. `kind` shapes the interval: work ending RISES ("come back to it"),
 * a break ending SETTLES. Silent when muted; never throws.
 */
export function playChime(kind: 'work-end' | 'break-end' = 'work-end'): void {
  if (chimeMuted()) return
  const voice = CHIME_VOICES.find((v) => v.id === chimeVoiceId()) ?? CHIME_VOICES[0]
  playVoice(voice, kind)
}

/**
 * Preview a voice from a tap — ignores the mute (you are asking to hear it) and, on iOS, the tap
 * that triggers this is what unlocks audio for the real chime later.
 */
export function previewChime(id: string): void {
  const voice = CHIME_VOICES.find((v) => v.id === id)
  if (voice) playVoice(voice, 'work-end')
}
