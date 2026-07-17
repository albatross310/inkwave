// ─── The footer toolbar contract ─────────────────────────────────────────────
// OWNER: the toolbar lane. Three lanes (feat/prod-ledger, feat/music-piece-photo,
// feat/music-musicxml) take toolbar real estate at once; this module is the ONE way they get it.
//
// WHY THIS FILE EXISTS AT ALL: this codebase's recurring wound is two implementations of one
// rule (staticPagination's orphan-snap vs the editor's; textRender's duplicate runOf; the
// email lane's competing docTypeOf). Three lanes inventing a slot/layer mechanism independently
// is that wound, pre-authorised. So the rules below are STRUCTURAL where they can be — a
// second mechanism must be unrepresentable, not merely discouraged — and pinned by tests that
// are mutation-proved to FIRE (toolbarContract.test.ts).

// ─── Population 1: the slots (circles) ───────────────────────────────────────
// ONE population (CLAUDE.md 2026-07-12): the ROW_SLOTS main-row circles + the ▲ drop-up
// overflow. S (style) and ⚙ (settings) are slots too; only ▲ and ⋮ are fixed.
//
// A LANE ADDS A BUTTON BY ADDING ONE MEMBER TO SlotId + ALL_SLOTS. Nothing else. It does not
// touch the row size, the storage key, or the migration — and it MUST NOT add itself to
// DEFAULT_SLOTS (see below).
import { prodLedgerEnabled } from '../productivity/ledgerFlag'

export type SlotId =
  | 'bib' | 'guide' | 'math' | 'receipt' | 'page' | 'style' | 'settings'
  // ─ the 2026-07-17 arrivals ─
  | 'media' // photo / audio / video import — an EDITOR capability, not a music one
  | 'music' // feat/music-piece-photo — owns the music BAR LAYER (see below)
  | 'clock' // feat/prod-ledger — opens the Pomodoro/ledger drop-up (TWO access paths; see below)

export const SLOT_KEY = 'inkwave-toolbar-slots'

// THE TOOLBAR IS A HOMEPAGE, NOT A PLATONIC FIXED THING. Peter, 2026-07-17, and it is the design
// brief rather than a flourish: "we're disrupting the whole ethos of a toolbar is a fixed
// platonified thing to making it more like a toolbar is like your app homepage. You define what
// apps sit on your homepage." So SIX is a phone homescreen row, ▲ is the app drawer, and the
// hold-drag-to-reorder machinery is the PRIMARY interaction — not a power-user setting. Design for
// someone rearranging this often, per task.
//
// SIX, AND THE REASON IS CONTINUITY. Peter: "there's only 6 slots not 7 which I think is a good
// number because it fits well on phone… we want to keep the phone and desktop experience
// continuous." The phone row is sized `(100vw − 45px)/N` (index.css .iw-phone-toolbar) across
// ▲ + the row + ⋮; six keeps every circle above the 44px tap target on a 320px iPhone SE, and
// desktop shows the SAME six so the two devices teach one layout. This number is not a budget to
// fight — it is what keeps one experience. Changing it is Peter's call, not a lane's.
export const ROW_SLOTS = 6

// Canonical order of the whole population. New arrivals go at the END: a member's position here
// is what an existing writer's stored order is migrated AGAINST, so reordering this list
// silently reshuffles real toolbars.
export const ALL_SLOTS: readonly SlotId[] = [
  'bib', 'guide', 'math', 'receipt', 'page', 'style', 'settings', 'clock', 'music', 'media',
]

// THE FIRST-RUN SIX — Peter's own list, verbatim: "we can set up a default standard for the first
// time you open a window or in incognito etc. which will be like page, style, info, settings,
// media import, review". ('info' is the guide menu — the `i` circle.)
//
// ITS SCOPE IS NARROW AND THAT MATTERS. This is NOT "the toolbar". It is the fallback for a writer
// who has NOTHING — a first-ever window, or incognito. Three states, and only the first uses this:
//   · first run / incognito  → this array
//   · a NEW document         → whatever config is in OPFS (the writer's own last layout)
//   · a RECEIVED document    → its author's layout (signed-in writers can apply a saved preset)
// So nobody is "evicted" by what is absent here: an existing writer's stored order is migrated, not
// replaced (migrateSlots), and `bib`/`math` stay one click away in ▲ for the writers who want them.
export const DEFAULT_SLOTS: readonly SlotId[] = ['page', 'style', 'guide', 'settings', 'media', 'receipt']

// ─── Registered ≠ LIVE ───────────────────────────────────────────────────────
// A registered slot may not be renderable YET, and there are exactly two reasons — which are the
// same reason, and so they get ONE mechanism:
//   · its lane has not shipped a button (`media`: Peter's first-run six names it before it exists)
//   · it is behind a default-OFF flag (`clock`: `?prodLedger`)
// Either way the id must not reach the row, the ▲ drawer or the drag machinery, or the writer gets
// a circle that does nothing.
//
// RECONCILED 2026-07-17 with feat/prod-ledger, which landed the clock before this contract existed
// and had reached the same instinct from the other side: flag-conditional `allSlots()`/
// `defaultSlots()`/`slotCount()` triples, dropping a stored `clock` "so a stored 7-row can't strand
// an unrenderable id". That is exactly this rule, written a second time — which is the wound this
// file exists to close. So their gate is GONE and their guarantee is kept here, generalised: a lane
// declares WHEN its slot is live and everything else follows. `clock` keeps its flag; nothing about
// the ledger's behaviour changes for anyone.
const SLOT_LIVE: Record<SlotId, () => boolean> = {
  bib: () => true,
  guide: () => true,
  math: () => true,
  receipt: () => true,
  page: () => true,
  style: () => true,
  settings: () => true,
  // feat/prod-ledger — the Pomodoro/ledger drop-up. Default OFF; the countdown is the other door.
  clock: prodLedgerEnabled,
  // Registered, not yet built. Flip to `() => true` in the same line the button starts rendering.
  media: () => false,   // awaiting the media-import lane (photo/audio/video) — Peter's six names it
  music: () => false,   // awaiting feat/music-piece-photo
}

/** Is this slot renderable right now? The ONE definition of "shows up". */
export function slotIsLive(id: SlotId): boolean {
  return SLOT_LIVE[id]?.() ?? false
}

/** The population, minus anything that cannot render. Flag-sensitive: never cache this. */
export function livePopulation(): SlotId[] {
  return ALL_SLOTS.filter(slotIsLive)
}

// The buttons that were FIXED before they became slots. A legacy 4-slot config predates them, so
// they are appended first — this is CLAUDE.md's "legacy 4 migrates by appending style,settings",
// kept verbatim in behaviour and generalised in mechanism (see migrateSlots).
const FORMERLY_FIXED: readonly SlotId[] = ['style', 'settings']

/**
 * The migration. Takes whatever is in localStorage (any vintage, any corruption) and returns the
 * ROW: exactly ROW_SLOTS live, unique slots.
 *
 * THE 4→6 PRECEDENT, GENERALISED — and the generalisation is the point. The shipped rule keyed on
 * `parsed.length === 4` and demanded an exact length, so it answered exactly one historical
 * question and RESET the writer's toolbar for every other shape (a stored 5, a retired id, and —
 * the live trap — any future row-size change). This rule is generational instead: KEEP what is
 * still live, in the writer's own order; FILL what is missing from canonical order; never reset
 * unless there is nothing usable to keep.
 */
export function migrateSlots(stored: unknown): SlotId[] {
  // Resolve against what RENDERS, not merely what is registered: a row is a set of real buttons.
  // This is what keeps Peter's first-run six honest while `media` waits for its lane, and what
  // keeps feat/prod-ledger's promise that a stored `clock` cannot strand an unrenderable id.
  const live = livePopulation()
  const valid = new Set<string>(live)
  const kept: SlotId[] = []
  if (Array.isArray(stored)) {
    for (const raw of stored) {
      // Drop unknowns (a retired id, or a flagged-off one) and duplicates rather than failing the
      // whole config: a writer who once had a button we removed keeps the rest of their order.
      if (typeof raw === 'string' && valid.has(raw) && !kept.includes(raw as SlotId)) {
        kept.push(raw as SlotId)
      }
    }
  }
  // Nothing usable — a first-ever window, incognito, or a config we cannot read at all. Peter's
  // first-run six leads the fill; anything in it that has no button yet falls through to the next
  // canonical member, so the row is always six REAL buttons.
  const fill = kept.length === 0
    ? [...DEFAULT_SLOTS, ...FORMERLY_FIXED, ...live]
    : [...FORMERLY_FIXED, ...live]   // a legacy 4 gains style+settings first (the shipped rule)

  for (const id of fill) {
    if (kept.length >= ROW_SLOTS) break
    if (valid.has(id) && !kept.includes(id)) kept.push(id)
  }
  return kept.slice(0, ROW_SLOTS)
}

/** The ▲ drawer: the live population minus the row, in canonical order. */
export function overflowSlots(row: readonly SlotId[]): SlotId[] {
  return livePopulation().filter(id => !row.includes(id))
}

/** Read + migrate. The ONLY reader of SLOT_KEY. */
export function loadToolbarSlots(): SlotId[] {
  try {
    const raw = localStorage.getItem(SLOT_KEY)
    return migrateSlots(raw ? JSON.parse(raw) : null)
  } catch {
    return migrateSlots(null)
  }
}

// ─── Population 2: the bar layers (the second toolbar row) ───────────────────
// Peter's word is "mutually exclusive": R and music cannot both own the bar.
//
// THE SHIPPED MUTUAL EXCLUSION IS A CONVENTION, NOT A STRUCTURE — and that is the bug waiting to
// happen. Today the state is TWO booleans (styleBarOpen, reviewOpen) = FOUR states, one of which
// ("both open") is illegal and is prevented ONLY by the discipline of a single function that
// hard-codes the pair. A third member turns 4 states into 8 and 1 illegal state into 4, and the
// function that must remember all of them is hand-written. That is how "identical policy" comments
// come to sit above rules that have quietly diverged.
//
// So the state is ONE VARIABLE holding ONE id. Two layers open at once is not "prevented" — it is
// UNREPRESENTABLE. A lane owns the bar by adding a member here and rendering on `active === 'x'`.
export type BarLayerId =
  | 'style'  // StyleBar — the formatting row
  | 'review' // ReviewBar — comments + track changes (LIVE on master; see the report)
  | 'music'  // feat/music-piece-photo — [turn this photo into a piece] / [add youtube/mp3]

/** How long the outgoing layer takes to collapse before the incoming one opens (max-height 220ms
 *  + slack). One constant: a per-lane copy is how two layers come to overlap mid-handoff. */
export const BAR_HANDOFF_MS = 240

export interface BarTogglePlan {
  /** The layer that must end up open — null closes the bar entirely. */
  open: BarLayerId | null
  /** True when a DIFFERENT layer is currently open and must collapse first: the caller opens
   *  `open` after BAR_HANDOFF_MS, guarded by a sequence number so a fast double-tap cannot land
   *  a stale open on top of a newer one. */
  handoff: boolean
}

/**
 * The whole exclusion rule, pure. Tapping the active layer's button closes it; tapping another
 * layer's button swaps to it (collapse, then open).
 *
 * THE GUARANTEE THIS CARRIES: the return type cannot express "two layers open". Any caller,
 * however careless, ends with at most one. That is the property CLAUDE.md's toolbar section asks
 * for and the current booleans only promise.
 */
export function planBarToggle(active: BarLayerId | null, which: BarLayerId): BarTogglePlan {
  if (active === which) return { open: null, handoff: false }
  if (active === null) return { open: which, handoff: false }
  return { open: which, handoff: true }
}

// ─── Rule: A SLOT IS A TRIGGER, NEVER AN OWNER ───────────────────────────────
// Peter, 2026-07-17, on the Pomodoro: "the pomedoro can be accessed two ways. Like the provedence
// snapshots." That names the precedent exactly, and it is already in this file's neighbour —
// READ IT BEFORE BUILDING A SECOND WAY IN. `ReceiptPanel` (◈) is reachable twice today:
//   · it renders its OWN ◈ button (ReceiptPanel.tsx ~L158), and
//   · TiptapEditor LIFTS the state (`receiptOpen`) and passes `open`/`onOpenChange`, so the ▲
//     drop-up's phone entry (~L2946) writes that SAME state.
// One panel. One piece of open state, owned by the toolbar. N dumb triggers that only call the
// setter. THAT is how a feature gets two front doors without getting two implementations — and it
// is why the clock's toolbar slot and the top-right countdown are not a fork: both are triggers
// writing one `ledgerOpen`. If a lane finds itself with two booleans for one panel, it has already
// left the contract.

// ─── The .studio toolbar config ──────────────────────────────────────────────
// Peter, 2026-07-17: "we should encode the toolbar configuration into a .studio document." The
// layout becomes per-DOCUMENT and task-based — a score gets music tools, an essay gets writing
// tools — rather than one global preference.
//
// ⚠ THE SCHEMA CHANGE (`toolbar?: ToolbarConfig` on InkwaveDocument, types/document.ts) IS NOT
// APPLIED HERE — it is coordinated with Peter first. The shape and the rules are settled below so
// the three lanes can build against them.
//
// PROBED, not assumed, because the question was "is this inside the Bitcoin-anchored hash?":
// **NO, AND IT CANNOT BE.** `contentHash(contentJson)` (provenance/hash.ts L66) hashes ONLY the
// contentJson — never the InkwaveDocument — and `bundleHash` folds four EXPLICIT arguments
// (contentHash · bibHash · emailHash · musicHash). So a new document field cannot ride in; it
// would take someone deliberately adding it. That is the right answer and the precedent agrees:
// the music lane excluded per-master titles/`addedAt` from v:4 because "a corpus renaming a piece
// must not read as a tamper". Rearranging your buttons must not read as tampering with your thesis.
// PRECEDENT for travelling at all: `citationStyle`, `scasLimitN` and `docType` are already
// document-level preferences that travel in the .studio and already sit outside the anchored hash.
// This is that same class of field — not a new kind of thing.
export interface ToolbarConfig {
  /** Versioned from birth: the shape is a wire contract the moment a .studio carries it. */
  v: 1
  /** The speed dial, in order. Read through migrateSlots — never trusted raw. */
  row: SlotId[]
}

/**
 * A read of a document's toolbar config. **NO `null` MEMBER, DELIBERATELY** — this is the
 * `RemoteRead` pattern from `productivity/ledgerRemotes.ts`, and it exists because of the
 * 2026-07-15 incident: `readJson`'s `catch { return null }` made a FAILED read indistinguishable
 * from an ABSENT one, Edit.tsx answered null by minting a blank document, and it destroyed a day
 * of Peter's real honours-proposal annotations. 'absent' and 'error' are different words and the
 * type system enforces that they stay different.
 */
export type ToolbarConfigRead =
  | { kind: 'found'; row: SlotId[] }
  | { kind: 'absent' }                    // no config — a pre-2026-07-17 document, or an uncurated one
  | { kind: 'error'; reason: string }     // present but unreadable — NEVER silently a default

/**
 * WHY THE DISTINCTION IS LOAD-BEARING HERE, since a toolbar cannot lose a thesis: it is about what
 * we WRITE, not what we render. Both 'absent' and 'error' RENDER the same fallback row (the writer
 * always gets a working toolbar — see resolveToolbarRow). But only 'found'/'absent' may be written
 * back: persisting a resolved default over a config we merely FAILED TO PARSE is the blind
 * overwrite of 2026-07-15 in miniature — a read failure causing a write that destroys the thing it
 * failed to read. On 'error' we render the fallback and leave the document's bytes alone.
 */
export function readToolbarConfig(raw: unknown): ToolbarConfigRead {
  if (raw === undefined || raw === null) return { kind: 'absent' }
  if (typeof raw !== 'object') return { kind: 'error', reason: 'not an object' }
  const cfg = raw as Partial<ToolbarConfig>
  if (cfg.v !== 1) return { kind: 'error', reason: `unknown version ${String(cfg.v)}` }
  if (!Array.isArray(cfg.row)) return { kind: 'error', reason: 'row is not an array' }
  // A config that survives to here is still passed through migrateSlots by the caller: a hostile
  // or truncated `row` cannot produce an unreachable toolbar, because migrateSlots returns exactly
  // ROW_SLOTS valid unique members from ANY input. ▲ and ⋮ are fixed chrome and are not slots at
  // all, so no config can hide the way back. "A received document locks me out" is unrepresentable.
  return { kind: 'found', row: migrateSlots(cfg.row) }
}

/**
 * THE RESOLUTION CHAIN, and the answer to "does a received document impose its author's seven?"
 *
 * document config → the writer's own global order → DEFAULT_SLOTS.
 *
 * YES, A RECEIVED DOCUMENT'S LAYOUT APPLIES — that IS the feature Peter asked for: open a score,
 * get music tools. It is safe to let it, and the reasons are structural rather than hopeful:
 * a config can only ever name buttons that exist (migrateSlots), can never hide ▲/⋮, is
 * non-destructive, and is one drag to change. The precedent is already shipped and uncontroversial:
 * `citationStyle` travels in a .studio and silently reconfigures your citation rendering on open.
 * A document with NO config uses YOUR order, never a stranger's — so nothing changes for the
 * thousands of existing documents, which is the case that must not regress.
 *
 * AND THE GLOBAL ORDER STAYS THE WRITER'S DEFAULT (localStorage, exactly as today — curation keeps
 * writing it). That is what stops per-document layouts becoming a chore: a new document inherits
 * the writer's latest curated order instead of snapping back to a factory seven. It is also why
 * there is no hardcoded per-docType default table — inheritance gives task-based sevens for free
 * the moment a writer curates one, without anybody guessing what a score's seven should be before
 * the music bar exists. If Peter wants factory-seeded per-type defaults later, they slot in HERE,
 * as one more link in this chain, not as a second mechanism.
 */
export function resolveToolbarRow(read: ToolbarConfigRead, globalRow: readonly SlotId[] | null): SlotId[] {
  if (read.kind === 'found') return read.row
  // EVERY path resolves through migrateSlots — including the first-run one. Returning DEFAULT_SLOTS
  // raw was a real bug its own test caught: the array names `media`, whose lane has not landed, so
  // the fallback smuggled an unbuilt button into the row that the normal path filters out.
  return migrateSlots(globalRow ?? null)
}

/** May a resolved row be persisted back into this document? Never on a failed read. */
export function mayPersistConfig(read: ToolbarConfigRead): boolean {
  return read.kind !== 'error'
}
