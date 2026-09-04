// THE MICROPHONE FIREBREAK — which code may open a microphone, and which may never.
//
// Two features want the same Web API and must keep DIFFERENT promises: §A5's practice recording is
// the student's own, consensual and storable; §A3's lesson sells "there is provably no keepable
// recording of you" to someone who is not holding the device. ⚠ SO THE LESSON PATH MUST NOT ACQUIRE
// MICROPHONE ACCESS AS A SIDE EFFECT OF THE MUSIC MODULE GAINING IT — nobody would decide to break
// that; it would simply stop being true.
//
// THREE LAYERS, and the strongest was already there:
// 1. ⚠ `Permissions-Policy: microphone=()` (vercel.json) disables the mic for this ORIGIN at the
//    HTTP header. It is THE REAL LINE: §A5 cannot ship until someone edits it, which makes that
//    header the one place the decision is made.
// 2. A source allow-list — which module may name a capture API at all (`MIC_CAPABLE`).
// 3. ⚠ An IMPORT-GRAPH firebreak, followed rather than assumed: once §A5 puts `getUserMedia` behind
//    a helper, a grep of `lesson/`'s own files passes while `lesson/` imports the helper — a
//    scanner like that reports a firebreak that no longer exists, vacuously, forever.
//
// THE COPY IS BOUND TO LAYER 1, NOT TO A COMMENT: the claim is SCOPED to the lesson screen, and
// `micBoundary.test.ts` reads the real header and fires when it moves.
// → docs/archive/music-module-build.md#micboundary

/**
 * APIs whose NAME appearing in code means audio is being captured. Broad match: these identifiers
 * have no innocent use — you do not write `getUserMedia` without asking for a stream.
 *
 * ⚠ `createMediaStreamSource`/`AudioWorkletNode` are here because whisper-WASM reaches a microphone
 * through an AUDIO GRAPH, not `MediaRecorder`: a firebreak that only knew about recording would miss
 * transcription entirely. → docs/archive/music-module-build.md#mic-mention-vs-use
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
 * ⚠ A BARE NAME IS ALLOWED AND `new` IS NOT: `stt.ts` must NAME `webkitSpeechRecognition` to
 * feature-detect it, and reading a `typeof` captures no audio. Matched broadly, this guard flags the
 * module that DOCUMENTS the microphone problem — a guard that cannot tell a mention from a use
 * forces its own documentation to be deleted.
 * → docs/archive/music-module-build.md#mic-mention-vs-use
 */
export const RECOGNISER_APIS = ['SpeechRecognition', 'webkitSpeechRecognition'] as const

/** For reporting. */
export const MIC_APIS = [...CAPTURE_APIS, ...RECOGNISER_APIS] as const

/**
 * The one pattern the firebreak judges by: any capture API, or the CONSTRUCTION of a recogniser.
 *
 * HONEST LIMIT, stated rather than implied: an indirected construction
 * (`const R = w.webkitSpeechRecognition; new R()`) evades this regex. That is why the firebreak does
 * not rest on it — layer 1 blocks the platform regardless. ⚠ THIS LAYER'S JOB IS TO MAKE AN
 * INTENTIONAL CHANGE VISIBLE, not to defeat an adversary.
 */
export const MIC_PATTERN = new RegExp(
  `\\b(${CAPTURE_APIS.join('|')})\\b|\\bnew\\s+(?:${RECOGNISER_APIS.join('|')})\\b`,
)

/**
 * The ONLY modules permitted to reach a microphone, as repo-relative path prefixes.
 *
 * ⚠ EMPTY TODAY, AND THAT IS THE POINT. §A5 will add exactly one entry (`src/music/recording/`), and
 * that edit is the moment someone must ALSO flip `microphone=()` → `microphone=(self)` in
 * vercel.json, update `/privacy` in the same commit, and rewrite any copy saying Inkwave does not
 * record audio. The tests force all four together instead of the first one alone.
 * → docs/archive/music-module-build.md#mic-layers
 */
export const MIC_CAPABLE: readonly string[] = Object.freeze([])

/**
 * ⚠ THE CAMERA IS NOT THE MICROPHONE, AND `getUserMedia` IS BOTH — the constraints object decides
 * and a source scan cannot read it. So `getUserMedia` STAYS in CAPTURE_APIS (dropping it to let a
 * camera through would open a hole for `{audio:true}`) and a camera module is DECLARED by path
 * instead, exempt ONLY for that one identifier: name any audio-specific API and it is still flagged.
 * → docs/archive/music-module-build.md#mic-camera
 */
export const CAMERA_CAPABLE: readonly string[] = Object.freeze(['src/media/camera.ts'])

/**
 * The AUDIO-SPECIFIC apparatus — naming any of these is reaching for a MICROPHONE, not a camera, so
 * a camera-declared file may not name them and stay exempt.
 *
 * ⚠ THE `audio: true` LITERAL IS CAUGHT, and its absence was a real hole (PROBED): flipping
 * camera.ts's `audio: false` to `true` opened the microphone with every mic-boundary test still
 * green, because `isCameraOnly` never read the constraint. The header denied the track anyway — but
 * that coupled the source firebreak to the platform header, and the two layers must hold
 * independently. The bare `getUserMedia` token stays OUT: it is the ambiguous one, which is the
 * whole reason a camera needs a declaration. → docs/archive/music-module-build.md#mic-camera
 */
export const AUDIO_ONLY_PATTERN = new RegExp(
  `\\b(MediaRecorder|createMediaStreamSource|AudioWorkletNode)\\b|\\bnew\\s+(?:${RECOGNISER_APIS.join('|')})\\b|\\baudio\\s*:\\s*true\\b`,
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
 * ⚠ If whisper-WASM ever lands ON the lesson path, this entry is not quietly deleted: the guarantee
 * CHANGES SHAPE, the copy changes with it, and the teacher is told the new truth. Deleting it
 * without that is precisely the erosion this file exists to make loud.
 * → docs/archive/music-module-build.md#mic-layers
 */
export const MIC_FORBIDDEN: readonly string[] = Object.freeze(['src/music/lesson/'])

/**
 * THIS FILE — the pattern CARRIER, excluded from its own scan, because it has to name every capture
 * API as a literal in order to forbid them. Same shape as `src/copy/claimMatchers.ts`.
 *
 * ⚠ AND THE EXCLUSION IS ASSERTED so it cannot become a hole: `micBoundary.test.ts` proves this file
 * is imported by TEST FILES ONLY. An excluded file that nothing checks is a place to hide a
 * microphone. → docs/archive/music-module-build.md#mic-mention-vs-use
 */
export const PATTERN_CARRIER = 'src/music/lesson/micBoundary.ts'

/** Does a Permissions-Policy allowlist grant the microphone to anyone? `()` = nobody. */
export function micPolicyAllows(permissionsPolicy: string): boolean {
  // `microphone=()` — empty allowlist, disabled for every origin including self. `(self)`/`*` —
  // enabled. ⚠ ABSENT DEFAULTS TO SELF-ALLOWED, so a missing directive must read as ALLOWED: a
  // parser that read it as "off" would report a firebreak the platform is not enforcing.
  // → docs/archive/music-module-build.md#mic-policy-parse
  const m = /microphone=\(([^)]*)\)|microphone=(\*)/.exec(permissionsPolicy)
  if (!m) return true
  if (m[2] === '*') return true
  return m[1].trim().length > 0
}
