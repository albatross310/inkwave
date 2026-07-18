// THE MICROPHONE FIREBREAK — which code may open a microphone, and which may never.
//
// ─── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────
//
// Two features in this app want the same Web API and must keep DIFFERENT promises:
//
//   §A5  A STUDENT RECORDING THEMSELVES PRACTISING — consensual, deliberate, theirs, and storable.
//        "each recording is anchored to the bar where it starts… the score itself becomes the index
//        of your practice history." `getUserMedia` → `MediaRecorder` → OPFS. Nothing blocks it and
//        nothing should.
//   §A3  A TEACHER'S VOICE DURING A LESSON — where "there is provably no keepable recording of you"
//        is the entire product, and the person relying on the sentence is not holding the device.
//
// Same API, different guarantee. So the separation has to be STRUCTURAL — the standard already
// applied to non-storability (`#private` field, `toJSON()` redacts, `LessonRecord` has no field to
// hold a transcript, both mutations proved to fail). **The lesson path must not acquire microphone
// access as a side effect of the music module gaining it.** Nobody would decide to break that; it
// would simply stop being true, which is how every guarantee in CLAUDE.md's catalogue died.
//
// ─── THE THREE LAYERS, AND THE ONE THAT ALREADY EXISTED ──────────────────────────────────────
//
// 1. **`Permissions-Policy: microphone=()` — vercel.json, DEPLOYED TODAY.** PROBED, and it is the
//    strongest thing here: the microphone is disabled for this origin AT THE HTTP HEADER, so
//    `getUserMedia({audio:true})` cannot succeed anywhere in Inkwave no matter what any module
//    calls. This is not something this lane added — it was already true, and it is why the
//    lesson's copy is honest today. It is also the REAL LINE: §A5's recordings cannot ship until
//    someone edits that header, which makes the header the one place the decision must be made.
// 2. **A source allow-list** — which module may name a capture API at all (`MIC_CAPABLE`, below).
// 3. **An import-graph firebreak** — nothing reachable from `src/music/lesson/` may be mic-capable.
//    Layer 3 is the one that survives the API moving: once §A5 puts `getUserMedia` behind a helper,
//    a grep for `getUserMedia` in `lesson/` passes while `lesson/` imports the helper. A scanner
//    that only greps the module's own files would report a firebreak that no longer exists —
//    vacuously, forever. So reachability is followed, not assumed.
//
// ─── THE COPY IS BOUND TO LAYER 1, NOT TO A COMMENT ──────────────────────────────────────────
//
// "Inkwave does not record audio" stops being true the moment §A5 ships. So the lesson's claim is
// SCOPED to the lesson screen ("nothing on this screen can reach a microphone"), and
// `micBoundary.test.ts` reads the real header out of vercel.json and asserts the copy matches the
// policy. Change the header and the copy test fires. That is a test that fires when the line moves,
// at the line itself.

/**
 * APIs whose NAME appearing in code means audio is being captured. Broad match: these identifiers
 * have no innocent use — you do not write `getUserMedia` without asking for a stream.
 *
 * `createMediaStreamSource`/`AudioWorkletNode` are here because whisper-WASM's route to a
 * microphone is an AUDIO GRAPH, not `MediaRecorder` — a firebreak that only knew about recording
 * would miss transcription entirely, which is the one path that matters most here.
 */
export const CAPTURE_APIS = [
  'getUserMedia',
  'MediaRecorder',
  'createMediaStreamSource',
  'AudioWorkletNode',
] as const

/**
 * Speech recognisers, which are DIFFERENT and the difference is load-bearing.
 *
 * `stt.ts` must NAME `webkitSpeechRecognition` in order to feature-detect it — that is the entire
 * finding of this lane, and reading `typeof globalThis.webkitSpeechRecognition` captures exactly no
 * audio. Only CONSTRUCTING one opens a microphone. So a bare name is allowed and `new` is not.
 *
 * The first cut of this file matched these names broadly and immediately flagged `stt.ts` — i.e. it
 * would have forced the module that DOCUMENTS the microphone problem onto the microphone
 * allow-list, which would have made the allow-list mean nothing. A guard that cannot tell a mention
 * from a use forces its own documentation to be deleted.
 */
export const RECOGNISER_APIS = ['SpeechRecognition', 'webkitSpeechRecognition'] as const

/** For reporting. */
export const MIC_APIS = [...CAPTURE_APIS, ...RECOGNISER_APIS] as const

/**
 * The one pattern the firebreak judges by: any capture API, or the CONSTRUCTION of a recogniser.
 *
 * HONEST LIMIT, stated rather than implied: an indirected construction
 * (`const R = w.webkitSpeechRecognition; new R()`) evades this regex. Static analysis of a dynamic
 * language cannot be airtight, which is exactly why the firebreak does not rest on it — layer 1
 * (`Permissions-Policy: microphone=()`) blocks `getUserMedia` at the platform for the whole origin
 * regardless of who calls it or how cleverly. This layer's job is to make an intentional change
 * VISIBLE and deliberate, not to defeat an adversary.
 */
export const MIC_PATTERN = new RegExp(
  `\\b(${CAPTURE_APIS.join('|')})\\b|\\bnew\\s+(?:${RECOGNISER_APIS.join('|')})\\b`,
)

/**
 * The ONLY modules permitted to reach a microphone, as repo-relative path prefixes.
 *
 * **EMPTY TODAY, AND THAT IS THE POINT.** Nothing in Inkwave opens a microphone; `Permissions-
 * Policy: microphone=()` says so at the platform level and the source scan says so at the code
 * level. §A5's practice recordings will add exactly one entry here (`src/music/recording/`), and
 * that edit is the moment someone must also:
 *   · change `microphone=()` → `microphone=(self)` in vercel.json, and
 *   · update `/privacy` IN THE SAME COMMIT (the standing rule), and
 *   · rewrite any copy that says Inkwave does not record audio.
 * The tests force all four to happen together instead of the first one happening alone.
 */
export const MIC_CAPABLE: readonly string[] = Object.freeze([])

/**
 * ─── THE CAMERA IS NOT THE MICROPHONE, AND getUserMedia IS BOTH ──────────────────────────────
 *
 * `getUserMedia` opens EITHER a camera or a microphone — the constraints object decides, and a
 * source scan cannot read it. So a module that opens the CAMERA (`{video:true}`) names the exact
 * same identifier a module that opens the MICROPHONE (`{audio:true}`) does. Dropping `getUserMedia`
 * from `CAPTURE_APIS` to let a camera through would open a hole for `getUserMedia({audio:true})`, so
 * it stays. Instead, a camera module is DECLARED here by path.
 *
 * The microphone guarantee does NOT weaken by one bit:
 *   · `Permissions-Policy: microphone=()` (vercel.json) blocks the audio track at the PLATFORM for
 *     the whole origin, so even a camera module that mistakenly asked for `{audio:true}` gets no
 *     microphone. The camera got `camera=(self)`; the mic header is untouched.
 *   · A camera-declared file is exempt ONLY for `getUserMedia`. If it ALSO names an audio-specific
 *     API — `MediaRecorder`, the Web Audio graph, a recogniser — it is STILL flagged, because that
 *     is reaching past a camera. `isCameraOnly` enforces exactly that.
 *
 * So this is additive: the mic sweep still SEES `getUserMedia` everywhere; it simply no longer
 * mistakes the declared camera module for a microphone. A microphone hidden in an undeclared file,
 * or an audio API smuggled into the camera module, is caught as before.
 */
export const CAMERA_CAPABLE: readonly string[] = Object.freeze(['src/media/camera.ts'])

/**
 * The AUDIO-SPECIFIC apparatus — naming any of these is reaching for a MICROPHONE, not a camera, so
 * a camera-declared file may not name them and stay exempt. `getUserMedia` is deliberately NOT here:
 * it is the ambiguous one, which is the whole reason a camera needs an explicit declaration.
 */
export const AUDIO_ONLY_PATTERN = new RegExp(
  `\\b(MediaRecorder|createMediaStreamSource|AudioWorkletNode)\\b|\\bnew\\s+(?:${RECOGNISER_APIS.join('|')})\\b`,
)

/**
 * Is this file's `MIC_PATTERN` match attributable ONLY to a permitted CAMERA use? True iff the file
 * is camera-declared AND its code names no audio-specific API. `code` should already have comments
 * stripped (a camera module may DISCUSS the microphone — this one's neighbours do).
 */
export function isCameraOnly(relPath: string, code: string): boolean {
  const declared = CAMERA_CAPABLE.some(
    (p) => relPath === p || (p.endsWith('/') && relPath.startsWith(p)),
  )
  return declared && !AUDIO_ONLY_PATTERN.test(code)
}

/**
 * Modules that may NEVER reach a microphone, transitively — the firebreak's protected side.
 *
 * If whisper-WASM ever lands ON the lesson path, this entry does not get quietly deleted: the
 * guarantee CHANGES SHAPE (from "there was never any audio" to "the audio never left the device,
 * and here is how you check"), the copy changes with it, and the teacher is told the new truth.
 * Deleting the entry without doing that is precisely the erosion this file exists to make loud.
 */
export const MIC_FORBIDDEN: readonly string[] = Object.freeze(['src/music/lesson/'])

/**
 * THIS FILE — the pattern CARRIER, excluded from its own scan.
 *
 * It has to name every capture API as a string literal in order to forbid them, so it matches
 * `MIC_PATTERN` by construction. Same shape as `src/copy/claimMatchers.ts`, which carries the
 * §C1.4 `knownBad` strings and is excluded from the repo-wide copy sweep for the identical reason.
 *
 * AND THE EXCLUSION IS ASSERTED, so it cannot become a hole: `micBoundary.test.ts` proves this file
 * is imported by TEST FILES ONLY. The moment production code imports it, the exemption would start
 * covering a real code path — an excluded file that nothing checks is a place to hide a microphone.
 * (CLAUDE.md's own rule for the copy guard: "A test asserts the fixture carrier is imported by
 * tests ONLY, so the exclusion can't become a hole.")
 */
export const PATTERN_CARRIER = 'src/music/lesson/micBoundary.ts'

/** Does a Permissions-Policy allowlist grant the microphone to anyone? `()` = nobody. */
export function micPolicyAllows(permissionsPolicy: string): boolean {
  // `microphone=()` — empty allowlist, the feature is disabled for every origin including self.
  // `microphone=(self)` / `microphone=*` — enabled. Absent — the feature DEFAULTS TO self-allowed,
  // which is why an absent directive must read as ALLOWED, not as denied. A parser that treated a
  // missing directive as "off" would report a firebreak that the platform is not enforcing.
  const m = /microphone=\(([^)]*)\)|microphone=(\*)/.exec(permissionsPolicy)
  if (!m) return true
  if (m[2] === '*') return true
  return m[1].trim().length > 0
}
