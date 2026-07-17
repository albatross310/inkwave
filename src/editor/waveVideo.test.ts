// ─── pickRung — the wave video's rung ladder, and its only decision ──────────────────────────
// KEEPS what `tilescale.prove.mjs` ESTABLISHED. That probe measured the real thing (the video's
// wave tile against the CSS water's: 140.0 vs 140.0, 0.0% error, at a viewport where the old
// `object-fit: cover` read 122.5) and it remains the in-browser truth — but it needs a build, a
// server and a browser, it is in no CI, and six weeks from now a proof that ran once is
// indistinguishable from one that never ran. This is the ~10ms version that cannot be silently
// reverted (CLAUDE.md: "of every claim you prove, ask whether a cheap unit-level version can KEEP
// it true — if it is ~90ms and needs no browser, there is no excuse").
//
// THE CLAIM IT KEEPS: a rung is only ever returned when its DESIGN BOX COVERS THE VIEWPORT. That
// is what makes `object-fit: fill` a CROP rather than a RESIZE — and a resize is the bug Peter saw
// live ("the video resolution and size of the waves does not match that of the background"). A rung
// returned for a viewport it does not cover would leave a bare edge; a stretched one brings the
// 12.5% tile jump back.
import { describe, it, expect } from 'vitest'
import { pickRung } from './waveVideo'

describe('pickRung — the ladder crops, it never resizes', () => {
  it('the device class is a HARD PARTITION — the same viewport picks differently by pointer type', () => {
    // If this fails, every `coarse` case below is silently measuring the desktop path and proves
    // nothing. `phone` is captured under the app's PHONE CSS and desk/wide under desktop CSS —
    // they are pictures of two different waters, so this is not a preference.
    // (This check exists because the first cut of pickRung read `matchMedia` INTERNALLY, and under
    // vitest's node environment there is no `window` — so `coarse` was false for every case and the
    // whole touch half of this suite was a duplicate of the desktop half. Passing, proving nothing.)
    expect(pickRung(1280, 800, false)?.name).toBe('desk')
    expect(pickRung(1280, 800, true)).toBeNull() // no phone rung covers 1280 wide
  })

  describe('the covering rule — the crop invariant itself', () => {
    // Stated as a PROPERTY, not a table of expected names: whatever comes back must cover the
    // viewport in BOTH axes. A future rung cannot satisfy this by accident.
    const cases: [number, number, boolean, string][] = [
      [375, 667, true, 'iPhone 8'],
      [390, 844, true, 'iPhone 12'],
      [430, 932, true, 'iPhone 14 Pro Max'],
      [1100, 700, false, "the probe's own 122.5px cover failure"],
      [1280, 800, false, 'MacBook Air'],
      [1440, 900, false, "the probe's 157.5px cover failure"],
      [1512, 982, false, 'MacBook Pro 14'],
      [1920, 1080, false, 'full HD desktop'],
      [2560, 1440, false, 'QHD desktop'],
    ]
    for (const [vw, vh, coarse, label] of cases) {
      it(`${label} (${vw}x${vh}): the rung covers the viewport`, () => {
        const r = pickRung(vw, vh, coarse)
        expect(r, `${label} must get a rung — nothing in the ladder covers it`).not.toBeNull()
        expect(r!.cssW, `${r!.name} is ${r!.cssW}px wide for a ${vw}px viewport — it would be STRETCHED`).toBeGreaterThanOrEqual(vw)
        expect(r!.cssH, `${r!.name} is ${r!.cssH}px tall for a ${vh}px viewport — it would be STRETCHED`).toBeGreaterThanOrEqual(vh)
      })
    }
  })

  it('picks the SMALLEST covering rung — a laptop must not pay for the wide clip', () => {
    // `wide` covers 1280x800 too. Returning it would look identical and cost ~2x the bytes, which
    // is the whole reason the ladder has more than one desktop rung.
    expect(pickRung(1280, 800, false)?.name).toBe('desk')
    expect(pickRung(1920, 1080, false)?.name).toBe('desk')
    // Past full HD in EITHER axis, only `wide` covers.
    expect(pickRung(1921, 1080, false)?.name).toBe('wide')
    expect(pickRung(1920, 1081, false)?.name).toBe('wide')
  })

  it('REFUSES rather than stretches past the ceiling → CSS water', () => {
    // Peter's ceiling is "full hd. Or even 720p", so there is no 4K rung and a 4K viewport has
    // nothing to crop from. Returning `wide` anyway would silently reintroduce the measured bug.
    // Null is the honest answer: waveVideo bails and the CSS water — always correct — plays.
    expect(pickRung(3840, 2160, false)).toBeNull()
    expect(pickRung(2561, 1440, false)).toBeNull()
    expect(pickRung(2560, 1441, false)).toBeNull()
  })

  it('a phone viewport taller than the phone design box gets CSS water, not a stretch', () => {
    // The honest failure. 440x956 is the design box; anything taller has no pattern to crop.
    expect(pickRung(440, 1200, true)).toBeNull()
  })

  it('STATED CEILING: an iPad in portrait gets CSS water (this is deliberate)', () => {
    // 820x1180. `phone` (440x956) cannot cover it, and the desk clips are LANDSCAPE — 1080 < 1180,
    // so `desk` fails on height even ignoring the device partition. Pinned so that a future rung
    // added for iPad is a DECISION someone makes, not an accident, and so this documented limit is
    // the one people actually hit rather than a hypothetical.
    expect(pickRung(820, 1180, true)).toBeNull()
  })

  it('every clip is encoded at design CSS x dsf — the generate.mjs contract', () => {
    // generate.mjs derives encW/encH as vw*dsf and no longer scales at encode time. A fractional
    // clip dimension means someone has introduced a dsf the encoder cannot honour exactly, and the
    // resize would be silent — invisible on screen until the tile is measured.
    for (const [vw, vh, coarse] of [[375, 667, true], [1280, 800, false], [2560, 1440, false]] as [number, number, boolean][]) {
      const r = pickRung(vw, vh, coarse)!
      expect(Number.isInteger(r.cssW * r.dsf), `${r.name} clip width is fractional`).toBe(true)
      expect(Number.isInteger(r.cssH * r.dsf), `${r.name} clip height is fractional`).toBe(true)
    }
  })

  it('H.264 level headroom: no touch device may be handed a clip past Level 4.0', () => {
    // generate.mjs pins Level 4.0 (~2.1 Mpx) for phone/desk and 5.1 for `wide`. That is safe ONLY
    // while `wide` is unreachable from a touch device — which is THIS function's job, so it is this
    // function's test. An iPhone handed a Level 5.1 stream fails to decode, and the fallback chain
    // is silent, so it would present as "the video just doesn't work on my phone".
    for (const [vw, vh] of [[375, 667], [390, 844], [430, 932], [440, 956]] as [number, number][]) {
      const r = pickRung(vw, vh, true)
      expect(r, `${vw}x${vh} must get a rung`).not.toBeNull()
      const mpx = (r!.cssW * r!.dsf * r!.cssH * r!.dsf) / 1e6
      expect(mpx, `${r!.name} is ${mpx.toFixed(2)} Mpx — past Level 4.0 on a touch device`).toBeLessThanOrEqual(2.1)
    }
  })
})
