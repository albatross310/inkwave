import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import * as copy from './copy'
import { classifyBrowserSpeech, DEFAULT_SOURCE_ID, SOURCES } from './stt'
import { MIC_PATTERN, PATTERN_CARRIER } from './micBoundary'

// §A3 makes the wording an ACCEPTANCE CRITERION rather than a nicety, and more sharply than
// anywhere else in this app: the feature's value IS the truth of a sentence said to a teacher who
// is not holding the device. "There is provably no keepable recording of them" is what buys their
// comfort. A false version of it does not overclaim — it obtains consent that was not informed.
//
// THE TRAP THIS FILE IS BUILT AROUND (the email lane's, inherited deliberately): "assert the bad
// phrase is absent" passes trivially — on correct copy, on empty copy, and on a typo'd matcher that
// can never match anything. That is the house disease. So every matcher is proved to FIRE on
// known-bad copy THROUGH THE SAME PIPELINE the real copy goes through, and proved NOT to fire on an
// honest control, before any verdict on the real strings is read.

// ─── The pipeline ────────────────────────────────────────────────────────────

const NEGATOR = /\b(not|never|n't|cannot|no|without)\b/i

/**
 * Drop clauses that DENY something. An affirmative-claim matcher must only see affirmative text, or
 * it reads a disclaimer as the claim it disclaims — the email lane's copy.test.ts learned this when
 * a naive matcher flagged the very sentence the spec required. Clauses split on sentence/list
 * punctuation and em-dashes, which is where English hangs its "…, not …" contrasts.
 */
function affirmativeOnly(text: string): string {
  return text
    .split(/[.;:,]|\s—\s/)
    .filter((clause) => !NEGATOR.test(clause))
    .join('. ')
}

type Scope = 'affirmative' | 'literal'
interface Matcher { name: string; re: RegExp; scope: Scope; knownBad: string }

const FORBIDDEN: Matcher[] = [
  // ── THE CENTRAL ONE. The spec (§0/§A3/§C1) promises on-device STT; a PWA cannot deliver it.
  // Safari's webkitSpeechRecognition asks for on-device only `if (supportsOnDeviceRecognition)` and
  // otherwise ships audio to Apple SILENTLY — and `processLocally`/`available()`, the API that could
  // require or reveal it, is Chrome-only. On Peter's iPhone 8 (A11) that condition is false. This
  // build therefore does not transcribe anyone, and no string may imply it does.
  {
    name: 'on-device speech processing (NOT achievable in a PWA — see stt.ts)',
    scope: 'affirmative',
    re: /\bon[-\s]device\b|\blocally on your device\b|\bprocessed? (locally|on your|on the device)\b/i,
    knownBad: 'Your lesson is transcribed on-device, so it stays private.',
  },
  {
    // SCOPE IS 'literal', AND THE PROVE-IT-FIRST RULE IS WHY. This was written 'affirmative' and
    // the known-bad test FAILED: the claim "the audio never leaves your device" is an affirmative
    // promise PHRASED AS A DENIAL, so affirmativeOnly() stripped the whole sentence and the matcher
    // saw an empty string. It could never fire — and its verdict on the real copy was passing
    // VACUOUSLY, reporting "makes no claim of audio-never-leaves-the-device" while structurally
    // incapable of detecting one. The house disease exactly, and only the known-bad caught it.
    // Same family as the email lane's inverse bug (a matcher that could not tell an assertion from
    // its denial) — the two together are why this file has two matcher classes.
    name: 'audio-never-leaves-the-device',
    scope: 'literal',
    re: /\b(audio|voice|recording|speech)\b[^.]{0,40}\bnever leaves\b|\bnever leaves (your|the) device\b|\bnever uploaded\b/i,
    knownBad: 'The audio never leaves your device.',
  },
  {
    name: 'we transcribe / we listen (this build does neither)',
    scope: 'affirmative',
    re: /\bwe (transcribe|record|listen)\b|\binkwave (transcribes|records|listens)\b|\btranscri(be|bes|bing|pt) (of |your )?(the )?(lesson|teacher)\b/i,
    knownBad: 'Inkwave transcribes your lesson as it happens.',
  },
  // ── The deletion overclaim. `end()` drops a JS reference: unreachable from the app, no copy in
  // any Inkwave store. That is what may be said. It is NOT a secure erase — the engine's GC decides
  // when those bytes are reused and we do not control the heap.
  {
    name: 'secure erasure / unrecoverable (we drop a reference, we do not wipe memory)',
    scope: 'affirmative',
    re: /\bunrecoverable\b|\bsecurely (erased|deleted|wiped)\b|\bwiped\b|\bdeleted forever\b|\bpermanently (erased|destroyed)\b|\bgone forever\b/i,
    knownBad: 'When the lesson ends the transcript is permanently erased and unrecoverable.',
  },
  // ── §0 and §1 BOTH list "encryption at rest" as reused from the engine. VERIFIED IN THE CODE
  // 2026-07-17: storage/opfs.ts writes JSON.stringify(data) in PLAINTEXT, crypto.subtle.encrypt /
  // AES-GCM appear NOWHERE in src (only .digest, for hashing), package.json carries no crypto
  // library. A plan is not a property. Copy tracks the CODE.
  {
    name: 'at-rest encryption (NOT implemented in this build)',
    scope: 'affirmative',
    re: /\b(stored|store|storage|saved|kept|held|encrypted)\b[^.]{0,30}\bencrypt/i,
    knownBad: 'Your lesson notes are stored encrypted on your device.',
  },
  {
    name: 'end-to-end encryption',
    scope: 'affirmative',
    re: /\bend[-\s]to[-\s]end\b|\be2ee?\b|\bfully encrypted\b/i,
    knownBad: 'Lesson notes are end-to-end encrypted.',
  },
  // ── Absolutes this build cannot support anywhere.
  {
    name: 'tamper-proof / impossible absolutes',
    scope: 'affirmative',
    re: /\btamper[-\s]proof\b|\bunforgeable\b|\bimpossible to (fake|forge|recover|retrieve)\b|\bno one can ever\b/i,
    knownBad: 'A tamper-proof record that is impossible to recover.',
  },
  // ── A forbidden claim that is ITSELF phrased as a negation, so it must be matched LITERALLY:
  // stripping negated clauses would hide it. A zero-knowledge claim this build does not make.
  {
    name: 'we-cannot-hear-it (a zero-knowledge claim this build does not make)',
    scope: 'literal',
    re: /\bwe (can(no|')t|cannot|are unable to) (read|hear|access|see)\b|\bnobody can (hear|read)\b/i,
    knownBad: 'We cannot hear your lessons.',
  },
]

function violates(m: Matcher, text: string): boolean {
  return m.re.test(m.scope === 'affirmative' ? affirmativeOnly(text) : text)
}

const ALL_COPY: [string, string][] = Object.entries(copy).filter(
  ([, v]) => typeof v === 'string',
) as [string, string][]

// ─── Prove the instrument before reading it ──────────────────────────────────

describe('the forbidden-claim matchers actually fire (prove the negative FIRST)', () => {
  for (const m of FORBIDDEN) {
    it(`catches known-bad copy for: ${m.name}`, () => {
      // Through the SAME pipeline as the real copy — a negative proved on a different code path
      // proves nothing about the path that matters.
      expect(violates(m, m.knownBad)).toBe(true)
    })
  }

  it('does NOT fire on the honest control sentence (the known-positive)', () => {
    // Correct copy must pass every matcher, or the matchers are noise that would force the copy to
    // be WRONG to stay green. This control is what caught the assertion-vs-denial bug in the email
    // lane, and it is doing real work here: the honest copy's whole job is to DENY the claims above.
    const honest =
      'Inkwave does not record audio and does not listen to your lesson. When you end the lesson ' +
      'the working panel is cleared and Inkwave keeps no copy of it. Your notes are stored on your ' +
      'device — we never hold them. This summary is saved with the piece, because you chose to ' +
      'leave it.'
    for (const m of FORBIDDEN) {
      expect(violates(m, honest), `${m.name} false-positived on honest copy`).toBe(false)
    }
  })

  it('the negation-stripper does not simply delete everything', () => {
    // If affirmativeOnly() returned '' the affirmative matchers would pass vacuously forever.
    expect(affirmativeOnly('Your lesson is transcribed on-device for privacy.').trim().length)
      .toBeGreaterThan(10)
    expect(affirmativeOnly('Inkwave does not record audio.')).not.toMatch(/record audio/)
  })

  it('there is copy to check at all (a matcher over an empty set proves nothing)', () => {
    // The email lane's probe passed its copy checks on a page that rendered no copy. An assertion
    // about strings needs strings.
    expect(ALL_COPY.length).toBeGreaterThanOrEqual(12)
    for (const [k, v] of ALL_COPY) expect(v.length, `${k} is empty`).toBeGreaterThan(10)
  })
})

// ─── The verdict on the real strings ─────────────────────────────────────────

describe('the real in-product copy makes no forbidden claim', () => {
  for (const m of FORBIDDEN) {
    it(`makes no claim of: ${m.name}`, () => {
      for (const [name, text] of ALL_COPY) {
        expect(violates(m, text), `${name} claims "${m.name}": ${JSON.stringify(text)}`).toBe(false)
      }
    })
  }
})

// ─── The copy and the code must agree ────────────────────────────────────────

describe('the copy tracks the CODE, not the spec', () => {
  it('the consent copy states the fact the code makes true: this screen cannot record', () => {
    // The sentence that replaces the spec's on-device promise. Note it is SCOPED to the screen —
    // an app-wide "Inkwave does not record audio" expires the moment §A5's practice recordings
    // ship, and an expired sentence goes on being read. micBoundary.test.ts binds this claim to
    // the real Permissions-Policy header.
    expect(copy.CONSENT_EXPLAINER).toMatch(/not recording this lesson/i)
    expect(copy.CONSENT_EXPLAINER).toMatch(/cannot reach a microphone|can reach a microphone/i)
  })

  it('every registered source is one whose promise the copy can keep', () => {
    // THE STRUCTURAL GUARD. An 'unverifiable' source (webkitSpeechRecognition) must not be
    // reachable while the copy says no audio is recorded. If someone registers one, this fails —
    // which is the moment to rewrite the copy and this test, deliberately, not by accident.
    for (const s of SOURCES) {
      expect(s.privacy, `source "${s.id}" is ${s.privacy}`).toBe('no-audio')
    }
    expect(DEFAULT_SOURCE_ID).toBe('no-audio')
  })

  it('“nothing on this screen can reach a microphone” is TRUE OF THE CODE', () => {
    // THE COPY'S CENTRAL CLAIM, ASSERTED AGAINST THE SOURCE RATHER THAN TRUSTED.
    //
    // `CONSENT_EXPLAINER` tells a teacher, in the room, that Inkwave does not record audio. That is
    // the sentence their consent rests on. It is true today because no capture API is called
    // anywhere in this module — and this test is what keeps it true: the day someone adds
    // getUserMedia/MediaRecorder/a recogniser, this FAILS, and the failure is the prompt to rewrite
    // the copy and /privacy DELIBERATELY, rather than leaving a now-false sentence on screen.
    //
    // A comment saying "there is no getUserMedia here" is a claim. This is a property.
    const dir = __dirname
    const sources = readdirSync(dir)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts'))
      // micBoundary.ts names every capture API as data in order to forbid them — the pattern
      // carrier, excluded here and proved inert (tests-only) in micBoundary.test.ts.
      .filter((f) => `src/music/lesson/${f}` !== PATTERN_CARRIER)
    expect(sources.length, 'no source files found — a scan over an empty set proves nothing')
      .toBeGreaterThanOrEqual(5)

    // Strip line comments before scanning: this very file's neighbours DISCUSS these APIs at length
    // (that is the finding), and a scanner that cannot tell a mention from a call would force the
    // documentation to be deleted to stay green.
    // The SAME pattern the firebreak judges by — a second copy of these rules is how one guard
    // silently stops catching what the other does (the §C1.4 matchers' lesson, applied here).
    const CAPTURE = MIC_PATTERN

    const stripComments = (src: string) =>
      src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

    // PROVE BOTH HALVES OF THE INSTRUMENT BEFORE READING ITS VERDICT — otherwise "no capture API
    // found" is the vacuous pass this whole file exists to refuse. A stripper that deleted every
    // line, or a regex that matched nothing, would each report a clean bill of health on a module
    // full of microphones.
    expect(CAPTURE.test(stripComments('const s = await navigator.mediaDevices.getUserMedia({ audio: true })')))
      .toBe(true)
    expect(CAPTURE.test(stripComments('const r = new webkitSpeechRecognition()'))).toBe(true)
    // The stripper removes MENTIONS in comments (so the finding can stay documented)…
    expect(CAPTURE.test(stripComments('  // we deliberately never call getUserMedia here'))).toBe(false)
    // …and does NOT eat the code around them — a stripper that returned '' would pass everything.
    expect(stripComments('// a comment\nconst x = getUserMedia()').trim()).toBe('const x = getUserMedia()')

    let scanned = 0
    for (const f of sources) {
      const code = stripComments(readFileSync(join(dir, f), 'utf8'))
      scanned++
      expect(CAPTURE.test(code), `${f} calls a capture API — the copy's "does not record audio" is now FALSE`)
        .toBe(false)
    }
    expect(scanned).toBe(sources.length)
  })

  it('the browser-speech classifier is honest about Safari-shaped browsers', () => {
    // A recogniser with no processLocally/available() is 'unverifiable' — never 'provable-local'.
    // Proved by DRIVING the classifier, not by trusting its comment: the globals are stubbed to look
    // like Safari, then like Chrome 139+, and the verdict must differ.
    const w = globalThis as unknown as Record<string, unknown>
    const saved = { SpeechRecognition: w.SpeechRecognition, webkitSpeechRecognition: w.webkitSpeechRecognition }
    try {
      delete w.SpeechRecognition
      delete w.webkitSpeechRecognition
      expect(classifyBrowserSpeech()).toBe('absent')

      // Safari shape: prefixed ctor, no processLocally, no static available().
      w.webkitSpeechRecognition = function () {} as unknown
      expect(classifyBrowserSpeech()).toBe('unverifiable')

      // Chrome 139+ shape: processLocally on the prototype AND a static available().
      const ctor = function () {} as unknown as { prototype: object; available: () => void }
      ctor.prototype = { processLocally: false }
      ctor.available = () => {}
      w.SpeechRecognition = ctor
      expect(classifyBrowserSpeech()).toBe('provable-local')
    } finally {
      if (saved.SpeechRecognition === undefined) delete w.SpeechRecognition
      else w.SpeechRecognition = saved.SpeechRecognition
      if (saved.webkitSpeechRecognition === undefined) delete w.webkitSpeechRecognition
      else w.webkitSpeechRecognition = saved.webkitSpeechRecognition
    }
  })
})
