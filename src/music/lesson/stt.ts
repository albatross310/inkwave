// Speech-to-text sources, classified by WHAT WE CAN HONESTLY SAY ABOUT THEM.
//
// ─── THE FINDING THAT SHAPES THIS FILE (probed 2026-07-17, primary sources) ───────────────────
//
// The music build-spec §0/§A3/§C1 names "on-device speech-to-text: Apple Speech framework
// (`requiresOnDeviceRecognition`) or whisper.cpp" and promises the teacher that "audio never leaves
// the device" — "there is provably no keepable recording of them". Inkwave is a PWA. It has no
// access to the Apple Speech framework. So what is actually reachable, and what may we claim?
//
// 1. `webkitSpeechRecognition` EXISTS in Safari 14.1+ / iOS 14.5+ (MDN BCD; WebKit's own
//    SpeechRecognition.idl carries `InterfaceName=webkitSpeechRecognition`).
//
// 2. WebKit DOES ask for on-device recognition — but ONLY OPPORTUNISTICALLY. Verbatim from
//    Source/WebCore/Modules/speech/cocoa/WebSpeechRecognizerTask.mm (present on every shipping
//    safari-*-branch checked):
//
//        if ([_recognizer supportsOnDeviceRecognition])
//            [_request setRequiresOnDeviceRecognition:YES];
//
//    Read the condition, not the wish. When `supportsOnDeviceRecognition` is FALSE the request is
//    left at its default and the audio goes to APPLE'S SERVERS. There is no error, no event, no
//    flag — the fallback is SILENT.
//
// 3. THE PAGE CANNOT REQUIRE IT, QUERY IT, OR OBSERVE IT. The Web Speech API's on-device controls
//    — `processLocally`, `SpeechRecognition.available()`, `install()` — are Chrome 139+ ONLY
//    (MDN BCD: safari `version_added: false`, safari_ios mirrors), and WebKit's IDL does not
//    declare one of them. Safari's own permission prompt says "Allow “%@” to capture your audio
//    and use it for speech recognition?" (WebCore/en.lproj/Localizable.strings) — it does not
//    mention Apple, so the user is not told either.
//
// 4. `supportsOnDeviceRecognition` IS FALSE ON REAL TARGET DEVICES. Apple's on-device speech needs
//    an A12 Bionic or later (iOS 15's on-device Siri requirement); Core ML could not reach the ANE
//    before A12/iOS 12 — the A11's Neural Engine is Face ID's, not third-party-reachable. Peter's
//    own phone is an iPHONE 8 (A11, ceilinged at iOS 16.7). §A3b hands THAT PHONE TO THE TEACHER
//    to dictate the recap. On it, "audio never leaves the device" is FALSE.
//
// CONCLUSION: `webkitSpeechRecognition` is 'unverifiable' — not "on-device", not "cloud", but
// UNKNOWABLE FROM HERE, per utterance, with a silent fallback. A promise whose entire value is
// that it is provable cannot rest on it. So it is classified honestly and NOT REGISTERED by
// default; see `SOURCES` below and `copy.ts` for what may be said.
//
// The one thing we can make structurally true today is stronger than any claim about Apple's
// pipeline: INKWAVE NEVER OPENS THE MICROPHONE. There is no `getUserMedia` in this module and no
// audio buffer to keep, delete, or leak. That is why 'no-audio' is the default source.

/**
 * What we are able to PROVE about where a source's audio goes. This is a claim-licence, not a
 * performance tier — it decides which sentences `copy.ts` is allowed to say.
 */
export type SttPrivacy =
  /**
   * Inkwave never touches the microphone. The words arrive as ordinary text input — typed, written
   * with the Pencil, or dictated by the user with THEIR OWN keyboard's mic key (in which case the
   * OS shows its own indicator and Apple, not Inkwave, discloses its own handling).
   *
   * PROVABLE, and by construction: no `getUserMedia` call exists on this path, so there is no
   * recording to keep. This is the strongest posture available to a PWA today.
   */
  | 'no-audio'
  /**
   * A model whose weights WE ship and run in this page (whisper.cpp via WASM). Audio genuinely
   * never leaves the device, and it is provable because there is no network call to make.
   *
   * NOT BUILT. The seam exists so the honest ambient path can land without reshaping this module.
   * Its real costs are recorded in the report, not hidden here: a 74MB (tiny) / 142MB (base) model
   * download; WASM SIMD; pthreads want SharedArrayBuffer, which needs COOP/COEP cross-origin
   * isolation — and Safari does not support `COEP: credentialless` (MDN BCD), so isolating the app
   * would break the YouTube IFrame embed the SAME spec depends on (§A4/§A3b assignments).
   */
  | 'local-model'
  /**
   * The browser recognises speech through a pipeline we do not control and CANNOT INSPECT.
   * `webkitSpeechRecognition` is this and only this. It may be processed on-device; it may be sent
   * to the vendor's servers; the page is not told which, and the fallback is silent.
   *
   * A source of this class may NEVER be described as on-device. If it is ever offered, its consent
   * copy must say plainly that the audio may be sent to Apple.
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
 * Does `webkitSpeechRecognition` exist here at all? Note carefully what this does NOT tell you: it
 * says nothing about where the audio goes. That question has no answer available to a web page —
 * which is the whole finding.
 */
export function browserSpeechExists(): boolean {
  const g = speechGlobal()
  return typeof g.webkitSpeechRecognition !== 'undefined' || typeof g.SpeechRecognition !== 'undefined'
}

/**
 * The global the recogniser would live on. `globalThis`, not `window` — identical in a browser
 * (window IS globalThis there), but it also makes these probes RUNNABLE: under vitest's node
 * environment `window` is undefined, so a `window`-bound classifier answers 'absent' to every
 * question and its tests can only ever assert that. A capability probe whose own verdict cannot be
 * exercised is the shape of thing this module exists to avoid.
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
 * Can this browser be ASKED to keep recognition local, and TELL US whether it did?
 *
 * This is `processLocally` + `available()` — the Chrome 139+ extension. Its ABSENCE is the reason
 * Safari's recogniser is classified 'unverifiable': not that we know audio leaves, but that we are
 * structurally unable to require that it doesn't, or to find out.
 *
 * Probed by feature-detecting the real API surface, never by sniffing a user agent — a UA string is
 * a claim, and this module exists because a claim is not a property.
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
// THE RULE, and it is structural rather than conventional: a source is only reachable through
// `availableSources()`, which filters on `available()`. The 'unverifiable' source is NOT LISTED
// here at all — so no UI can offer it, and no accident can make it the default, until Peter has
// read the finding and made the call. Adding it later means adding it here AND writing consent
// copy that says the audio may be sent to Apple; `copy.test.ts` will not let it ship claiming
// otherwise.

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
 * The source a session uses unless told otherwise. 'no-audio' — the only one whose promise we can
 * keep. A default of anything else would make the module's central claim depend on a pipeline we
 * cannot see.
 */
export const DEFAULT_SOURCE_ID = 'no-audio'
