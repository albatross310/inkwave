// The in-product copy for the lesson layer — ONE source of truth, deliberately not inlined in JSX.
//
// WHY THIS FILE EXISTS, AND WHY IT MATTERS MORE HERE THAN ANYWHERE ELSE IN THE APP.
//
// Every other honesty boundary in Inkwave protects the writer from an overclaim about their own
// work. This one protects A THIRD PARTY WHO IS NOT HOLDING THE DEVICE. A lesson note is someone
// else's voice, distilled — a teacher who agreed to something on the strength of a sentence we
// wrote. §A3's whole thesis is that "there is provably no keepable recording of them" is what
// removes their self-consciousness. If that sentence is not literally true, the feature is not
// merely overclaiming; it has obtained consent that was not informed.
//
// ─── WHAT WE PROBED, AND WHAT WE THEREFORE MAY NOT SAY (2026-07-17) ──────────────────────────
//
// The spec (§0, §A3, §C1) says the transcription is "on-device (Apple Speech / whisper.cpp small/
// base; iPhone-12-capable) — audio processed locally, never uploaded". IN A PWA THAT IS NOT
// ACHIEVABLE TODAY, and the details are in stt.ts. In short:
//
//   · Inkwave has no access to the Apple Speech framework. It is not a native app.
//   · Safari's `webkitSpeechRecognition` sits on SFSpeechRecognizer and WebKit asks for on-device
//     ONLY `if ([_recognizer supportsOnDeviceRecognition])`. Otherwise the audio goes to APPLE'S
//     SERVERS, silently — and `processLocally`/`available()`, the API that could require or reveal
//     it, is Chrome-only (Safari: not supported). The page cannot require it, query it, or observe
//     it. On Peter's own iPhone 8 (A11) `supportsOnDeviceRecognition` is false — and §A3b hands
//     THAT PHONE to the teacher.
//   · whisper.cpp via WASM WOULD be provable (we would ship the weights; there is no request to
//     make), but it is not built. See the report for its real price.
//
// SO THIS BUILD DOES NOT TRANSCRIBE THE TEACHER AT ALL, and none of the copy below says it does.
// What it says instead is TRUE AND STRUCTURAL, and is a stronger sentence than the spec's:
// **Inkwave never records audio.** There is no `getUserMedia` in this module. The spec promises the
// audio is deleted when the lesson ends; the honest version is that there was never any audio.
//
// ─── THE OTHER THREE THINGS THIS COPY MAY NOT SAY ────────────────────────────────────────────
//
// 1. NOT "encrypted". VERIFIED IN THE CODE 2026-07-17, independently of the email lane which hit
//    this same wall: `storage/opfs.ts` writes `JSON.stringify(data)` in PLAINTEXT, there is no
//    `crypto.subtle.encrypt`/AES-GCM anywhere in src (only `.digest` for hashing), and package.json
//    carries no crypto library. §0 and §1 of the music spec BOTH list "encryption at rest" as
//    reused from the existing engine. IT IS NOT TRUE — it is design intent, and a plan is not a
//    property. Copy tracks the CODE.
// 2. NOT "unrecoverable" / "securely erased" / "wiped". `end()` drops a JavaScript reference. That
//    makes the transcript unreachable from the app and leaves no copy in any Inkwave store — which
//    is exactly what may be said. It is NOT a secure erase of physical memory; the engine's GC
//    decides when those bytes are reused, and we do not control the heap. "Deleted forever" would
//    be the same species of overclaim as "encrypted", in a place where a teacher is relying on it.
// 3. NOT "we cannot read it" / "nobody can hear it". Zero-knowledge claims this build does not get
//    to make (the email lane's rule, for the same reason).
//
// WHAT IS TRUE, and is what the strings below say: nothing here is sent anywhere (zero-retention is
// real — there is no server to hold it); the live panel is gone when the lesson ends and Inkwave
// keeps no copy; only the student's own notes stay with the piece.
//
// The temptation is always the better-sounding sentence. If a change here starts sounding stronger
// than this comment, it is wrong. `copy.test.ts` asserts the forbidden claims are absent — but a
// test cannot check a sentence it has never seen, so read the boundary before editing.

// ─── Consent (§A3: "Consent first") ──────────────────────────────────────────

/** The heading on the gate that stands between a lesson and any note-taking. */
export const CONSENT_TITLE = 'Ask your teacher first'

/**
 * The ask. §A3: "Recording a teacher is socially — and often legally — sensitive. The teacher must
 * know and agree."
 *
 * Note the second sentence does the work the spec expected the on-device claim to do — and does it
 * without claiming anything about a pipeline we cannot see, because there is no pipeline: the
 * reassurance is a fact about what this screen is, not a promise about where audio goes.
 */
export const CONSENT_EXPLAINER =
  'Show your teacher this screen before you begin. Inkwave does not record audio and does not ' +
  'listen to your lesson — this is a page for you to take notes on, pinned to the bars they are ' +
  'about. Nothing you write here leaves your device.'

/** The limit, at the same weight as the ask — never a footnote. */
export const CONSENT_LIMIT =
  'Anything you type is your own note, in your own words. Your teacher can ask you to stop or to ' +
  'delete a note at any time.'

export const CONSENT_CONFIRM = 'My teacher knows and agrees'

// ─── The live panel (§A3: session-scoped, non-storable) ──────────────────────

export const PANEL_TITLE = 'Lesson notes'

/**
 * What the panel IS. §A3's model is a source panel the student distils from in real time; with no
 * transcript to distil, the panel is their own notes — which §A3 already says is the only thing
 * that survives ("The only thing that persists is the student's own curated notes").
 */
export const PANEL_EXPLAINER =
  'Write what your teacher tells you as the lesson happens, and pin each note to the bar it is ' +
  'about. Tap a bar number to attach the note to it.'

/**
 * THE SESSION-SCOPED PROMISE, stated exactly.
 *
 * Every clause is literally true of the code: the working notes live in the session object (nothing
 * writes them to storage), `end()` drops the reference and Inkwave holds no copy, and `toRecord()`
 * emits only kept notes + the recap. What it does NOT say is "unrecoverable" — see the header.
 */
export const SESSION_SCOPE_NOTE =
  'When you end the lesson, the working panel is cleared and Inkwave keeps no copy of it. The ' +
  'notes you kept stay with the piece; nothing else does.'

export const END_LESSON = 'End the lesson'

export const END_LESSON_CONFIRM =
  'Ending the lesson clears the working panel. The notes you kept — and your teacher’s recap — stay ' +
  'with this piece.'

// ─── §A3b: the recap ─────────────────────────────────────────────────────────

export const RECAP_TITLE = 'A note for your student'

/**
 * §A3b's insight, and the sentence that carries it: "The recap flips the dynamic from 'being
 * recorded' to 'leaving a note for my student' — friendlier for the teacher and a cleaner consent
 * posture."
 *
 * The copy is addressed TO THE TEACHER, because at this moment they are holding the device. That is
 * the whole design of §A3b, and writing it in the third person would throw it away.
 */
export const RECAP_EXPLAINER =
  'Your student has handed you their device. Leave them a short summary of today, and add anything ' +
  'you want them to work on before next week. You can read it back and change it before you hand ' +
  'the device over.'

/**
 * THE DISTINCTION THAT IS THE WHOLE FEATURE, said to the person it protects. A recap is kept
 * BECAUSE the teacher chose to leave it — and the sentence says so, so the teacher knows which side
 * of the line they are on.
 */
export const RECAP_STORABLE_NOTE =
  'This summary is saved with the piece, because you chose to leave it. You can delete it before ' +
  'you hand the device back.'

/**
 * The dictation hint. NOTE WHAT IT DOES NOT DO: it does not offer Inkwave-run speech recognition,
 * and it does not claim anything about where the keyboard's dictation sends audio. The teacher's
 * keyboard is the teacher's own tool — their device shows its own indicator and their OS vendor
 * makes its own disclosure. Inkwave stays out of a claim it cannot keep.
 */
export const RECAP_DICTATE_HINT =
  'Type it, or use the mic key on your own keyboard if you would rather speak it.'

export const ASSIGNMENT_ADD = 'For next week'

export const ASSIGNMENT_EXPLAINER =
  'Add a YouTube link to listen to, or write a practice note. These become your student’s to-dos ' +
  'for the week.'

// ─── Storage ─────────────────────────────────────────────────────────────────

/**
 * The storage claim. Says the true thing (zero-retention IS real — there is no server holding it)
 * and does NOT say the false one. §0/§1's "encryption at rest" is design intent for the WHOLE app;
 * when it ships, this sentence can grow the word, and not before. A module-local crypto scheme over
 * an app-wide gap would be worse than the gap: it would make the sentence true of one file and
 * imply it of all of them.
 */
export const STORAGE_CLAIM =
  'Your lesson notes are stored on your device, like any other Inkwave document — we never hold ' +
  'them.'

/** §A3's "organise by piece" — why the notes live where they do. */
export const ORGANISE_NOTE =
  'Notes stay with the piece, so each one builds up its own history of feedback over time.'
