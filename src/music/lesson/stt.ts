// Speech-to-text sources, classified by WHAT WE CAN HONESTLY SAY ABOUT THEM.
//
// ⚠ `webkitSpeechRecognition` IS 'unverifiable' — NOT on-device, and no copy may say it is. WebKit
// asks for on-device recognition only `if ([_recognizer supportsOnDeviceRecognition])` and otherwise
// sends the audio to Apple's servers SILENTLY; the page cannot require, query or observe which
// happened (`processLocally`/`available()` are Chrome-only). On Peter's own iPhone 8 that support
// flag is false — and §A3b hands THAT PHONE to the teacher. A promise whose whole value is that it
// is provable cannot rest on it, so this source is classified honestly and NOT REGISTERED.
//
// The structural truth is stronger than any claim about Apple's pipeline: INKWAVE NEVER OPENS THE
// MICROPHONE — no `getUserMedia` here, no audio buffer to keep, delete or leak. Hence the 'no-audio'
// default. → docs/archive/music-module-build.md#stt

/**
 * What we are able to PROVE about where a source's audio goes. ⚠ A CLAIM-LICENCE, not a performance
 * tier — it decides which sentences `copy.ts` is allowed to say.
 * → docs/archive/music-module-build.md#stt-privacy-tiers
 */
export type SttPrivacy =
  /**
   * Inkwave never touches the microphone; the words arrive as ordinary text input, including the
   * user's own keyboard dictation key (their OS discloses its own handling). PROVABLE BY
   * CONSTRUCTION — no `getUserMedia` on this path — and the strongest posture a PWA has.
   */
  | 'no-audio'
  /**
   * A model whose weights WE ship and run in this page (whisper.cpp via WASM) — provable because
   * there is no network call to make. NOT BUILT; the seam exists so the honest ambient path can land
   * without reshaping this module. Its real price is in the archive.
   */
  | 'local-model'
  /**
   * Speech recognised through a pipeline we do not control and CANNOT INSPECT. ⚠ A source of this
   * class may NEVER be described as on-device, and if it is ever offered its consent copy must say
   * plainly that the audio may be sent to Apple.
   */
  | 'unverifiable'

export interface SttSource {
  id: string
  /** Human label for the picker. Says what it IS, never what we wish it were. */
  label: string
  privacy: SttPrivacy
  /** Whether this source can be used in this browser, right now. */
  available: () => boolean
}

/**
 * Does `webkitSpeechRecognition` exist here at all? ⚠ It says NOTHING about where the audio goes —
 * that question has no answer available to a web page, which is the whole finding.
 */
export function browserSpeechExists(): boolean {
  const g = speechGlobal()
  return typeof g.webkitSpeechRecognition !== 'undefined' || typeof g.SpeechRecognition !== 'undefined'
}

/**
 * The global the recogniser would live on. ⚠ `globalThis`, NOT `window`: under vitest's node
 * environment a `window`-bound classifier answers 'absent' to everything and its tests can only
 * assert that. A capability probe whose own verdict cannot be exercised is the shape of thing this
 * module exists to avoid. → docs/archive/music-module-build.md#stt-probes
 */
function speechGlobal(): {
  SpeechRecognition?: { available?: unknown; prototype?: object }
  webkitSpeechRecognition?: { prototype?: object }
} {
  return globalThis as unknown as {
    SpeechRecognition?: { available?: unknown; prototype?: object }
    webkitSpeechRecognition?: { prototype?: object }
  }
}

/**
 * Can this browser be ASKED to keep recognition local, and TELL US whether it did? ⚠ Its ABSENCE is
 * why Safari's recogniser is 'unverifiable' — not that we know audio leaves, but that we are
 * structurally unable to require that it doesn't, or to find out. Feature-detected, NEVER sniffed
 * off a user agent: a UA string is a claim, and a claim is not a property.
 */
export function browserSpeechCanProveLocal(): boolean {
  const g = speechGlobal()
  const ctor = g.SpeechRecognition ?? g.webkitSpeechRecognition
  if (!ctor) return false
  const hasProcessLocally = !!ctor.prototype && 'processLocally' in ctor.prototype
  const hasAvailable = typeof g.SpeechRecognition?.available === 'function'
  return hasProcessLocally && hasAvailable
}

/**
 * The honest classification of the browser's own recogniser, for reporting.
 *
 * 'absent'        — no recogniser here.
 * 'unverifiable'  — it exists, but we cannot require or observe local processing (Safari, today).
 * 'provable-local'— it exists AND exposes processLocally/available (Chrome 139+), so a caller could
 *                   require local processing and be refused rather than silently uploaded.
 */
export function classifyBrowserSpeech(): 'absent' | 'unverifiable' | 'provable-local' {
  if (!browserSpeechExists()) return 'absent'
  return browserSpeechCanProveLocal() ? 'provable-local' : 'unverifiable'
}

// ─── The registry ────────────────────────────────────────────────────────────
//
// ⚠ STRUCTURAL, NOT CONVENTIONAL: a source is only reachable through `availableSources()`, and the
// 'unverifiable' source is NOT LISTED here at all — so no UI can offer it and no accident can make
// it the default. Adding it means adding it here AND writing consent copy saying the audio may be
// sent to Apple; `copy.test.ts` will not let it ship claiming otherwise.
// → docs/archive/music-module-build.md#stt-probes

export const SOURCES: readonly SttSource[] = Object.freeze([
  Object.freeze({
    id: 'no-audio',
    label: 'Type, write, or use your keyboard’s dictation key',
    privacy: 'no-audio' as const,
    available: () => true,
  }),
])

export function availableSources(): SttSource[] {
  return SOURCES.filter((s) => s.available())
}

export function sourceById(id: string): SttSource | undefined {
  return SOURCES.find((s) => s.id === id)
}

/**
 * The source a session uses unless told otherwise. ⚠ 'no-audio' — the only one whose promise we can
 * keep; any other default makes the module's central claim depend on a pipeline we cannot see.
 */
export const DEFAULT_SOURCE_ID = 'no-audio'
