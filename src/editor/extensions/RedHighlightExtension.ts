import { Extension } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { isInVocab } from '../../scas/ranking'
import type { InkwaveDocument } from '../../types/document'

export const RED_HIGHLIGHT_KEY = new PluginKey<DecorationSet>('redHighlight')

// Dispatch a transaction with this meta key to force a hint rebuild without
// changing the document (e.g. when the popover opens or closes).
export const SCAS_HINT_META = 'scasHintUpdate'

const WORD_RE = /[a-zA-Z]+/g

export interface HintState {
  focusedPos: number | null
  showHints: boolean
  focusedMinWidth: number | null
  // Letter-spacing compression applied to chars around the focused word to
  // absorb its min-width expansion in-place. offsetLeft compensates for the
  // space lost before the word, keeping it anchored to its original position.
  lineCompressionRange: { from: number; to: number; letterSpacingEm: number; offsetLeft: number } | null
}

interface RedHighlightOptions {
  getDoc: () => InkwaveDocument
  getHintState: () => HintState
}

export const RedHighlightExtension = Extension.create<RedHighlightOptions>({
  name: 'redHighlight',

  addOptions() {
    return {
      getDoc: () => { throw new Error('RedHighlightExtension: getDoc option is required') },
      getHintState: () => ({ focusedPos: null, showHints: true, focusedMinWidth: null, lineCompressionRange: null }),
    }
  },

  addProseMirrorPlugins() {
    const { getDoc, getHintState } = this.options
    return [
      new Plugin({
        key: RED_HIGHLIGHT_KEY,
        state: {
          init(_, state) {
            return buildDecorations(state.doc, getDoc(), state.selection.from, getHintState())
          },
          apply(tr, old, prev, next) {
            return !tr.docChanged && tr.selection.eq(prev.selection) && !tr.getMeta(SCAS_HINT_META)
              ? old
              : buildDecorations(next.doc, getDoc(), next.selection.from, getHintState())
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
  seqInPara: number  // 1-based — kept for data-scas-n (debugging / future use)
}

function buildDecorations(
  pmDoc: PMNode,
  inkDoc: InkwaveDocument,
  cursorPos: number,
  hintState: HintState,
): DecorationSet {
  const { scasLimitN, scasSessionSeed } = inkDoc
  if (scasLimitN === 'infinite') return DecorationSet.empty

  // ── 1. Collect out-of-vocab words (skip uncommitted cursor word) ──────────
  const redWords: RedWord[] = []
  let paragraphIndex = 0

  pmDoc.descendants((node: PMNode, pos: number) => {
    if (node.type.name !== 'paragraph') return true
    const pIdx = paragraphIndex++
    let seqInPara = 0

    node.forEach((child: PMNode, offset: number) => {
      if (!child.isText || !child.text) return
      const text = child.text
      let match: RegExpExecArray | null
      WORD_RE.lastIndex = 0
      while ((match = WORD_RE.exec(text)) !== null) {
        const word = match[0]
        if (word.length < 2) continue
        const from = pos + 1 + offset + match.index
        const to   = from + word.length

        // Skip the word under the cursor unless it's already been committed
        // (committed = a space or punctuation immediately follows it).
        if (cursorPos >= from && cursorPos <= to) {
          const nextChar = text[match.index + word.length] ?? null
          if (!nextChar || !/[\s.,;:!?)\-'"…]/.test(nextChar)) continue
        }
        if (isInVocab(word, pIdx, scasSessionSeed, scasLimitN)) continue

        redWords.push({ from, to, pIdx, word, seqInPara: ++seqInPara })
      }
    })

    return false
  })

  // ── 2. Hint badges (tab / ⇧+tab on the two nearest red words) ────────────
  const hintMap = new Map<number, string>()
  if (hintState.showHints) {
    // When the popover is open use the focused word as the reference point;
    // otherwise use the cursor. Either way, hint the neighbours of that point.
    const ref      = hintState.focusedPos ?? cursorPos
    const prevWord = [...redWords].reverse().find(rw => rw.from < ref)
    const nextWord = redWords.find(rw => rw.from > ref)
    if (prevWord) hintMap.set(prevWord.from, 'tab')
    if (nextWord) hintMap.set(nextWord.from, '⇧+tab')
  }

  // ── 3. Build decorations ──────────────────────────────────────────────────
  const decorations: Decoration[] = []
  const { focusedPos } = hintState

  for (const { from, to, word, pIdx, seqInPara } of redWords) {
    const isFocused = focusedPos !== null && from === focusedPos
    const attrs: Record<string, string> = {
      class: isFocused ? 'scas-red scas-focused' : 'scas-red',
      'data-word': word.toLowerCase(),
      'data-para': String(pIdx),
      'data-scas-n': String(seqInPara),
    }
    const hint = hintMap.get(from)
    if (hint) attrs['data-hint'] = hint

    if (isFocused) {
      const mw = hintState.focusedMinWidth
      attrs['style'] = `display:inline-block;color:transparent${mw ? `;min-width:${Math.ceil(mw)}px` : ''}`
    }

    decorations.push(Decoration.inline(from, to, attrs))
  }

  // Line compression: tighten letter-spacing on both sides of the focused word
  // to absorb its min-width expansion. A widget at the line start offsets the
  // leftward drift from compressing before-word chars.
  const { lineCompressionRange } = hintState
  if (lineCompressionRange && focusedPos !== null) {
    const fw = redWords.find(rw => rw.from === focusedPos)
    if (fw) {
      const { from: lf, to: lt, letterSpacingEm: ls, offsetLeft: ol } = lineCompressionRange
      const style = `letter-spacing: -${ls.toFixed(4)}em`
      if (lf < fw.from) {
        decorations.push(Decoration.inline(lf, fw.from, { style }))
        if (ol > 0.5) {
          decorations.push(Decoration.widget(lf, () => {
            const s = document.createElement('span')
            s.style.cssText = `display:inline-block;width:${ol.toFixed(2)}px;pointer-events:none;user-select:none`
            return s
          }))
        }
      }
      if (fw.to < lt) decorations.push(Decoration.inline(fw.to, lt, { style }))
    }
  }

  return DecorationSet.create(pmDoc, decorations)
}
