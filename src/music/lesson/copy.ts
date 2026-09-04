// The in-product copy for the lesson layer — ONE source of truth, deliberately not inlined in JSX.
//
// ⚠ THIS BOUNDARY PROTECTS A THIRD PARTY WHO IS NOT HOLDING THE DEVICE. Every other honesty rule in
// Inkwave protects the writer from an overclaim about their own work; a teacher agreed to something
// on the strength of a sentence we wrote. If it is not literally true, this has not merely
// overclaimed — it has obtained consent that was not informed.
//
// FOUR THINGS THIS COPY MAY NOT SAY, all verified in the code rather than assumed:
//  1. NOT that the teacher is transcribed on-device. This build does not transcribe them AT ALL,
//     and the honest sentence is stronger than the spec's: there was never any audio.
//  2. NOT "encrypted". opfs.ts writes plaintext JSON; there is no crypto library. A plan is not a
//     property, and COPY TRACKS THE CODE.
//  3. NOT "unrecoverable" / "securely erased". `end()` drops a JS reference — unreachable from the
//     app, with no copy in any Inkwave store, which is exactly what may be said. The GC decides
//     when the bytes are reused and we do not control the heap.
//  4. NOT "we cannot read it". Zero-knowledge claims this build does not get to make.
//
// ⚠️ AND THE MICROPHONE CLAIM IS SCOPED TO THIS SCREEN, DELIBERATELY. "Inkwave does not record
// audio" is APP-WIDE and §A5's practice recordings will make it FALSE. "Nothing on this screen can
// reach a microphone" is what the teacher needs, what the firebreak guarantees, and it survives §A5
// — a sentence that will expire is a sentence that will be forgotten and go on being read.
//
// The temptation is always the better-sounding sentence. `copy.test.ts` asserts the forbidden claims
// are absent, but a test cannot check a sentence it has never seen — read the boundary before
// editing. → docs/archive/music-module-build.md#lessoncopy

// ─── Consent (§A3: "Consent first") ──────────────────────────────────────────

/** The heading on the gate that stands between a lesson and any note-taking. */
export const CONSENT_TITLE = 'Ask your teacher first'

/**
 * The ask. §A3: "Recording a teacher is socially — and often legally — sensitive." Its second
 * sentence does the work the spec expected the on-device claim to do, without claiming anything
 * about a pipeline we cannot see: it is a fact about what this screen IS.
 */
export const CONSENT_EXPLAINER =
  'Show your teacher this screen before you begin. Inkwave is not recording this lesson — nothing ' +
  'on this screen can reach a microphone. This is a page for you to take notes on, pinned to the ' +
  'bars they are about. Nothing you write here leaves your device.'

/** The limit, at the same weight as the ask — never a footnote. */
export const CONSENT_LIMIT =
  'Anything you type is your own note, in your own words. Your teacher can ask you to stop or to ' +
  'delete a note at any time.'

export const CONSENT_CONFIRM = 'My teacher knows and agrees'

// ─── The live panel (§A3: session-scoped, non-storable) ──────────────────────

export const PANEL_TITLE = 'Lesson notes'

/**
 * What the panel IS. §A3's model is a source panel the student distils from; with no transcript to
 * distil, the panel is their own notes — which §A3 already says is the only thing that survives.
 */
export const PANEL_EXPLAINER =
  'Write what your teacher tells you as the lesson happens, and pin each note to the bar it is ' +
  'about. Tap a bar number to attach the note to it.'

/**
 * THE SESSION-SCOPED PROMISE, stated exactly. Every clause is literally true of the code: nothing
 * writes the working notes to storage, `end()` drops the reference, `toRecord()` emits only kept
 * notes + the recap. ⚠ It does NOT say "unrecoverable" — see the header.
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
 * §A3b flips the dynamic from "being recorded" to "leaving a note for my student".
 * ⚠ ADDRESSED TO THE TEACHER, because at this moment they are holding the device — writing it in the
 * third person throws away the whole design. → docs/archive/music-module-build.md#copy-voice
 */
export const RECAP_EXPLAINER =
  'Your student has handed you their device. Leave them a short summary of today, and add anything ' +
  'you want them to work on before next week. You can read it back and change it before you hand ' +
  'the device over.'

/**
 * THE DISTINCTION THAT IS THE WHOLE FEATURE, said to the person it protects: a recap is kept BECAUSE
 * the teacher chose to leave it, and the sentence says so, so they know which side of the line they
 * are on.
 */
export const RECAP_STORABLE_NOTE =
  'This summary is saved with the piece, because you chose to leave it. You can delete it before ' +
  'you hand the device back.'

/**
 * The dictation hint. ⚠ It offers no Inkwave-run speech recognition and claims nothing about where
 * the keyboard's dictation sends audio: the teacher's keyboard is their own tool, and their OS makes
 * its own disclosure. Inkwave stays out of a claim it cannot keep.
 */
export const RECAP_DICTATE_HINT =
  'Type it, or use the mic key on your own keyboard if you would rather speak it.'

export const ASSIGNMENT_ADD = 'For next week'

export const ASSIGNMENT_EXPLAINER =
  'Add a YouTube link to listen to, or write a practice note. These become your student’s to-dos ' +
  'for the week.'

// ─── Storage ─────────────────────────────────────────────────────────────────

/**
 * The storage claim: the true thing (zero-retention IS real) without the false one. ⚠ When app-wide
 * encryption ships this sentence can grow the word, and not before — a module-local crypto scheme
 * over an app-wide gap would be worse than the gap, making the sentence true of one file and
 * implying it of all of them. → docs/archive/music-module-build.md#copy-three-bans
 */
export const STORAGE_CLAIM =
  'Your lesson notes are stored on your device, like any other Inkwave document — we never hold ' +
  'them.'

/** §A3's "organise by piece" — why the notes live where they do. */
export const ORGANISE_NOTE =
  'Notes stay with the piece, so each one builds up its own history of feedback over time.'
