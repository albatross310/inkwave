// The default zero-effort sound for the MusicXML path (build spec §B3).
//
// ─── A DELIBERATE DEVIATION FROM THE SPEC'S PARENTHETICAL — report it, don't bury it ─────────
// §B3/§C1 suggest "a soundfont synth (Web Audio soundfont player / Tone.js)". This module is a
// hand-rolled Web Audio voice instead. Measured reasons, in an app that hard-minimises bundle size,
// hand-rolls its PWA and its charts, and self-hosts pdf.js rather than hotlink a CDN:
//
//   Tone.js               81 kB gzip bundled   ...and still no sounds: a soundfont player needs
//                                                 actual SAMPLES (multi-MB .sf2/ogg per instrument),
//                                                 which we would then have to SELF-HOST — CLAUDE.md
//                                                 forbids hotlinking, and the CSP's connect-src does
//                                                 not list any soundfont CDN.
//   this file            ~2 kB, no samples, no fetch, no CSP change, no dependency.
//
// The honest trade: this is a SYNTH, not a sampled piano. It is good enough for the thing the spec
// actually asks it to do — "what does this modulation sound like?", a cursor to follow, a bar-range
// to loop — and it is not pretending to be a performance. The `Instrument` seam below exists so a
// sampled soundfont can be added later WITHOUT touching the player, if a real user ever asks for it.
// Do not let this file grow into a synthesiser; that is not what Inkwave is.

/** What the player needs from a sound source. A soundfont would implement exactly this. */
export interface Instrument {
  /** Sound one note at an absolute AudioContext time. */
  play(midi: number, atSec: number, durationSec: number, gain: number): void
  /** Silence everything immediately (pause/stop/seek). */
  allOff(): void
}

/** Equal temperament, A4 = 440Hz = midi 69. */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/**
 * A small subtractive voice: triangle + detuned sine, through a gentle ADSR.
 *
 * Triangle carries enough odd harmonics to read as a pitched instrument rather than a test tone,
 * and the quiet sine an octave down gives it body. Attack is short but not instant (a click is what
 * a pure gate sounds like) and the release is what stops chords smearing.
 */
export class SimpleSynth implements Instrument {
  private ctx: AudioContext
  private out: GainNode
  private active = new Set<{ osc: OscillatorNode[]; gain: GainNode }>()

  constructor(ctx: AudioContext, destination?: AudioNode) {
    this.ctx = ctx
    this.out = ctx.createGain()
    // Headroom: a dense chord of N voices must not clip the master.
    this.out.gain.value = 0.25
    this.out.connect(destination ?? ctx.destination)
  }

  play(midi: number, atSec: number, durationSec: number, gain = 1): void {
    const freq = midiToFreq(midi)
    const env = this.ctx.createGain()
    env.connect(this.out)

    const tri = this.ctx.createOscillator()
    tri.type = 'triangle'
    tri.frequency.value = freq

    const sub = this.ctx.createOscillator()
    sub.type = 'sine'
    sub.frequency.value = freq / 2
    const subGain = this.ctx.createGain()
    subGain.gain.value = 0.3
    sub.connect(subGain).connect(env)
    tri.connect(env)

    const ATTACK = 0.008
    const RELEASE = 0.12
    // Hold for the written duration, but never a zero-length blip.
    const hold = Math.max(durationSec, 0.05)
    const end = atSec + hold

    env.gain.setValueAtTime(0, atSec)
    env.gain.linearRampToValueAtTime(gain, atSec + ATTACK)
    // A touch of decay so repeated notes articulate instead of running together.
    env.gain.linearRampToValueAtTime(gain * 0.75, Math.min(atSec + 0.25, end))
    env.gain.setValueAtTime(gain * 0.75, Math.max(end - RELEASE, atSec + ATTACK))
    env.gain.linearRampToValueAtTime(0, end)

    const voice = { osc: [tri, sub], gain: env }
    this.active.add(voice)
    tri.onended = () => {
      this.active.delete(voice)
      try { env.disconnect() } catch { /* already torn down */ }
    }

    for (const o of voice.osc) { o.start(atSec); o.stop(end + 0.02) }
  }

  allOff(): void {
    const now = this.ctx.currentTime
    for (const voice of this.active) {
      try {
        voice.gain.gain.cancelScheduledValues(now)
        // Ramp, don't cut: an abrupt gain change to 0 is an audible click on every pause.
        voice.gain.gain.setValueAtTime(voice.gain.gain.value, now)
        voice.gain.gain.linearRampToValueAtTime(0, now + 0.02)
        for (const o of voice.osc) o.stop(now + 0.03)
      } catch { /* already stopped */ }
    }
    this.active.clear()
  }

  dispose(): void {
    this.allOff()
    try { this.out.disconnect() } catch { /* already gone */ }
  }
}
