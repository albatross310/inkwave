// ─── The Piece — the music module's shared data model (build-spec §1) ─────────
//
// THIS FILE IS A CONTRACT. Three lanes build against it: the photo path (§A1/§A2, this lane),
// the MusicXML path (§B), and lesson capture (§A3). A silent change here breaks the other two.
// If a lane needs a shape that isn't here, ADD to it — never redefine a field's meaning in place.
//
// NAMING: snake_case, deliberately, and it is NOT repo style drift. The Piece is a DOCUMENT/WIRE
// contract (it is persisted into a `.studio` file and read by independent lanes), and the spec
// writes it in snake_case. `productivity/types.ts` made the same call for the same reason. Three
// lanes reading one spec and typing what they see is worth more than internal-style consistency;
// don't "tidy" it to camelCase.
//
// ⚠️ STORAGE POSTURE — READ BEFORE WRITING ANY UI COPY OR COMMENT.
// Spec §0 lists "encryption at rest" among what is reused from the Inkwave engine, and §1 says the
// Piece is "stored in the user's own storage and encrypted at rest". **THAT IS NOT TRUE TODAY** —
// verified in the code (2026-07-17): `storage/opfs.ts` writes `JSON.stringify(data)` in PLAINTEXT,
// there is no `crypto.subtle.encrypt`/AES-GCM anywhere in src, and package.json carries no crypto
// library (`@noble/ed25519` is for SIGNING). A Piece is gzip'd/plain JSON in OPFS — protected by the
// browser's origin sandbox and the device's own disk encryption, not by Inkwave. The spec is a PLAN;
// a plan is not a property. ZERO-RETENTION *is* real (there is no server holding any of it), so the
// true and shippable sentence is the one the email lane landed on after hitting this same wall:
//   "Stored on your device — we never hold it."
// Do NOT write music-only encryption to paper over an app-wide gap. See CLAUDE.md (email layer §B2.2).

// ─── Geometry ────────────────────────────────────────────────────────────────

/**
 * A rectangle in NORMALISED coordinates — x/y/w/h each in [0,1], relative to whichever space the
 * carrying structure names. Normalised, never pixels: a page image can be re-captured at a different
 * resolution, and every consumer (markup canvas, heatmap, print) renders at its own scale.
 */
export interface Region {
  x: number
  y: number
  w: number
  h: number
}

// ─── Anchors — how EVERYTHING links to the music (§A2 last bullet) ───────────
//
// "Every annotation carries an `anchor` (page + x,y region, and — once barlines are marked, §A5 —
// the bar number) so it can be linked to lesson feedback, the heatmap, and recordings."
//
// A discriminated union, NOT one loose bag of optional fields: §1 says an anchor is "page + region
// for photo; note/measure id for MusicXML", and those are genuinely different addressing schemes.
// The union makes a consumer handle both explicitly instead of silently reading `page` as 0 on a
// MusicXML piece. `bar` is the JOIN KEY and is optional on BOTH variants — it is what lets a lesson
// note ("bar 24 — watch the dynamics"), a heatmap range, and a recording refer to the same music
// regardless of which path the Piece came in through.

/**
 * THE COORDINATE SPACE IS THE SOURCE IMAGE — the photograph as captured, before reflow.
 *
 * This is load-bearing and was a real design decision, not an accident of implementation.
 * Annotation-space reflow (§A1) INSERTS blank bands between systems, which changes the rendered
 * page's geometry every time the student drags a manual adjust handle. If an anchor were stored in
 * rendered/reflowed coordinates, nudging one handle would silently slide every annotation below it
 * off its music. So: the reflow is a pure VIEW TRANSFORM over immutable source coordinates
 * (`reflow.ts` → `sourceToLayout` / `layoutToSource`), and an anchor never moves when the layout does.
 *
 * The one case source coordinates cannot express is an annotation written INTO inserted space — it
 * has no source pixel, which is the entire point of the gap. Those carry `gap_after_system` + a
 * normalised offset WITHIN that gap, so they stay pinned to the stave they belong to and travel with
 * it when the gap is resized. See `GapOffset`.
 */
export interface RegionAnchor {
  kind: 'region'
  page: number              // index into Piece.pages
  region: Region            // normalised to the SOURCE page image (see above)
  system?: number           // index into PiecePage.systems, once systems are detected (§A1)
  bar?: number              // once barlines are marked (§A5) — the join key
  /**
   * Present iff this annotation lives in INSERTED (reflow) space rather than on the image.
   * `region.y` is then meaningless for placement and is kept only as a fallback; the pair
   * (gap.after_system, gap.t) places it.
   */
  gap?: GapOffset
}

/** A position inside a reflow gap — the blank band inserted AFTER the given system. */
export interface GapOffset {
  after_system: number      // the system index this gap follows (the stave the note belongs to)
  t: number                 // [0,1] down the gap's own height — stays put when the gap is resized
}

/**
 * MusicXML addressing (§B4): "anchor comments to specific notes/measures (addressable in MusicXML —
 * even cleaner than the photo path's region anchors)". Owned by the MusicXML lane; declared here so
 * one Annotation type serves both paths and `bar` means the same thing on both.
 */
export interface MusicXmlAnchor {
  kind: 'musicxml'
  measure: number           // MusicXML measure number
  note_id?: string          // MusicXML element id, when the anchor is note-level
  bar?: number              // the join key (usually === measure; kept explicit, never inferred)
}

export type Anchor = RegionAnchor | MusicXmlAnchor

// ─── Assets — image/audio bytes live OUTSIDE the JSON ────────────────────────

/**
 * An opaque handle to bytes held in the Piece's asset store, NOT the bytes themselves.
 *
 * WHY (CLAUDE.md, "Load performance is sacred"): a Piece is a few photographed pages — megabytes.
 * Inlining base64 into the JSON would put a whole-file parse of every page image on the load path,
 * which is precisely the class of bug that cost this app ~10s per open (the `blobToBase64` /
 * heartbeat findings). Refs resolve lazily, on demand, exactly like the PDF sidecars do.
 */
export type AssetRef = string

// ─── Pages, systems, bars (§1 `pages`) ───────────────────────────────────────

/**
 * One stave — five lines. Detected by GEOMETRY only (row-darkness peaks), never by reading notes.
 * OMR is an explicit, repeated non-goal (§0): nothing in this module may recognise a note.
 */
export interface Stave {
  region: Region            // normalised to the source page image
}

/**
 * One SYSTEM — the unit the reflow slices between and must NEVER cut through (§A1).
 *
 * A grand stave (piano treble+bass, or any braced group) is ONE system with several `staves`.
 * `is_grand_stave` is a rendering/UX convenience; the invariant that matters is structural — a
 * system is atomic to the slicer, whatever it contains.
 */
export interface System {
  index: number             // ordinal down the page
  region: Region            // bounding box of the whole system, source-normalised
  staves: Stave[]           // ≥1; >1 ⇒ braced group kept together
  is_grand_stave: boolean   // staves.length > 1
  /**
   * How confident the detector is that the boundary BELOW this system is a real system break
   * ([0,1]). Surfaced to the manual adjust handles (§A1 "manual adjust handles for messy/skewed
   * photos") so a low-confidence cut is offered for review rather than applied silently.
   */
  confidence: number
}

export interface BarRegion {
  bar: number               // bar/measure number
  region: Region            // source-normalised
}

export interface PiecePage {
  /** The captured page image (photo path). Exactly one of image_ref / rendered_ref is set. */
  image_ref?: AssetRef
  /** The rendered notation (MusicXML path, §B) — owned by that lane. */
  rendered_ref?: AssetRef
  /** Pixel dims of the source image — lets a consumer convert normalised ↔ pixels without decoding. */
  source_width?: number
  source_height?: number
  systems: System[]
  bars: BarRegion[]         // §A4: MVP is student-tapped barlines; CV auto-detect is later (§C2.7)
  /** The student's reflow adjustments for this page. Absent ⇒ render the source image untouched. */
  reflow?: PageReflow
}

// ─── Annotation-space reflow (§A1 — the distinctive feature) ─────────────────

/**
 * The reflow PLAN for one page: how much blank space to insert after each system.
 *
 * This is a VIEW TRANSFORM, never a mutation of the image. It is stored (so it survives a reload
 * and travels in the .studio), it is fully reversible, and the source image is never re-encoded.
 * `gaps` is sparse — a system with no entry gets `default_gap`.
 */
export interface PageReflow {
  enabled: boolean
  /** Fraction of the SOURCE page height to insert after each system by default. */
  default_gap: number
  /** system index → gap height, as a fraction of source page height. Manual handles write here. */
  gaps: Record<number, number>
}

// ─── Annotations (§1, §A2) ───────────────────────────────────────────────────

export type AnnotationKind = 'freehand' | 'text' | 'highlight' | 'leader' | 'sticky' | 'symbol'

/**
 * §1 declares `kind: freehand|text|highlight|leader|sticky`. `symbol` is ADDITIVE and is §A2's own
 * requirement — "musical symbols from a small palette" — which §1's list omits. It is a distinct
 * kind rather than a `text` with a glyph in it because a symbol has no prose to search, spell-check,
 * or distil, and the palette must be able to enumerate its own marks.
 */

/** One stroke: a flat [x0,y0,x1,y1,…] run of source-normalised points, plus per-point pressure. */
export interface FreehandContent {
  kind: 'freehand'
  points: number[]          // flat pairs — flat, not {x,y}[], to keep a long Pencil stroke compact
  pressure?: number[]       // [0,1] per point, from PointerEvent.pressure (Apple Pencil)
  tilt?: number[]           // degrees per point, from PointerEvent.tiltX/Y
  colour: string
  width: number             // stroke width as a fraction of page width — scale-independent
}

export interface TextContent {
  kind: 'text'
  text: string
  colour: string
}

export interface HighlightContent {
  kind: 'highlight'
  colour: string
  opacity: number
}

/** A draggable sticky note pinned to a region/bar (§A2). Its anchor says WHAT it is about; `at`
 *  says where the note itself sits — which is the whole point of the leader line. */
export interface StickyContent {
  kind: 'sticky'
  text: string
  colour: string
  /** Where the NOTE BODY sits, if the student dragged it away from its anchor. */
  at?: { region: Region; gap?: GapOffset }
  collapsed?: boolean
}

/**
 * Smart leader-line routing (§A2 — distinctive). "When the space above/below a stave is cramped,
 * the student draws a curved connector so a dynamics/feedback note can sit where there's room and
 * still point to the right place."
 *
 * The ROUTE IS DERIVED, not stored: `from`/`to` are the two endpoints and `leader.ts` computes the
 * curve. Storing a baked path would freeze the routing against a reflow the student later adjusts —
 * the same failure mode the source-coordinate rule above exists to prevent.
 */
export interface LeaderContent {
  kind: 'leader'
  /** The end that points AT the music. The annotation's own `anchor` is authoritative; this is the
   *  precise point within it. */
  to: { region: Region }
  /** Where the label sits — usually in inserted gap space, which is why the leader exists at all. */
  from: { region: Region; gap?: GapOffset }
  colour: string
  /** Hint for the router: which side of the stave the target belongs to. §A2's "above-midline →
   *  belongs to the stave below" rule. Derived on creation, overridable by the student. */
  side?: 'above' | 'below'
}

export interface SymbolContent {
  kind: 'symbol'
  /** Palette id (e.g. 'forte', 'crescendo', 'fermata') — NOT a bare glyph: the palette must be able
   *  to render, search and re-style its own marks, and a raw codepoint carries no meaning. */
  symbol: string
  size: number              // fraction of page width
  colour: string
}

export type AnnotationContent =
  | FreehandContent | TextContent | HighlightContent
  | StickyContent | LeaderContent | SymbolContent

/** §1: `Annotation { id, anchor, kind, content }`. */
export interface Annotation {
  id: string
  anchor: Anchor
  kind: AnnotationKind
  content: AnnotationContent
  author: Author            // §A2: the teacher can mark the score mid-lesson, and it is attributed
  created_at: string        // ISO-8601 WITH local offset (never a bare Z) — §A9's rule, house-wide
}

/** Who made a mark. §A2's heatmap is explicitly "teacher-editable mid-lesson… captured with the
 *  teacher as author and a timestamp", and the same attribution applies to any mark. */
export type Author = 'student' | 'teacher'

// ─── Heatmap (§1, §A2 — LATER, step 5; contract declared now) ────────────────
//
// User-curated, NEVER an AI judgement ("nothing opaque to defend"). Do not let a later lane grow a
// `score`/`difficulty` field the app computes — the colours are always the user's call.

export interface HeatmapEntry {
  bars: [number, number]    // [start, end] inclusive
  colour: string
  label?: string
  author: Author
  ts: string                // ISO-8601 with offset
}

// ─── Lesson capture (§1, §A3 — ANOTHER LANE; contract declared now) ──────────

/**
 * §1/§A3: "the *raw* transcript is **never** stored here — only the student's own distilled
 * snippets." There is deliberately NO `transcript` field on Piece and there must never be one:
 * the session-scoped, non-storable transcript is the entire reassurance that makes a teacher
 * comfortable being recorded. If a lane needs the live transcript it lives in session memory and
 * dies with the session — it does not reach this type.
 */
export interface LessonNote {
  id: string
  snippet: string           // the STUDENT's own selection/paraphrase, never verbatim capture
  anchor?: Anchor           // optional → bar
  created_at: string
}

/** §A3b: the teacher's dictated recap can attach "for next week" items. Storable BY DESIGN — the
 *  teacher chose to leave it, unlike the raw transcript. */
export interface Assignment {
  kind: 'youtube' | 'note'
  ref: string               // URL for youtube; the text itself for a note
  due: 'next_week'          // §1 names exactly this one value; widen only with Peter's call
}

// ─── Reference tracks + sync (§1, §A4 — LATER, step 3) ───────────────────────

export interface BarlineAnchor {
  page: number
  system: number
  x: number                 // normalised across the page width
  bar: number
}

export interface BeatMapEntry {
  time_sec: number
  bar: number
  beat: number
}

/** §A4's `Sync` block, verbatim. */
export interface Sync {
  barline_anchors: BarlineAnchor[]
  beat_map: BeatMapEntry[]
}

export interface ReferenceTrack {
  kind: 'youtube' | 'file'
  ref: string               // YouTube URL/id, or an AssetRef for an uploaded file
  sync?: Sync
}

// ─── Recordings + practice (§1, §A5 — LATER, step 4) ─────────────────────────

export interface Recording {
  id: string
  start_bar: number
  end_bar: number
  audio_ref: AssetRef
  flagged_sections?: Array<{ start_bar: number; end_bar: number; note?: string }>
  created_at: string
}

export interface PracticeTask {
  id: string
  text: string
  done: boolean
  anchor?: Anchor           // "bar 24 dynamics" → a task pinned to bar 24
  source: 'feedback' | 'assignment' | 'manual'  // seeded from pinned feedback / the recap, or typed
}

/**
 * A practice session is a REFERENCE into the productivity ledger, not a copy of one.
 *
 * §A5: "practice sessions write to the productivity ledger, so practice counts toward the student's
 * overall work stats." The ledger owns the measurement (`productivity/types.ts` SessionRow). Copying
 * minutes here would put a SECOND copy of every measured number beside the ledger's own — which is
 * exactly the trap CLAUDE.md records (§A6.4, "one representation of measurement, always": two copies
 * is how a narrative ends up contradicting the bars).
 */
export interface PracticeSessionRef {
  session_id: string        // → productivity SessionRow.session_id
}

export interface WeeklySchedule {
  /** Local day key (YYYY-MM-DD) → planned minutes. §A5's teacher-viewable weekly schedule. */
  planned: Record<string, number>
  /** §A5: sharing a read-only view with the teacher is OPT-IN and entirely the student's choice. */
  shared_with_teacher: boolean
}

export interface Practice {
  tasks: PracticeTask[]
  sessions: PracticeSessionRef[]
  schedule: WeeklySchedule
}

// ─── Provenance (§1, §A6) ────────────────────────────────────────────────────

/** Hashed + OTS-anchored via the EXISTING spine (`provenance/`) — never a second implementation. */
export interface PieceProvenance {
  hashes: Record<string, string>   // artefact key → sha256 hex
  ots_anchors: string[]            // snapshot/bundle ids carrying the OTS proofs
}

// ─── Source (§1 `source`) ────────────────────────────────────────────────────

export interface PhotoSource {
  type: 'photo'
  /** How the pages arrived — camera, an image import, or PDF pages (§A1). */
  captured_via: 'camera' | 'image' | 'pdf'
  /** For `pdf`: the original file's name. The BYTES are an AssetRef on the page, not here. */
  pdf_name?: string
}

export interface MusicXmlSource {
  type: 'musicxml'
  /** The `.musicxml`/`.mxl` master, stored ONCE and deduplicated (§B6). Owned by the MusicXML lane. */
  xml_ref: AssetRef
  /** §B7: set when the piece came from a public-domain corpus, so attribution can be rendered.
   *  Licensing discipline is that lane's (verified public-domain corpora only). */
  corpus?: { name: string; id: string; licence: string; attribution: string }
}

export type PieceSource = PhotoSource | MusicXmlSource

// ─── The Piece ───────────────────────────────────────────────────────────────

export type PieceSchemaVersion = '0.1.0'

/**
 * §1's Piece, implemented field-for-field. Everything about one piece of music lives here and this
 * whole object is what goes in the `.studio`.
 *
 * The score is MARKUP-ONLY, NEVER EDITABLE (§0, repeatedly): there is no field here that changes a
 * note, and none may be added. Inkwave consumes Sibelius/MuseScore/Dorico output and adds a study
 * layer; it does not compete with them.
 */
export interface Piece {
  id: string
  title: string
  composer?: string
  key?: string
  time_signature?: string
  schema_version: PieceSchemaVersion
  created_at: string        // ISO-8601 with local offset
  updated_at: string

  source: PieceSource
  pages: PiecePage[]
  reference_tracks: ReferenceTrack[]
  annotations: Annotation[]
  heatmap: HeatmapEntry[]
  lesson_notes: LessonNote[]
  assignments: Assignment[]
  recordings: Recording[]
  practice: Practice
  provenance: PieceProvenance
}

// ─── Constructors ────────────────────────────────────────────────────────────

/** An ISO-8601 stamp WITH the local offset — §A9's rule (never a bare `Z`: one field must carry
 *  both the instant and the offset, or the local day is unrecoverable). Mirrors the ledger's rule. */
export function isoWithOffset(d: Date = new Date()): string {
  const pad = (n: number, w = 2) => String(Math.abs(Math.trunc(n))).padStart(w, '0')
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `.${pad(d.getMilliseconds(), 3)}${sign}${pad(off / 60)}:${pad(off % 60)}`
  )
}

/** A new, empty Piece. Every collection is present and empty — a consumer never has to null-check
 *  a list, which is how an optional array silently becomes `undefined.map is not a function`. */
export function newPiece(init: { id: string; title: string; source: PieceSource }): Piece {
  const now = isoWithOffset()
  return {
    id: init.id,
    title: init.title,
    schema_version: '0.1.0',
    created_at: now,
    updated_at: now,
    source: init.source,
    pages: [],
    reference_tracks: [],
    annotations: [],
    heatmap: [],
    lesson_notes: [],
    assignments: [],
    recordings: [],
    practice: { tasks: [], sessions: [], schedule: { planned: {}, shared_with_teacher: false } },
    provenance: { hashes: {}, ots_anchors: [] },
  }
}
