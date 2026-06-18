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

export const RED_HIGHLIGHT_KEY = new PluginKey<DecorationSet>('redHighlight')

// Dispatch a transaction with this meta key to force a hint rebuild without
// changing the document (e.g. when the popover opens or closes).
export const SCAS_HINT_META = 'scasHintUpdate'

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

interface RedHighlightOptions {
  getDoc: () => InkwaveDocument
  getHintState: () => HintState
  getScasLookup: () => ScasLookup
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
    return [
      new Plugin({
        key: RED_HIGHLIGHT_KEY,
        state: {
          init(_, state) {
            return buildDecorations(state.doc, getDoc(), state.selection.from, getHintState(), getScasLookup())
          },
          apply(tr, old, prev, next) {
            return !tr.docChanged && tr.selection.eq(prev.selection) && !tr.getMeta(SCAS_HINT_META)
              ? old
              : buildDecorations(next.doc, getDoc(), next.selection.from, getHintState(), getScasLookup())
          },
        },
        props: {
          decorations(state) { return RED_HIGHLIGHT_KEY.getState(state) },
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
}

// Time-of-day as four digits, 24h, no colon (e.g. 1432) — the slot's first-written stamp.
function hhmm(raw: string | null): string | null {
  if (!raw) return null
  const ms = Number(raw)
  if (!Number.isFinite(ms) || ms <= 0) return null
  const d = new Date(ms)
  return String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0')
}

function buildDecorations(
  pmDoc: PMNode,
  inkDoc: InkwaveDocument,
  cursorPos: number,
  hintState: HintState,
  lookup: ScasLookup,
): DecorationSet {
  // SCAS engine off (un-migrated or non-N-mode) → no decorations.
  if (inkDoc.scasMode !== 'n' || !inkDoc.scasState) return DecorationSet.empty

  // ── 1. Collect kicked words (skip the uncommitted word under the cursor) ──────
  // A word is purple iff its lemma is Locked or an outstanding live kick — the frozen verdict
  // from the SCAS controller, NOT a recompute against the current S_v (so rotation never reflows
  // already-committed text). `lemmaOf` collapses inflections to the state key.
  const redWords: RedWord[] = []
  let paragraphIndex = 0
  const debugAll = debugHighlightAll() // temporary: colour every pool word for animation testing
  // Compression/slide animation is ripped out for master (shared flag in popoverConstants — also gates
  // the LOGIC in usePopoverLayout). The static compression applies INSTANTLY; transitions below are
  // no-ops while it's false.

  pmDoc.descendants((node: PMNode, pos: number) => {
    if (node.type.name !== 'paragraph') return true
    const pIdx = paragraphIndex++
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
        if (word.length < 2) continue
        const from = pos + 1 + offset + match.index
        const to   = from + word.length

        // Skip the word under the cursor unless it's already committed (a boundary char follows) —
        // this stops a word flickering purple as you type it. A persistent memory slot is exempt: it
        // was committed already, so it must stay purple even with the cursor in it (no black flash).
        if (!persistSlot && cursorPos >= from && cursorPos <= to) {
          const nextChar = text[match.index + word.length] ?? null
          if (!nextChar || !/[\s.,;:!?)\-'"…]/.test(nextChar)) continue
        }

        const lemma = lemmaOf(word)
        if (!isColoured(lookup, lemma) && !persistSlot && !(debugAll && inPool(lemma))) continue

        redWords.push({
          from, to, pIdx, word, seqInPara: ++seqInPara,
          dataWord: slotOriginal ?? word.toLowerCase(),
          secondary: !!slotOriginal,
          firstAt: (slotMark?.attrs.firstCommitAt as string | null) ?? null,
        })
      }
    })

    return false
  })

  // ── 3. Build decorations ──────────────────────────────────────────────────
  // (Tab/⇧+tab hint badges were removed — the visual hints feature is gone. Tab navigation still
  // works from the keyboard; it just no longer paints a per-word badge.)
  const decorations: Decoration[] = []
  const { focusedPos } = hintState

  for (const { from, to, dataWord, pIdx, seqInPara, secondary, firstAt } of redWords) {
    const isFocused = focusedPos !== null && from === focusedPos
    // All coloured words use the one dark purple now — the struck-through old word distinguishes a
    // committed/substituted slot, so the lighter "secondary" tint is no longer needed.
    const attrs: Record<string, string> = {
      class: `scas-red${isFocused ? ' scas-focused' : ''}`,
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

  return DecorationSet.create(pmDoc, decorations)
}
