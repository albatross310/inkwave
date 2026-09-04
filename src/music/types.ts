// ─── The Piece — the music module's shared data model (build-spec §1) ─────────
//
// ⚠️ THIS FILE IS A CONTRACT — the photo path (§A1/§A2), the MusicXML path (§B) and lesson capture
// (§A3) all build against it. ADD to it; never redefine a field's meaning in place.
// snake_case is deliberate: this is a DOCUMENT/WIRE shape the spec writes that way (as
// `productivity/types.ts` is). Don't "tidy" it to camelCase.
//
// ⚠️ THERE IS NO AT-REST ENCRYPTION IN THIS BUILD, whatever §0/§1 promise. Any UI copy must track
// the CODE: the true and shippable sentence is "Stored on your device — we never hold it".
// → docs/archive/music-module-build.md#piece-storage-posture

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
// A DISCRIMINATED UNION, never one bag of optional fields: photo and MusicXML are different
// addressing schemes, and the union makes a consumer handle both rather than read `page` as 0 on a
// MusicXML piece. `bar` is the JOIN KEY, optional on every variant.
// → docs/archive/music-module-build.md#anchor-union

/**
 * ⚠️ THE COORDINATE SPACE IS THE SOURCE IMAGE — the photograph as captured, before reflow. The
 * reflow is a pure VIEW TRANSFORM (`reflow.ts` → `sourceToLayout` / `layoutToSource`), so an anchor
 * never moves when the layout does; store one in reflowed coordinates and one dragged handle slides
 * every annotation below it off its music. A mark written INTO inserted space has no source pixel
 * and carries a `GapOffset` instead. → docs/archive/music-module-build.md#anchor-source-space
 */
export interface RegionAnchor {
  kind: 'region'
  page: number              // index into Piece.pages
  region: Region            // normalised to the SOURCE page image (see above)
  system?: number           // index into PiecePage.systems, once systems are detected (§A1)
  bar_index?: number        // THE JOIN KEY — 0-based ordinal. See BarRef below.
  bar_label?: string        // what a human says/reads. NEVER a key. See BarRef below.
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
 * MusicXML addressing (§B4). Owned by the MusicXML lane; declared here so one Annotation type
 * serves both paths and a bar means the same thing on both.
 */
export interface MusicXmlAnchor {
  kind: 'musicxml'
  part_index?: number       // which part; absent ⇒ 0 (bar indices are per-part)
  bar_index?: number        // THE JOIN KEY — 0-based ordinal. See BarRef below.
  bar_label?: string        // the printed <measure number>, verbatim. NEVER a key. See BarRef below.
  note_id?: string          // MusicXML element id, when the anchor is note-level
}

/**
 * "Bar 24" — AND NOTHING ELSE: the join key when the join key is all that is known, which is what
 * a real lesson produces (a teacher SAYS a bar; the photo may have no bar model at all).
 *
 * ⚠️ It carries NO region and MUST NOT GROW ONE — the moment it can hold coordinates, the
 * temptation returns to fill them with a guess. If coordinates are genuinely known, build a
 * `RegionAnchor`. → docs/archive/music-module-build.md#bar-anchor
 */
export interface BarAnchor {
  kind: 'bar'
  bar_index?: number        // THE JOIN KEY — 0-based ordinal. See BarRef below.
  bar_label?: string        // what a human said. NEVER a key. See BarRef below.
  page?: number             // a hint for later resolution, never an address
}

export type Anchor = RegionAnchor | MusicXmlAnchor | BarAnchor

// ─── BarRef: how a bar is named, and why it takes TWO fields ─────────────────
//
// ⚠️ `bar_index` (0-based ORDINAL) IS THE JOIN KEY. `bar_label` (as printed or as spoken — '0',
// '8a', '24') is NEVER a key: a printed bar number is a STRING by MusicXML spec and is NOT UNIQUE,
// so it can match two bars in one score. Only an ordinal can be sorted, ranged or joined.
// BOTH ARE OPTIONAL because they are known at different times: carry what you actually know,
// resolve later, never fabricate the key. → docs/archive/music-module-build.md#barref
export interface BarRef {
  bar_index?: number
  bar_label?: string
}

// ─── Assets — image/audio bytes live OUTSIDE the JSON ────────────────────────

/**
 * An opaque handle to bytes in the Piece's asset store, NEVER the bytes themselves — inlining
 * base64 puts a whole-file parse of every page image on the load path, the class of bug that cost
 * this app ~10s per open. Refs resolve lazily, like the PDF sidecars.
 * → docs/archive/music-module-build.md#asset-ref
 */
export type AssetRef = string

// ─── Pages, systems, bars (§1 `pages`) ───────────────────────────────────────

/**
 * One stave — five lines. ⚠ Detected by GEOMETRY only (row-darkness peaks), never by reading notes:
 * OMR is an explicit, repeated non-goal (§0). → docs/archive/music-module-build.md#system-atomic
 */
export interface Stave {
  region: Region            // normalised to the source page image
}

/**
 * One SYSTEM — the unit the reflow slices between and must NEVER cut through (§A1). A grand stave
 * is ONE system with several `staves`; a system is atomic to the slicer whatever it contains, and
 * `is_grand_stave` is only a rendering convenience.
 * → docs/archive/music-module-build.md#system-atomic
 */
export interface System {
  index: number             // ordinal down the page
  region: Region            // bounding box of the whole system, source-normalised
  staves: Stave[]           // ≥1; >1 ⇒ braced group kept together
  is_grand_stave: boolean   // staves.length > 1
  /**
   * Confidence [0,1] that the boundary BELOW this system is a real break. A low-confidence cut is
   * offered to the §A1 adjust handles for review, never applied silently.
   */
  confidence: number
}

/** One bar's box on a photographed page. `bar_index` is its ORDINAL down the page (see BarRef). */
export interface BarRegion {
  bar_index: number         // 0-based ordinal — THE key
  bar_label?: string        // the printed number, if the student typed/tapped one. Never a key.
  region: Region            // source-normalised
  system: number            // which system it sits in — a bar never spans two
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
 * The reflow PLAN for one page: how much blank space to insert after each system. ⚠ A VIEW
 * TRANSFORM, never a mutation — fully reversible, and the source image is never re-encoded.
 * `gaps` is sparse; a system with no entry gets `default_gap`.
 * → docs/archive/music-module-build.md#page-reflow
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
 * `symbol` is ADDITIVE to §1's list — §A2's own requirement. A distinct kind, not a `text` with a
 * glyph in it: a symbol has no prose to search or distil, and the palette must be able to enumerate
 * its own marks. → docs/archive/music-module-build.md#symbol-kind
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
 * Smart leader-line routing (§A2). ⚠ THE ROUTE IS DERIVED, NOT STORED — `from`/`to` are the two
 * endpoints and `leader.ts` computes the curve; a baked path freezes the routing against a reflow
 * the student later adjusts. → docs/archive/music-module-build.md#leader-route
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
  id: string
  /**
   * [start, end] INCLUSIVE, as 0-based bar ORDINALS (`bar_index`, never a printed label — a label
   * cannot be ranged; see BarRef). This is a sweep across bars, and a sweep is an ordinal fact.
   */
  bars: [number, number]
  colour: string
  label?: string
  /** §A2: the teacher recolours mid-lesson and it is captured AS the teacher's, with a timestamp.
   *  That attribution is what makes the heatmap a shared lesson artifact rather than a solo one. */
  author: Author
  ts: string                // ISO-8601 with offset
}

// ─── Lesson capture (§1, §A3 — ANOTHER LANE; contract declared now) ──────────

/**
 * ⚠️ THERE IS NO `transcript` FIELD ON `Piece` AND THERE MUST NEVER BE ONE (§1/§A3: only the
 * student's own distilled snippets are stored). A live transcript lives in session memory and dies
 * with the session — that non-storability is the whole reassurance that lets a teacher be recorded.
 *
 * DECLARED ONCE — HERE, IN THE CONTRACT — AND IMPORTED BY `lesson/types.ts`, never the reverse.
 * → docs/archive/music-module-build.md#lesson-note-ownership
 */
export interface LessonNote {
  id: string
  /** The STUDENT's own selection/paraphrase — never a verbatim capture. See the warning above. */
  snippet: string
  /** §1: "anchor(optional → bar)" — usually a `BarAnchor`, which is why that variant exists. */
  anchor?: Anchor
  created_at: string
}

/** §A3b: the teacher's dictated recap can attach "for next week" items. Storable BY DESIGN — the
 *  teacher chose to leave it, unlike the raw transcript. */
export interface Assignment {
  kind: 'youtube' | 'note'
  ref: string               // URL for youtube; the text itself for a note
  due: 'next_week'          // §1 names exactly this one value; widen only with Peter's call
  /** Where on the score it belongs, when the teacher pinned it to one. */
  anchor?: Anchor
}

// ─── Reference tracks + sync (§1, §A4 — LATER, step 3) ───────────────────────

/**
 * ONE TAPPED BARLINE — the SPATIAL half of §A4's sync. ⚠ Not a fallback: `reflow.ts` REFUSES to
 * pre-detect barlines on a single stave, so on a violin or vocal part these taps are the ONLY
 * source of bars and without them the heatmap has nothing to colour.
 *
 * An anchor marks a barLINE (a boundary), never a bar — consecutive anchors on the SAME system
 * define a bar (`sync.ts` `barSpansFromAnchors`), which is what makes the cursor incapable of
 * sweeping across a line end. → docs/archive/music-module-build.md#barline-anchor
 */
export interface BarlineAnchor {
  page: number
  system: number
  x: number                 // normalised across the page width
  /**
   * The 0-based ORDINAL of the bar this barline OPENS. See BarRef — never a printed label. A
   * closing barline opens no bar and carries the ordinal one past the final bar.
   * → docs/archive/music-module-build.md#barline-anchor
   */
  bar_index: number
}

/** One tapped beat — the TEMPORAL half (§A4: "the student taps the beat (counts 1-2-3-4) once"). */
export interface BeatMapEntry {
  time_sec: number
  /** 0-based bar ORDINAL. See BarRef. */
  bar_index: number
  /** 1-based beat WITHIN the bar, as counted aloud: "1-2-3-4". Musicians count from one, and this
   *  is a number a human taps rather than a key anything joins on. */
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

/** §1's field names, kept verbatim. `start_bar`/`end_bar` are 0-based bar ORDINALS (see BarRef) —
 *  a span is an ordinal fact, same as the heatmap's. Step 4; nothing consumes this yet. */
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
 * ⚠️ A practice session is a REFERENCE into the productivity ledger, never a copy of one — the
 * ledger owns the measurement (`productivity/types.ts` SessionRow), and a second copy of a measured
 * number is how a narrative ends up contradicting the bars.
 * → docs/archive/music-module-build.md#practice-session-ref
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

/**
 * A MASTER SCORE ID — `MasterMeta.id` from `music/master.ts`. ⚠ NOT an `AssetRef`: resolve it with
 * `loadMasterXml(id)`, NEVER `getAsset`, which resolves a per-piece path and returns `null` for a
 * master id — surfacing as "this score has no notation", silently, on exactly the MusicXML-path
 * Pieces. Both are `string` aliases, so the wrong call still compiles; the distinct name is the
 * warning and `pieceSource.test.ts` is the guard.
 * → docs/archive/music-module-build.md#master-ref
 */
export type MasterRef = string

export interface MusicXmlSource {
  type: 'musicxml'
  /**
   * The `.musicxml`/`.mxl` master, stored ONCE and deduplicated (§B6) — a `MasterMeta.id`, resolved
   * via `music/master.ts` (`loadMasterXml`), NEVER via `getAsset`. See MasterRef above.
   */
  xml_ref: MasterRef
  /** §B7: set when the piece came from a public-domain corpus, so attribution can be rendered.
   *  Licensing discipline is that lane's (verified public-domain corpora only). */
  corpus?: { name: string; id: string; licence: string; attribution: string }
}

export type PieceSource = PhotoSource | MusicXmlSource

// ─── The Piece ───────────────────────────────────────────────────────────────

export type PieceSchemaVersion = '0.1.0'

/**
 * §1's Piece, implemented field-for-field; this whole object is what goes in the `.studio`.
 * ⚠️ THE SCORE IS MARKUP-ONLY, NEVER EDITABLE (§0) — no field here changes a note, and none may be
 * added. → docs/archive/music-module-build.md#piece-markup-only
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
