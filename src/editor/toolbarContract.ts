// ─── The footer toolbar contract ─────────────────────────────────────────────
// ⚠ THE ONLY WAY A LANE TAKES TOOLBAR REAL ESTATE. Four things exist here and nowhere else; a
// fifth mechanism forks one of them (R2, pre-authorised by three lanes arriving at once).
//   1. A BUTTON    → a member of `SlotId` + `ALL_SLOTS` + a predicate in `SLOT_LIVE`. Row, ▲
//                    drawer, drag-to-reorder, migration and the positional hotkey all follow.
//                    Never touch ROW_SLOTS, SLOT_KEY or `migrateSlots`.
//   2. A BAR ROW   → a member of `BarLayerId`, rendered on `active === 'x'`. The exclusion is the
//                    TYPE, not a convention.
//   3. TWO DOORS   → a slot is a TRIGGER, never an OWNER: lift ONE piece of open state.
//   4. A PER-DOC   → `ToolbarConfig` on the .studio: `readToolbarConfig` (found/absent/error,
//      LAYOUT        never null) · `resolveToolbarRow` to render · `carryToolbarConfig` to travel.
// → docs/archive/editor-surface.md#toolbar-contract
//
// ─── Population 1: the slots (circles) ───────────────────────────────────────
// ONE population: the ROW_SLOTS main-row circles + the ▲ drop-up overflow. S (style) and ⚙
// (settings) are slots too; only ▲ and ⋮ are fixed. A new slot MUST NOT add itself to
// DEFAULT_SLOTS.
import { prodLedgerEnabled } from '../productivity/ledgerFlag'
import { musicEnabled } from '../music/flag'

export type SlotId =
  | 'bib' | 'guide' | 'math' | 'receipt' | 'page' | 'style' | 'settings'
  // ─ the 2026-07-17 arrivals ─
  | 'media' // photo / audio / video import — an EDITOR capability, not a music one
  | 'music' // feat/music-piece-photo — owns the music BAR LAYER (see below)
  | 'clock' // feat/prod-ledger — opens the Pomodoro/ledger drop-up (TWO access paths; see below)

export const SLOT_KEY = 'inkwave-toolbar-slots'

// SIX, and the number is CONTINUITY, not a budget to fight: the phone row is `(100vw − 45px)/N`
// (index.css .iw-phone-toolbar) across ▲ + the row + ⋮, and six keeps every circle above the 44px
// tap target on a 320px screen while desktop shows the SAME six. Changing it is Peter's call.
// The toolbar is a homescreen you rearrange per task, so hold-drag reorder is the PRIMARY
// interaction, not a power-user setting. → docs/archive/editor-surface.md#toolbar-row-six
export const ROW_SLOTS = 6

// Canonical order of the whole population. New arrivals go at the END: a member's position here
// is what an existing writer's stored order is migrated AGAINST, so reordering this list
// silently reshuffles real toolbars.
export const ALL_SLOTS: readonly SlotId[] = [
  'bib', 'guide', 'math', 'receipt', 'page', 'style', 'settings', 'clock', 'music', 'media',
]

// THE FIRST-RUN SIX — Peter's own list. Its scope is ONLY a writer who has NOTHING (a first-ever
// window, or incognito): a new document takes the writer's stored layout, a received one takes its
// author's. Nothing absent from here is "evicted" — an existing order is migrated, not replaced.
// → docs/archive/editor-surface.md#toolbar-first-run
export const DEFAULT_SLOTS: readonly SlotId[] = ['page', 'style', 'guide', 'settings', 'media', 'receipt']

// ─── Registered ≠ LIVE ───────────────────────────────────────────────────────
// ⚠ A slot that cannot render must reach neither the row, the ▲ drawer nor the drag machinery, or
// the writer gets a circle that does nothing. The two causes — no lane yet, and a default-OFF flag
// — are the same cause and get ONE predicate here (R2: the ledger lane had already written this
// rule a second time). → docs/archive/editor-surface.md#toolbar-slot-live
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
  media: () => true, // photo/audio/video import — landed 2026-07-17
  // feat/music-piece-photo — the music BAR trigger, behind the SAME flag the music module ships
  // behind, so this slot and the bar's body turn on together.
  music: musicEnabled,
}

/** Is this slot renderable right now? The ONE definition of "shows up". */
export function slotIsLive(id: SlotId): boolean {
  return SLOT_LIVE[id]?.() ?? false
}

/** The population, minus anything that cannot render. Flag-sensitive: never cache this. */
export function livePopulation(): SlotId[] {
  return ALL_SLOTS.filter(slotIsLive)
}

// The buttons that were FIXED before they became slots, so a legacy 4-slot config predates them
// and gains them first ("legacy 4 migrates by appending style,settings").
const FORMERLY_FIXED: readonly SlotId[] = ['style', 'settings']

/**
 * The migration. Any vintage, any corruption → the ROW: exactly ROW_SLOTS live, unique slots.
 *
 * GENERATIONAL, NEVER A RESET: KEEP what is still live in the writer's own order, FILL the rest
 * from canonical order. The shipped `parsed.length === 4` rule answered one historical question
 * and reset the toolbar for every other shape. → docs/archive/editor-surface.md#toolbar-migrate
 */
export function migrateSlots(stored: unknown): SlotId[] {
  // Resolve against what RENDERS, not merely what is registered: a row is a set of real buttons.
  const live = livePopulation()
  const valid = new Set<string>(live)
  const kept: SlotId[] = []
  if (Array.isArray(stored)) {
    for (const raw of stored) {
      // Drop unknowns and duplicates rather than failing the whole config: a writer who once had
      // a button we removed keeps the rest of their order.
      if (typeof raw === 'string' && valid.has(raw) && !kept.includes(raw as SlotId)) {
        kept.push(raw as SlotId)
      }
    }
  }
  // Nothing usable ⇒ the first-run six leads the fill, and anything in it with no button yet falls
  // through to the next canonical member, so the row is always six REAL buttons.
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
  return migrateSlots(readStoredRow())
}

/**
 * The writer's OWN last layout, raw and unmigrated — `null` when they have none.
 *
 * ⚠ R1: "never curated a toolbar" is not "curated the default six". Collapsing them leaves the
 * first-run fallback unable to tell a fresh install from a deliberate choice.
 * → docs/archive/editor-surface.md#toolbar-migrate
 */
export function readStoredRow(): SlotId[] | null {
  try {
    const raw = localStorage.getItem(SLOT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as SlotId[]) : null
  } catch {
    return null
  }
}

/** Persist the writer's layout as their default for the NEXT new document. */
export function saveStoredRow(row: readonly SlotId[]): void {
  try { localStorage.setItem(SLOT_KEY, JSON.stringify(row)) } catch {}
}

// ─── Hotkeys: the row IS the speed dial ──────────────────────────────────────
// POSITIONAL — Alt+3 means THE THIRD CIRCLE, so the binding moving when you reorder IS the design;
// position is identity on a homescreen. NOT Alt+<letter>: Firefox on Windows/Linux (Peter's own
// browser) binds Alt+F/E/V/S/B/T/H to the menu bar, while Alt+digit is unbound in both engines.
// The phone renders no hints and loses nothing. → docs/archive/editor-surface.md#toolbar-hotkeys
export const HOTKEY_MOD = 'Alt'

/** Alt+1…Alt+6 address the row by POSITION (1-based). Alt+0 opens the ▲ drawer. */
export const SLOT_HOTKEY_MAX = ROW_SLOTS

/**
 * Which row index a digit addresses, or null if that digit addresses nothing. Null for '0'
 * deliberately: folding the drawer in makes "Alt+0 is index -1" a number someone indexes with.
 */
export function slotIndexForDigit(digit: string): number | null {
  if (!/^[1-9]$/.test(digit)) return null
  const idx = Number(digit) - 1
  return idx < ROW_SLOTS ? idx : null
}

/** The hint shown on the circle while Alt is held (desktop only). */
export function hotkeyHintFor(rowIndex: number): string | null {
  return rowIndex >= 0 && rowIndex < SLOT_HOTKEY_MAX ? String(rowIndex + 1) : null
}

// ─── Population 2: the bar layers (the second toolbar row) ───────────────────
// ONE VARIABLE holding ONE id, so "two layers open at once" is UNREPRESENTABLE rather than
// prevented. A lane owns the bar by adding a member here and rendering on `active === 'x'`; the
// shipped pair of booleans was four states with one illegal, held only by one hand-written
// function (R2). → docs/archive/editor-surface.md#toolbar-bar-layers
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
 * The whole exclusion rule, pure. Tapping the active layer's button closes it; tapping another's
 * swaps to it (collapse, then open). The return type cannot express "two layers open", so any
 * caller, however careless, ends with at most one.
 */
export function planBarToggle(active: BarLayerId | null, which: BarLayerId): BarTogglePlan {
  if (active === which) return { open: null, handoff: false }
  if (active === null) return { open: which, handoff: false }
  return { open: which, handoff: true }
}

// ─── Rule: A SLOT IS A TRIGGER, NEVER AN OWNER ───────────────────────────────
// One panel, ONE lifted piece of open state, N dumb triggers that only call the setter (R2). Two
// booleans for one panel means you have already left the contract. Precedent: the ◈ ReceiptPanel's
// own button and the ▲ drop-up entry both write one `receiptOpen`; the clock's slot and the
// top-right countdown both write one `ledgerOpen`. → docs/archive/editor-surface.md#toolbar-trigger

// ─── The .studio toolbar config ──────────────────────────────────────────────
// The layout is per-DOCUMENT and task-based: a score gets music tools, an essay writing tools.
// ⚠ IT IS OUTSIDE THE PROVENANCE HASH AND MUST STAY THERE — rearranging your buttons must not read
// as tampering with your thesis. Probed, not assumed, and pinned by `toolbarHash.test.ts` against
// the real snapshot + verify chain. → docs/archive/editor-surface.md#toolbar-config
export interface ToolbarConfig {
  /** Versioned from birth: the shape is a wire contract the moment a .studio carries it. */
  v: 1
  /** The speed dial, in order. Read through migrateSlots — never trusted raw. */
  row: SlotId[]
}

/**
 * A read of a document's toolbar config. ⚠ **NO `null` MEMBER, DELIBERATELY** (R1, the `RemoteRead`
 * pattern): a FAILED read and an ABSENT one are different words and the type keeps them different.
 * → docs/archive/editor-surface.md#toolbar-config
 */
export type ToolbarConfigRead =
  /** `row` is MIGRATED for rendering here and now; `config` is the author's order VERBATIM. The
   *  two differ on purpose — migration is a RENDER rule, and baking it in is a lossy write. */
  | { kind: 'found'; row: SlotId[]; config: ToolbarConfig }
  | { kind: 'absent' }                    // no config — a pre-2026-07-17 document, or an uncurated one
  | { kind: 'error'; reason: string }     // present but unreadable — NEVER silently a default

/**
 * ⚠ THE DISTINCTION IS ABOUT WHAT WE WRITE, NOT WHAT WE RENDER: both 'absent' and 'error' render
 * the same fallback row, but only 'found'/'absent' may be written back. Persisting a resolved
 * default over a config we merely FAILED TO PARSE is a read failure causing the write that
 * destroys the thing it could not read. → docs/archive/editor-surface.md#toolbar-config
 */
export function readToolbarConfig(raw: unknown): ToolbarConfigRead {
  if (raw === undefined || raw === null) return { kind: 'absent' }
  if (typeof raw !== 'object') return { kind: 'error', reason: 'not an object' }
  const cfg = raw as Partial<ToolbarConfig>
  if (cfg.v !== 1) return { kind: 'error', reason: `unknown version ${String(cfg.v)}` }
  if (!Array.isArray(cfg.row)) return { kind: 'error', reason: 'row is not an array' }
  // migrateSlots returns exactly ROW_SLOTS valid unique members from ANY input, and ▲/⋮ are fixed
  // chrome rather than slots — so "a received document locks me out" is unrepresentable.
  return { kind: 'found', row: migrateSlots(cfg.row), config: { v: 1, row: registeredOnly(cfg.row) } }
}

/** Registered ids, in the given order, no duplicates. NOT filtered by liveness — see carryToolbarConfig. */
function registeredOnly(row: readonly unknown[]): SlotId[] {
  const known = new Set<string>(ALL_SLOTS)
  const out: SlotId[] = []
  for (const raw of row) {
    if (typeof raw === 'string' && known.has(raw) && !out.includes(raw as SlotId)) out.push(raw as SlotId)
  }
  return out
}

/**
 * The config as it TRAVELS — into a .studio and back out. Verbatim order, registered ids only,
 * `undefined` when absent or unreadable (an unreadable config is DROPPED, not repaired).
 *
 * ⚠ **MIGRATION IS A RENDER RULE — KEEP IT OUT OF THE BYTES.** `migrateSlots` resolves against the
 * FLAG-SENSITIVE `livePopulation()`, so migrating in or out deletes a flagged-off `clock` from the
 * author's own file, permanently, at the next save. → docs/archive/editor-surface.md#toolbar-carry
 */
export function carryToolbarConfig(raw: unknown): ToolbarConfig | undefined {
  const read = readToolbarConfig(raw)
  return read.kind === 'found' ? read.config : undefined
}

/**
 * The config to WRITE after a rearrange — the third site of the render-rule partition above. The
 * UI hands back a MIGRATED row, so persist it raw and every drag deletes the author's flagged-off
 * slots. KEEP WHAT THE WRITER COULD NOT HAVE CHOSEN TO DROP: a LIVE slot missing from the new row
 * was demoted deliberately (drawer membership is DERIVED) and must not resurrect; a never-renderable
 * one was the flag's doing. → docs/archive/editor-surface.md#toolbar-carry
 */
export function mergeRowIntoConfig(existing: unknown, row: readonly SlotId[]): ToolbarConfig {
  const kept = carryToolbarConfig(existing)?.row.filter(id => !slotIsLive(id) && !row.includes(id)) ?? []
  return { v: 1, row: [...row, ...kept] }
}

/**
 * THE RESOLUTION CHAIN: document config → the writer's own global order → DEFAULT_SLOTS. A received
 * document's layout DOES apply (that is the feature), and the global order stays the writer's
 * default, so a document with no config uses THEIRS. Factory per-docType defaults, if ever wanted,
 * slot in HERE as one more link — never as a second mechanism.
 * → docs/archive/editor-surface.md#toolbar-resolve
 */
export function resolveToolbarRow(read: ToolbarConfigRead, globalRow: readonly SlotId[] | null): SlotId[] {
  if (read.kind === 'found') return read.row
  // EVERY path resolves through migrateSlots — including this one. Returning DEFAULT_SLOTS raw
  // smuggled an unbuilt button into the row that the normal path filters out.
  return migrateSlots(globalRow ?? null)
}

/** May a resolved row be persisted back into this document? Never on a failed read. */
export function mayPersistConfig(read: ToolbarConfigRead): boolean {
  return read.kind !== 'error'
}
