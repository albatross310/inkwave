import { Extension } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { lemmaOf, inPool } from '../../scas/engine'
import { isColoured, type ScasLookup } from '../../scas/state'

// TEMPORARY debug aid (NOT for the final product — a no-paste feature is coming): highlight EVERY
// constrainable (pool) word, so pasted/typed text lights up densely for testing the word-cycle
// animation. Off by default. Turn on with `?debughl=1` (works on the live site too) or via the
// dev-only Options menu toggle (localStorage `inkwave:debugHighlightAll`).
// User switch (Settings): turn the SCAS vocabulary suggestions off entirely — no green words, nothing
// to cycle. The provenance engine still runs underneath; this only suppresses the display + interaction.
export function scasSuggestionsOff(): boolean {
  if (typeof window === 'undefined') return false
  try { return window.localStorage.getItem('inkwave:scasOff') === '1' } catch { return false }
}

function debugHighlightAll(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (new URLSearchParams(window.location.search).get('debughl') === '1') return true
    return window.localStorage.getItem('inkwave:debugHighlightAll') === '1'
  } catch {
    return false
  }
}
import type { InkwaveDocument } from '../../types/document'
import { REFLOW_OPEN_MS, REFLOW_EASE, ANIMATE_COMPRESSION, type LineRange } from '../suggestions/ThesaurusPopover/popoverConstants'
import { slotTimeMode } from '../crossout'

// Plugin state: the decoration set plus the "reveal" anchors (see SCAS_REVEAL_META).
interface RedHighlightState {
  decorations: DecorationSet
  // Slot start-positions whose cross-out/stamp must start HIDDEN this rebuild (opacity 0, no
  // transition), then fade in once the anchor is cleared a double-rAF later. Session-scoped,
  // transient (S_v-style view state) — never persisted, never enters the provenance hash.
  // ReadonlySet: every update replaces the set wholesale (never mutated in place).
  reveals: ReadonlySet<number>
  // Uncommitted (green) words anchored by position → their original word. Remapped through
  // edits in plugin state — never in the doc — so S_v-driven flagging never enters the
  // provenance hash. Sticky-green: once a word turns green it stays green while the text is
  // still that word or a deletion-remnant (startsWith); released on commit, lock, or delete.
  flagged: Map<number, string>
}

export const RED_HIGHLIGHT_KEY = new PluginKey<RedHighlightState>('redHighlight')

// Dispatch a transaction with this meta key to force a hint rebuild without
// changing the document (e.g. when the popover opens or closes).
// Payload: `true` = full-document rebuild (every non-tick dispatcher). The phone typing tick may
// instead pass `{ window }` — the tick's edit+caret range — and only the paragraphs intersecting
// it are rebuilt and SPLICED into the existing set (decorations elsewhere are untouched; they were
// position-mapped through the edits and no state outside the window changed — the editor only
// sends a window when the SCAS state did NOT change, so no other instance of any lemma can need a
// repaint). Full-doc rebuilds were O(doc) on every 250ms pause — the phone inter-word stutter.
export const SCAS_HINT_META = 'scasHintUpdate'
export type ScasHintMeta = true | { window: { from: number; to: number } }

// A CHANGED commit replaces the word's text, so ProseMirror builds a FRESH decoration element —
// the cross-out/stamp opacity transition then has no prior value to animate from and would POP in.
// Dispatch `{ pos }` right after the swap to start that slot hidden; dispatch `{ clear: true }` a
// double-rAF later so the now-persisted element transitions 0 → visible (after the ghost).
export const SCAS_REVEAL_META = 'scasRevealUpdate'

// SCAS WINDOWED RENDERING (flag `inkwave:scasWindow`, default OFF). The verdict SCAN stays doc-wide
// (redWords, flagged, engine) — only which verdicts currently have a LIVE Decoration object is
// windowed to the viewport (+ a generous margin). The lever: the per-keystroke DecorationSet.map()
// is O(decorated words), and a thesis lights ~2,600 (~22ms/keystroke, 4× throttle). Dispatch this
// meta with the viewport's doc range {from,to} (from the scroll listener) to re-window. STATE is
// never touched — flagged words stay REMEMBERED off-screen; only their paint is deferred.
export const SCAS_WINDOW_META = 'scasWindowUpdate'
export function scasWindowOn(): boolean {
  if (typeof window === 'undefined') return false
  try { return window.localStorage.getItem('inkwave:scasWindow') === '1' } catch { return false }
}

const WORD_RE = /[a-zA-Z]+/g

export interface HintState {
  focusedPos: number | null
  showHints: boolean
  focusedMinWidth: number | null
  // Right-preferring letter-spacing compression around the focused word (see LineRange):
  // the after-side absorbs the box expansion so the word keeps its natural x; the before-side
  // only compresses when the word is too near the margin for the right to take it all.
  lineCompressionRange: LineRange | null
  // Whether the min-width / letter-spacing changes should CSS-transition. False applies them
  // instantly — used for the START (jump-to-natural) of an open and for snap (wrap) commits, so
  // a reused decoration node never animates from the previous word's reserved width (overflow flash).
  animate: boolean
  // Transition duration for this change (open is snappy, commit/close is a slower settle).
  durationMs: number
}

const EMPTY_LOOKUP: ScasLookup = {
  version: 0,
  locked: new Set(),
  liveKicks: new Set(),
  immune: new Set(),
}

// Shared empty reveal set — avoids allocating a new Set on every rebuild that has no reveals.
const EMPTY_REVEALS: ReadonlySet<number> = new Set<number>()

export interface RedHighlightOptions {
  getDoc: () => InkwaveDocument
  getHintState: () => HintState
  getScasLookup: () => ScasLookup
}

/** Extract the current set of anchored-green word strings from editor state (for autosave). */
export function getGreenAnchors(state: import('@tiptap/pm/state').EditorState): string[] {
  const plugin = RED_HIGHLIGHT_KEY.getState(state)
  if (!plugin?.flagged.size) return []
  const doc = state.doc
  const words = new Set<string>()
  plugin.flagged.forEach((original, pos) => {
    try { if (doc.nodeAt(pos)?.isText) words.add(original) } catch { /* position shifted */ }
  })
  return [...words]
}

/** Build the initial flagged map from persisted anchor words by scanning the PM document. */
function initialFlaggedFromAnchors(pmDoc: PMNode, anchors: string[]): Map<number, string> {
  if (!anchors.length) return new Map()
  const anchorSet = new Set(anchors.map(w => w.toLowerCase()))
  const flagged = new Map<number, string>()
  pmDoc.descendants((node: PMNode, pos: number) => {
    if (!node.isText || !node.text) return true
    WORD_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = WORD_RE.exec(node.text)) !== null) {
      const word = match[0]
      if (anchorSet.has(word.toLowerCase())) {
        const from = pos + match.index
        flagged.set(from, word)
      }
    }
    return true
  })
  return flagged
}

export const RedHighlightExtension = Extension.create<RedHighlightOptions>({
  name: 'redHighlight',

  addOptions() {
    return {
      getDoc: () => { throw new Error('RedHighlightExtension: getDoc option is required') },
      getHintState: () => ({ focusedPos: null, showHints: true, focusedMinWidth: null, lineCompressionRange: null, animate: true, durationMs: REFLOW_OPEN_MS }),
      getScasLookup: () => EMPTY_LOOKUP,
    }
  },

  addProseMirrorPlugins() {
    const { getDoc, getHintState, getScasLookup } = this.options
    // The current viewport render window (doc positions), maintained by the scroll listener in
    // view(). null ⇒ render ALL decorations (flag off, or before the first scroll sample).
    let winRange: { from: number; to: number } | null = null
    const getRW = () => (scasWindowOn() ? winRange : null)
    return [
      new Plugin({
        key: RED_HIGHLIGHT_KEY,
        state: {
          init(_, state): RedHighlightState {
            const inkDoc = getDoc()
            const savedAnchors = inkDoc.scasGreenAnchors?.length
              ? new Set(inkDoc.scasGreenAnchors.map(w => w.toLowerCase()))
              : undefined
            const initFlagged = savedAnchors ? initialFlaggedFromAnchors(state.doc, [...savedAnchors]) : new Map<number, string>()
            const built = buildDecorations(state.doc, inkDoc, state.selection.from, getHintState(), getScasLookup(), EMPTY_REVEALS, initFlagged, savedAnchors, getRW())
            return { decorations: built.decorations, reveals: EMPTY_REVEALS, flagged: built.flagged }
          },
          apply(tr, old, _prev, next): RedHighlightState {
            const revealMeta = tr.getMeta(SCAS_REVEAL_META) as { pos?: number; clear?: boolean } | undefined
            // CONSOLE-SNAPPY RULE: a keystroke never triggers the full O(doc) rebuild. Ordinary
            // edits + caret moves only position-MAP the existing decorations (cheap); the editor's
            // deferred SCAS tick dispatches SCAS_HINT_META ~120ms after the last input, and THAT
            // (or a reveal) is what rebuilds. Verdicts are frozen at commit anyway, so a ≤120ms
            // repaint delay changes nothing semantically.
            const hintMeta = tr.getMeta(SCAS_HINT_META) as ScasHintMeta | undefined
            // A scroll re-window: adopt the new viewport range and full-rebuild the (windowed) set
            // from the doc-wide verdict. Cheap — the scan rides the per-paragraph WeakMap cache and
            // this only fires on scroll settle, never per keystroke.
            const windowMeta = tr.getMeta(SCAS_WINDOW_META) as { from: number; to: number } | undefined
            if (windowMeta) winRange = windowMeta
            const rebuild = !!hintMeta || !!revealMeta || !!windowMeta
            if (!rebuild && !tr.docChanged) return old

            // Remap the reveal anchors across the edit, then fold in this tr's reveal meta.
            let reveals = old.reveals
            if (tr.docChanged && reveals.size) {
              const mapped = new Set<number>()
              reveals.forEach(pos => {
                const m = tr.mapping.mapResult(pos)
                if (!m.deleted) mapped.add(m.pos)
              })
              reveals = mapped
            }
            if (revealMeta) {
              if (revealMeta.clear) reveals = EMPTY_REVEALS
              else if (typeof revealMeta.pos === 'number') {
                const next = new Set(reveals); next.add(revealMeta.pos); reveals = next
              }
            }

            // Remap flagged anchors through the edit (positions shift; deleted words drop).
            let flagged = old.flagged
            if (tr.docChanged && flagged.size) {
              const mf = new Map<number, string>()
              flagged.forEach((orig, pos) => {
                const m = tr.mapping.mapResult(pos)
                if (!m.deleted) mf.set(m.pos, orig)
              })
              flagged = mf
            }

            if (!rebuild) {
              // Edit without a tick: ride the mapping. Decorations/anchors stay glued to their text.
              return { decorations: old.decorations.map(tr.mapping, tr.doc), reveals, flagged }
            }

            // WINDOWED REBUILD (phone typing tick): rebuild only the window's paragraphs and splice
            // them into the existing set. Guarded to the plain-typing case — a reveal or an open
            // popover (focusedPos) can decorate outside the window, so those take the full path.
            const win = hintMeta && hintMeta !== true && !revealMeta && getHintState().focusedPos === null
              ? hintMeta.window : null
            if (win) {
              // The tick's meta transaction never changes the doc, but stay safe if a window meta
              // ever rides a doc-changing one: splice against the MAPPED set (flagged was already
              // remapped above).
              const base = tr.docChanged ? old.decorations.map(tr.mapping, tr.doc) : old.decorations
              const wb = buildWindowDecorations(next.doc, getDoc(), next.selection.from, getHintState(), getScasLookup(), reveals, flagged, win, getRW())
              if (!wb.bounds) return { decorations: base, reveals, flagged } // no paragraphs in range
              const decorations = base
                .remove(base.find(wb.bounds.from, wb.bounds.to))
                .add(next.doc, wb.list)
              // Anchors outside the window persist untouched (their text didn't change and no state
              // changed); the window's paragraphs adopt the freshly-derived entries.
              const merged = new Map<number, string>()
              flagged.forEach((orig, pos) => { if (pos < wb.bounds!.from || pos >= wb.bounds!.to) merged.set(pos, orig) })
              wb.flagged.forEach((orig, pos) => merged.set(pos, orig))
              return { decorations, reveals, flagged: merged }
            }

            const built = buildDecorations(next.doc, getDoc(), next.selection.from, getHintState(), getScasLookup(), reveals, flagged, undefined, getRW())
            return { decorations: built.decorations, reveals, flagged: built.flagged }
          },
        },
        props: {
          decorations(state) { return RED_HIGHLIGHT_KEY.getState(state)?.decorations },
        },
        // Turning the SCAS DISPLAY on/off (Settings) is a live toggle now — no page reload. It flips
        // localStorage and fires this event; we re-run buildDecorations (which honours
        // scasSuggestionsOff) by dispatching a HINT_META tick. The engine/session are never touched.
        view(editorView) {
          const onChange = () => editorView.dispatch(editorView.state.tr.setMeta(SCAS_HINT_META, true))
          window.addEventListener('inkwave:scas-display-changed', onChange)

          // ── SCAS WINDOWED RENDERING: keep winRange tracking the viewport (± margin) ──
          const dom = editorView.dom as HTMLElement
          const scrollerOf = () => dom.closest('.inkwave-editor-surface.iw-fill:not(.is-phone)') as HTMLElement | null
          // Compute the viewport render window (doc positions) at ± MARGIN screens.
          const computeWide = (): { from: number; to: number; vh: number } | null => {
            const sc = scrollerOf()
            const r = sc ? sc.getBoundingClientRect() : null
            const clientTop = r ? r.top : 0
            const clientBot = r ? r.bottom : window.innerHeight
            const vh = Math.max(1, clientBot - clientTop)
            const margin = vh * 1.5
            const edR = dom.getBoundingClientRect()
            const x = edR.left + Math.min(24, Math.max(2, edR.width / 2))
            const top = editorView.posAtCoords({ left: x, top: clientTop - margin })
            const bot = editorView.posAtCoords({ left: x, top: clientBot + margin })
            const size = editorView.state.doc.content.size
            const from = top ? Math.max(0, top.pos) : 0
            const to = bot ? Math.min(size, bot.pos) : size
            return { from, to, vh }
          }
          let lastWinTop = Number.NEGATIVE_INFINITY
          let raf = 0
          const reWindow = (force: boolean) => {
            if (!scasWindowOn()) return
            const sc = scrollerOf()
            const st = sc ? sc.scrollTop : window.scrollY
            const vh = sc ? sc.clientHeight : window.innerHeight
            // Re-window only after ~0.75 screen of scroll — the ±1.5-screen window always keeps
            // ≥0.75 screen of decorated margin ahead, so a word is painted before it scrolls in.
            if (!force && Math.abs(st - lastWinTop) < vh * 0.75) return
            const w = computeWide()
            if (!w) return
            lastWinTop = st
            editorView.dispatch(editorView.state.tr.setMeta(SCAS_WINDOW_META, { from: w.from, to: w.to }))
          }
          const onScroll = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; reWindow(false) }) }
          const onResize = () => reWindow(true)
          // The desktop surface scrolls; the phone body scrolls — listen to both (scroll doesn't bubble).
          const sc0 = scrollerOf()
          sc0?.addEventListener('scroll', onScroll, { passive: true })
          window.addEventListener('scroll', onScroll, { passive: true })
          window.addEventListener('resize', onResize)
          // Prime the window once the first layout exists (a frame after mount).
          const prime = requestAnimationFrame(() => reWindow(true))

          return {
            destroy() {
              window.removeEventListener('inkwave:scas-display-changed', onChange)
              sc0?.removeEventListener('scroll', onScroll)
              window.removeEventListener('scroll', onScroll)
              window.removeEventListener('resize', onResize)
              if (raf) cancelAnimationFrame(raf)
              cancelAnimationFrame(prime)
            },
          }
        },
      }),
    ]
  },
})

// ---------------------------------------------------------------------------

interface RedWord {
  from: number
  to: number
  pIdx: number
  word: string
  dataWord: string   // synonym-lookup key: the slot's original word (= word, unless managed)
  seqInPara: number  // 1-based — kept for data-scas-n (debugging / future use)
  secondary: boolean // a managed memory slot with a known origin — show its cross-out + first-written
                     // stamp. True even when the current text == the original (reverted): the memory
                     // (and the struck origin below) persists regardless of the current word.
  firstAt: string | null // slot.firstCommitAt (epoch ms, as stored) — when the original was first written
  testOnly: boolean  // visible only because debugAll; NOT in S_v — categorised differently
}

// Time-of-day bin label or date-of-month for the slot's first-written stamp.
// In 'time' mode (default): em 5–8:30, mn 8:30–12, ea 12–15:30, la 15:30–17:30, ev 17:30–19:30, nt 19:30–5.
// In 'date' mode: "DDMM" — e.g. "0501" for 5 January.
function hhmm(raw: string | null): string | null {
  if (!raw) return null
  const ms = Number(raw)
  if (!Number.isFinite(ms) || ms <= 0) return null
  const d = new Date(ms)
  if (slotTimeMode() === 'date') {
    return String(d.getDate()).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0')
  }
  const mins = d.getHours() * 60 + d.getMinutes()
  if (mins < 300)  return 'nt'  // 00:00–05:00
  if (mins < 510)  return 'em'  // 05:00–08:30
  if (mins < 720)  return 'mn'  // 08:30–12:00
  if (mins < 930)  return 'ea'  // 12:00–15:30
  if (mins < 1050) return 'la'  // 15:30–17:30
  if (mins < 1170) return 'ev'  // 17:30–19:30
  return 'nt'                   // 19:30–24:00
}

export function buildDecorations(
  pmDoc: PMNode,
  inkDoc: InkwaveDocument,
  cursorPos: number,
  hintState: HintState,
  lookup: ScasLookup,
  reveals: ReadonlySet<number>,
  flagged: Map<number, string>,
  initialAnchors?: ReadonlySet<string>,
  renderWindow?: { from: number; to: number } | null,
): { decorations: DecorationSet; flagged: Map<number, string> } {
  const newFlagged = new Map<number, string>()
  // SCAS engine off (un-migrated or non-N-mode), or the writer switched suggestions off → no decorations.
  if (inkDoc.scasMode !== 'n' || !inkDoc.scasState || scasSuggestionsOff()) return { decorations: DecorationSet.empty, flagged: newFlagged }

  // ── 1. Collect kicked words (skip the uncommitted word under the cursor) ──────
  // A word is purple iff its lemma is Locked or an outstanding live kick — the frozen verdict
  // from the SCAS controller, NOT a recompute against the current S_v (so rotation never reflows
  // already-committed text). `lemmaOf` collapses inflections to the state key.
  const ctx: ScanCtx = {
    cursorPos, lookup, flagged, newFlagged, initialAnchors,
    debugAll: debugHighlightAll(), // temporary: colour every pool word for animation testing
    redWords: [],
  }
  let paragraphIndex = 0
  pmDoc.descendants((node: PMNode, pos: number) => {
    if (node.type.name !== 'paragraph') return true
    scanParagraphWords(node, pos, paragraphIndex++, ctx)
    return false
  })

  const decorations = decorationsFor(ctx.redWords, hintState, reveals, renderWindow)
  return { decorations: DecorationSet.create(pmDoc, decorations), flagged: newFlagged }
}

// Windowed variant — the phone typing tick's splice source (see apply()). Scans ONLY the
// paragraphs intersecting `window` through the SAME per-paragraph scan as the full build (the two
// paths cannot drift), and returns the raw decoration list plus the actual paragraph bounds so the
// caller can remove/replace exactly that span. `bounds: null` = no paragraphs in range (or SCAS
// display off) — the caller keeps the existing set untouched, which is what a full rebuild would
// have produced for text that didn't change.
export function buildWindowDecorations(
  pmDoc: PMNode,
  inkDoc: InkwaveDocument,
  cursorPos: number,
  hintState: HintState,
  lookup: ScasLookup,
  reveals: ReadonlySet<number>,
  flagged: Map<number, string>,
  window: { from: number; to: number },
  renderWindow?: { from: number; to: number } | null,
): { list: Decoration[]; flagged: Map<number, string>; bounds: { from: number; to: number } | null } {
  const newFlagged = new Map<number, string>()
  if (inkDoc.scasMode !== 'n' || !inkDoc.scasState || scasSuggestionsOff()) return { list: [], flagged: newFlagged, bounds: null }
  const ctx: ScanCtx = { cursorPos, lookup, flagged, newFlagged, debugAll: debugHighlightAll(), redWords: [] }
  // ±1 keeps a collapsed (from === to) window from matching nothing; clamp into the doc.
  const from = Math.max(0, Math.min(window.from - 1, pmDoc.content.size))
  const to = Math.max(from, Math.min(window.to + 1, pmDoc.content.size))
  const paras: Array<{ node: PMNode; pos: number }> = []
  pmDoc.nodesBetween(from, to, (node: PMNode, pos: number) => {
    if (node.type.name !== 'paragraph') return true
    paras.push({ node, pos })
    return false
  })
  if (!paras.length) return { list: [], flagged: newFlagged, bounds: null }
  // data-para must match the full walk's numbering — count the paragraphs strictly before the
  // window's first (cheap: descends containers, never into textblocks).
  let pIdx = 0
  pmDoc.nodesBetween(0, paras[0].pos, (node: PMNode) => {
    if (node.type.name === 'paragraph') { pIdx++; return false }
    return true
  })
  for (const p of paras) scanParagraphWords(p.node, p.pos, pIdx++, ctx)
  const last = paras[paras.length - 1]
  return {
    list: decorationsFor(ctx.redWords, hintState, reveals, renderWindow),
    flagged: newFlagged,
    bounds: { from: paras[0].pos, to: last.pos + last.node.nodeSize },
  }
}

// Shared scan context — everything the per-paragraph word scan reads/writes.
interface ScanCtx {
  cursorPos: number
  lookup: ScasLookup
  flagged: Map<number, string>
  newFlagged: Map<number, string>
  initialAnchors?: ReadonlySet<string>
  debugAll: boolean
  redWords: RedWord[]
}

// ONE paragraph's word scan — shared verbatim by the full-document and windowed builds.
// Compression/slide animation is ripped out for master (shared flag in popoverConstants — also gates
// the LOGIC in usePopoverLayout). The static compression applies INSTANTLY; transitions in
// decorationsFor are no-ops while it's false.
function scanParagraphWords(node: PMNode, pos: number, pIdx: number, ctx: ScanCtx): void {
  const { cursorPos, lookup, flagged, newFlagged, initialAnchors, debugAll, redWords } = ctx
  let seqInPara = 0

  node.forEach((child: PMNode, offset: number) => {
      if (!child.isText || !child.text) return
      const text = child.text
      // The slot mark anchors a cycled word's synonym list to its original. A committed memory slot
      // also PERSISTS as purple (re-cyclable) even after the engine clears the live kick — that's the
      // "kicked words keep their memory" behaviour. A LOCKED slot is final → normal colour. Live
      // engine kicks colour as before. (See scas-memory-slots-design.md.)
      const slotMark = child.marks.find(m => m.type.name === 'scasSlot')
      const slotOriginal = (slotMark?.attrs.original as string | null) ?? null
      const persistSlot = !!slotMark && !slotMark.attrs.locked
      let match: RegExpExecArray | null
      WORD_RE.lastIndex = 0
      while ((match = WORD_RE.exec(text)) !== null) {
        const word = match[0]
        const from = pos + 1 + offset + match.index
        const to   = from + word.length

        // Sticky-green anchor: a word turns green by lemma, then stays green while the text
        // is still that word or a deletion-remnant (startsWith). Released on commit/lock/delete.
        const anchoredOriginal = flagged.get(from)
        const anchorHeld = anchoredOriginal !== undefined && anchoredOriginal.startsWith(word)
        // Restored anchor: word was green in a prior session (saved in scasGreenAnchors).
        // Force it green regardless of current S_v so it survives OPFS/file round-trips.
        const restoredAnchor = !anchorHeld && !!initialAnchors?.has(word.toLowerCase())

        const lemma = lemmaOf(word)
        const greenEngine = isColoured(lookup, lemma)           // stochastically selected (in S_v)
        const greenTest   = !greenEngine && debugAll && inPool(lemma) // test/pool-only
        const greenNow    = greenEngine || greenTest

        const cursorNear  = cursorPos >= from && cursorPos <= to + 1
        const anchorActive = (anchorHeld && (greenEngine || cursorNear)) || restoredAnchor

        // Single letters aren't coloured on their own — except a committed slot being deleted
        // to its last char (slot mark stays) or an anchored green word being deleted down.
        if (word.length < 2 && !slotMark && !anchorHeld) continue

        // Skip the word under the cursor while being typed (no anchor yet) to avoid flickering.
        // A committed slot or an already-anchored green word is exempt (no black flash).
        if (!persistSlot && !anchorActive && cursorPos >= from && cursorPos <= to) {
          const nextChar = text[match.index + word.length] ?? null
          if (!nextChar || !/[\s.,;:!?)\-'"…]/.test(nextChar)) continue
        }

        if (!greenNow && !persistSlot && !anchorActive) continue

        if (persistSlot) {
          redWords.push({
            from, to, pIdx, word, seqInPara: ++seqInPara,
            dataWord: slotOriginal ?? word.toLowerCase(),
            secondary: !!slotOriginal,
            firstAt: (slotMark?.attrs.firstCommitAt as string | null) ?? null,
            testOnly: false,
          })
        } else {
          // Green (uncommitted) word. Only anchor stochastic words (in S_v) so that test-mode
          // words disappear the moment test mode is toggled off (reload) and N-changes clear as
          // soon as the cursor moves away from the now-excluded word.
          const original = restoredAnchor ? word : (anchorActive ? (anchoredOriginal ?? word) : word)
          if (greenEngine || anchorActive) newFlagged.set(from, original)
          redWords.push({
            from, to, pIdx, word, seqInPara: ++seqInPara,
            dataWord: original.toLowerCase(),
            secondary: false,
            firstAt: null,
            testOnly: greenTest && !anchorActive,
          })
        }
      }
  })
}

// ── 3. Build decorations from the collected words ───────────────────────────
// (Tab/⇧+tab hint badges were removed — the visual hints feature is gone. Tab navigation still
// works from the keyboard; it just no longer paints a per-word badge.)
function decorationsFor(redWords: RedWord[], hintState: HintState, reveals: ReadonlySet<number>, renderWindow?: { from: number; to: number } | null): Decoration[] {
  const decorations: Decoration[] = []
  const { focusedPos } = hintState

  for (const { from, to, dataWord, pIdx, seqInPara, secondary, firstAt, testOnly } of redWords) {
    const isFocused = focusedPos !== null && from === focusedPos
    // SCAS WINDOWED RENDERING (flag inkwave:scasWindow): the verdict scan stays doc-wide (redWords,
    // flagged), but only words in the viewport window get a Decoration object — the per-keystroke
    // DecorationSet.map() is O(decorated words), and a thesis lights ~2,600. The FOCUSED word and any
    // REVEALING word are always realised (the popover/compression read their geometry); the window
    // carries a generous margin so a word is decorated well before it scrolls into view (no flicker).
    if (renderWindow && !isFocused && !reveals.has(from) && (to <= renderWindow.from || from >= renderWindow.to)) continue
    // Two categories: scas-stochastic = in S_v exclusion set; scas-test = pool-only (debugAll).
    // The distinction lets CSS or future tooling style them differently (e.g. lighter green for test).
    const catClass = testOnly ? ' scas-test' : ' scas-stochastic'
    const attrs: Record<string, string> = {
      class: `scas-red${catClass}${isFocused ? ' scas-focused' : ''}${reveals.has(from) ? ' scas-revealing' : ''}`,
      'data-word': dataWord,
      'data-para': String(pIdx),
      'data-scas-n': String(seqInPara),
    }
    // The memory cross-out (::after, green, beneath) + first-written stamp (::before, grey, above):
    // any slot with a known origin shows its ORIGINAL struck-through and the time it was first written.
    // Emitted ALWAYS (even while focused) so the element persists across the focus change — the fade
    // is a CSS opacity TRANSITION keyed on .scas-focused (hidden while focused → fades in on commit),
    // which never replays when the decoration rebuilds (unlike a keyframe animation = the "wawaa").
    if (secondary) {
      attrs['data-scas-old'] = dataWord
      const t = hhmm(firstAt)
      if (t) attrs['data-scas-time'] = t
    }

    if (isFocused) {
      const mw = hintState.focusedMinWidth
      const trans = (ANIMATE_COMPRESSION && hintState.animate) ? `transition:min-width ${hintState.durationMs}ms ${REFLOW_EASE}` : 'transition:none'
      // Use the EXACT reserved width (not Math.ceil): ceiling rounds the box up by up to 1px, so on
      // commit the after-text sat ~1px right of where the committed (exact-width) text lands and
      // snapped left at the swap — the end-of-motion twitch, worst on short words. Sub-pixel
      // min-width is fine; the box now matches the committed glyph run.
      attrs['style'] = `display:inline-block;color:transparent${mw ? `;min-width:${mw.toFixed(2)}px` : ''};${trans}`
    }

    decorations.push(Decoration.inline(from, to, attrs))
  }

  // Symmetric line compression: squeeze the before-side (after the line's first word) to
  // slide the focused word's reserved box left by half its expansion — centring it on the
  // word — and squeeze the after-side only by the right-push that exceeds the slack.
  const { lineCompressionRange } = hintState
  if (lineCompressionRange && focusedPos !== null) {
    const fw = redWords.find(rw => rw.from === focusedPos)
    if (fw) {
      const { firstWordEnd: fwe, to: lt, lsBeforeEm, lsAfterEm } = lineCompressionRange
      const lsTransition = (ANIMATE_COMPRESSION && hintState.animate) ? `;transition:letter-spacing ${hintState.durationMs}ms ${REFLOW_EASE}` : ';transition:none'
      // Apply the span whenever its range exists (even at letter-spacing 0): a 0 span is a
      // visual no-op but must be present so the open/close transition has something to animate.
      if (fwe < fw.from) {
        // Before-run: transform-origin RIGHT conceptually — its right edge is glued to the (fixed)
        // focused word. Plain inline letter-spacing compression (the FLIP transform path was ripped
        // out with the flip-book animation; an inline-block here was harmful anyway — a slot word
        // inside the run inherited the 2.5 line-height and jumped its box 23→45px).
        const beforeStyle = `letter-spacing: -${lsBeforeEm.toFixed(4)}em${lsTransition}`
        decorations.push(Decoration.inline(fwe, fw.from, { class: 'scas-comp-before', style: beforeStyle }))
      }
      if (fw.to < lt) {
        // After-run: plain inline letter-spacing compression (FLIP transform path ripped out).
        const afterStyle = `letter-spacing: -${lsAfterEm.toFixed(4)}em${lsTransition}`
        decorations.push(Decoration.inline(fw.to, lt, { class: 'scas-comp-after', style: afterStyle }))
      }
    }
  }

  return decorations
}
