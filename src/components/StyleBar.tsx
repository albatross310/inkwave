// StyleBar — formatting controls above the main toolbar.
//
// All buttons use the container's onMouseDown preventDefault to keep the editor's
// selection alive. Long-press (≥175ms) opens the option popup; short tap applies
// the last-used option (font + size are HOLD-ONLY — a plain click does nothing).
// Menu items trigger on pointer-up for immediacy.

import { Fragment, useEffect, useRef, useState } from 'react'
import { useLongPress } from './useLongPress'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { DESKTOP_POPUP_CLASS, desktopPopupStyle } from '../styles/panelSheet'

const INK = '#302438'
const BASE_SIZE = 18       // editor root px (matches .ProseMirror { font-size: 1.125rem })
const PT_TO_PX = 96 / 72  // 1pt = 1.3333px at 96 DPI

// MATH-CERTIFIED FONTS ONLY (2026-07-12, round-7, Peter's call: "test all the fonts independently
// and if some perform badly we replace them with better fonts"). The old system-font entries
// (Times/Cambria/Georgia/Palatino/Baskerville/system-ui) had DEVICE-DEPENDENT metrics — they could
// never be math-certified for the upcoming arithmetic layout engine, and they were already a quiet
// hole in cross-device canonical pagination (a marked run wrapped differently on phone vs desktop
// vs print). Every family below is SELF-HOSTED (public/fonts, fetch-fonts.mjs) → identical metrics
// everywhere. Legacy docs with old marks still render: each css string keeps the old system stack
// as its fallback tail, and an old mark's own stack resolves exactly as before (no @font-face ever
// existed for those names).
export const FONTS = [
  // Identity
  { group: 'Identity', label: 'Fell',      css: "'IM Fell DW Pica', 'EB Garamond', Georgia, serif" },
  { group: 'Identity', label: 'Garamond',  css: "'EB Garamond', Georgia, serif" },
  // Serif — 'Times' and 'Arial' are certified CLONES (TeX Gyre Termes/Heros, GUST licence);
  // labels are display-only and decoupled from the css stack (Peter: "call it Times").
  // 'Romans', not 'Times' (Peter, 2026-07-16): "Times"/"Times New Roman" are Monotype trademarks and
  // ubiquity STRENGTHENS a mark rather than weakening it. "Roman" is the generic typographic term for
  // upright type — nobody owns it — and it's honest: TeX Gyre Termes descends from Nimbus Roman.
  // ('Arial' below is the same exposure, and arguably worse: a coined word is inherently the stronger
  // mark. Left as-is on Peter's call; the safe labels there are Heros / Grotesque / Swiss.)
  { group: 'Serif', label: 'Romans',   css: "'TeX Gyre Termes', 'Times New Roman', Times, serif" },
  { group: 'Serif', label: 'Crimson',  css: "'Crimson Pro', 'Times New Roman', serif" },
  { group: 'Serif', label: 'Spectral', css: "'Spectral', 'Times New Roman', Times, serif" },
  { group: 'Serif', label: 'Gentium',  css: "'Gentium Plus', 'Palatino Linotype', serif" },
  // DROPPED 2026-07-16 (Peter): Lora — its only justification was being the "Cambria-warmth
  // stand-in" while Caladea kept failing the (flawed) certification; Caladea now ships, so Lora was
  // a stand-in for a font we have. Gelasio — a Georgia metric clone, the least refined face here.
  // Both faces are also removed from fetch-fonts, so legacy marks fall back down their own stacks
  // (Lora → Cambria/Palatino/Georgia, Gelasio → Georgia) — the documented fallback-tail convention.
  // Gentium stays despite being specialised: philosophy users need its Greek/Latin coverage.
  // Added 2026-07-16 after the re-certification retracted r7's FAILED list (see CLAUDE.md): r7
  // measured with ligatures ON while the editor renders liga OFF, so both of these were rejected
  // for a divergence that can't occur here. Baskerville = the genre Peter had let go; Caladea =
  // the Cambria-warmth slot (its own name, not the trademark — the TeX Gyre caveat).
  { group: 'Serif', label: 'Baskerville', css: "'Libre Baskerville', Baskerville, 'Times New Roman', serif" },
  { group: 'Serif', label: 'Caladea',     css: "'Caladea', Cambria, 'Palatino Linotype', Georgia, serif" },
  // Display — headings/titles
  { group: 'Display', label: 'Cormorant', css: "'Cormorant Garamond', 'EB Garamond', serif" },
  { group: 'Display', label: 'Fraunces',  css: "'Fraunces', Georgia, serif" },
  // Slab
  { group: 'Slab', label: 'Bitter', css: "'Bitter', 'Roboto Slab', Georgia, serif" },
  // Zilla Slab over Roboto Slab/Aleo/Arvo (2026-07-16): furthest from Bitter (x/cap 0.682 vs 0.771)
  // AND it has real italics — Roboto Slab synthesises both obliques and is literally Bitter's own
  // fallback tail (maximum overlap); Arvo genuinely FAILS certification (Δ12px at 96px).
  { group: 'Slab', label: 'Zilla',  css: "'Zilla Slab', 'Roboto Slab', Georgia, serif" },
  // Sans
  // 'Swiss', not 'Arial' (Peter, 2026-07-16). Arial was the worse trademark exposure of the two: a
  // coined word is inherently the stronger mark. 'Swiss' names the genre/movement (the International
  // Typographic Style) — geographic-descriptive, so a weak mark nobody meaningfully owns — and it's
  // honest: TeX Gyre Heros is a neo-grotesque descending from Nimbus Sans, the Helvetica clone.
  { group: 'Sans', label: 'Swiss',    css: "'TeX Gyre Heros', Helvetica, Arial, sans-serif" },
  { group: 'Sans', label: 'Carlito',  css: "'Carlito', system-ui, -apple-system, 'Segoe UI', sans-serif" },
  // Inter (2026-07-16) — shipped for QUALITY, not contrast: measured x/cap 0.712 is IDENTICAL to
  // Heros, i.e. the same neo-grotesque voice, just better drawn and screen-optimised with far wider
  // coverage. Carlito (0.738) + Atkinson (0.735) are the humanists already covering the other voice.
  { group: 'Sans', label: 'Inter',    css: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif" },
  { group: 'Sans', label: 'Atkinson', css: "'Atkinson Hyperlegible', system-ui, sans-serif" },
  // Mono — code / logic notation
  { group: 'Mono', label: 'JetBrains', css: "'JetBrains Mono', ui-monospace, 'Cascadia Mono', monospace" },
  // Courier Prime (2026-07-16, Peter's pick — and it earns it): x/cap 0.776, the highest of the four
  // monos, which is precisely Courier's weakness (thin, small-bodied) redesigned away. Real 400/700/
  // italic/bold-italic. Its own name, so no "Courier New" trademark exposure. All monos share a
  // 0.6em advance, so swapping mono can't change line lengths — the contrast here is voice.
  { group: 'Mono', label: 'Courier',   css: "'Courier Prime', 'Courier New', Courier, monospace" },
]

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72]

// HOUSE DEFAULTS (Peter, 2026-09-18): what a plain click applies when the writer has picked nothing
// yet this session and the document itself gives no lead — Carlito 12pt, yellow highlight, bright
// red text, left alignment. Font and size first ask the DOCUMENT: the most common font / size by
// characters (unmarked text counts as the editor's base face), so a click re-applies the document's
// own voice; only an empty document falls back to the house.
const HOUSE_FONT_CSS = FONTS.find(f => f.label === 'Carlito')!.css
const HOUSE_SIZE_PT = 12
const BASE_FONT_CSS = FONTS[0].css

const HIGHLIGHT_COLORS = [
  { label: 'red',    color: '#fca5a5' },
  { label: 'coral',  color: '#fda4af' },
  { label: 'orange', color: '#fed7aa' },
  { label: 'peach',  color: '#fde68a' },
  { label: 'yellow', color: '#fef08a' },
  { label: 'green',  color: '#bbf7d0' },
  { label: 'sage',   color: '#d1fae5' },
  { label: 'teal',   color: '#99f6e4' },
  { label: 'blue',   color: '#bae6fd' },
  { label: 'indigo', color: '#a5b4fc' },
  { label: 'pink',   color: '#fbcfe8' },
  { label: 'clear',  color: null },
]

// Text colours — a small tasteful set fitting the calm identity (deep, ink-like tones).
const TEXT_COLORS: Array<{ label: string; color: string | null }> = [
  { label: 'default', color: null },
  { label: 'ink',     color: '#302438' },
  { label: 'black',   color: '#1a1a1a' },
  { label: 'blue',    color: '#1e3a8a' },
  // Bright red (Peter, 2026-09-18: the house default colour is "bright red"); the old #991b1b was maroon.
  { label: 'red',     color: '#dc2626' },
  { label: 'green',   color: '#166534' },
  { label: 'brown',   color: '#78350f' },
]
const HOUSE_HL_COLOR = HIGHLIGHT_COLORS.find(c => c.label === 'yellow')!.color
const HOUSE_TXT_COLOR = TEXT_COLORS.find(c => c.label === 'red')!.color

type CharFmt = 'bold' | 'italic' | 'underline' | 'strike'
type ListType = 'bulletList' | 'decimal' | 'lower-roman' | 'lower-alpha' | 'upper-roman' | 'taskList'
type Align = 'left' | 'center' | 'right' | 'justify'
type IndentAction = 'line+' | 'line-' | 'para+' | 'para-' | 'clear'

const CHAR_FMT_LABELS: Record<CharFmt, string> = { bold: 'B', italic: 'i', underline: 'U', strike: 'S' }
const CHAR_FMT_STYLES: Record<CharFmt, React.CSSProperties> = {
  bold: { fontWeight: 700 },
  italic: { fontStyle: 'italic' },
  underline: { textDecoration: 'underline' },
  strike: { textDecoration: 'line-through' },
}
const CHAR_FMT_NAMES: Record<CharFmt, string> = {
  bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strikethrough',
}
const ALIGN_LABELS: Record<Align, string> = {
  left: 'left', center: 'centre', right: 'right', justify: 'justify',
}
const LIST_TYPE_LABELS: Record<ListType, string> = {
  bulletList: '•', decimal: '1.', 'lower-roman': 'i.', 'lower-alpha': 'a.', 'upper-roman': 'I.', taskList: '☐',
}
const INDENT_ITEMS: Array<{ action: IndentAction; label: string; preview: string }> = [
  { action: 'line+', label: 'indent line',        preview: '⇥' },
  { action: 'line-', label: 'unindent line',      preview: '⇤' },
  { action: 'para+', label: 'first-line indent',  preview: '¶⇥' },
  { action: 'para-', label: 'remove first-line',  preview: '¶⇤' },
  { action: 'clear', label: 'clear line format',  preview: '⌫' },
]


export function StyleBar({ editor, onActivity, phone, barVisible = true }: {
  editor: Editor
  onActivity?: () => void
  phone?: boolean
  barVisible?: boolean // the bar row's expanded state — pickers close WITH the bar (they portal to body)
}) {
  const [, force] = useState(0)
  const [fontOpen,   setFontOpen]   = useState(false)
  const [sizeOpen,   setSizeOpen]   = useState(false)
  const [fmtOpen,    setFmtOpen]    = useState(false)
  const [hlOpen,     setHlOpen]     = useState(false)
  const [colorOpen,  setColorOpen]  = useState(false)
  const [alignOpen,  setAlignOpen]  = useState(false)
  const [listOpen,   setListOpen]   = useState(false)
  const [indentOpen, setIndentOpen] = useState(false)
  // Pickers portal to document.body, so collapsing the bar row doesn't hide them — close them all
  // the moment the bar goes down (Peter, 2026-07-10: orphaned colour palette floating alone).
  useEffect(() => {
    if (barVisible) return
    setFontOpen(false); setSizeOpen(false); setFmtOpen(false); setHlOpen(false)
    setColorOpen(false); setAlignOpen(false); setListOpen(false); setIndentOpen(false)
  }, [barVisible])

  // The last font/size the writer PICKED, so a plain click can re-apply it — the same
  // remembered-value pattern the other style buttons already use (lastFmt, lastAlign, …).
  // null = nothing picked yet this session, so a click has nothing to apply and opens the menu.
  const [lastFont,     setLastFont]     = useState<string | null>(null)
  const [lastSize,     setLastSize]     = useState<number | null>(null)
  const [lastFmt,      setLastFmt]      = useState<CharFmt>('bold')
  const [lastHlColor,  setLastHlColor]  = useState<string | null>(HOUSE_HL_COLOR)
  const [lastTxtColor, setLastTxtColor] = useState<string | null>(HOUSE_TXT_COLOR)

  // The document's most common font and size (by character count). Walked at click time only.
  const docMode = (): { font: string | null; sizePt: number | null } => {
    const fonts = new Map<string, number>(); const sizes = new Map<number, number>()
    editor.state.doc.descendants(node => {
      if (!node.isText) return
      const ts = node.marks.find(m => m.type.name === 'textStyle')?.attrs as { fontFamily?: string; fontSize?: string } | undefined
      const font = ts?.fontFamily ?? BASE_FONT_CSS
      const raw = ts?.fontSize ?? ''
      const px = raw.endsWith('em') ? parseFloat(raw) * BASE_SIZE : parseInt(raw, 10) || BASE_SIZE
      const pt = Math.round(px / PT_TO_PX)
      const n = node.text?.length ?? 0
      fonts.set(font, (fonts.get(font) ?? 0) + n); sizes.set(pt, (sizes.get(pt) ?? 0) + n)
    })
    const top = <K,>(m: Map<K, number>): K | null => { let best: K | null = null, bn = 0; m.forEach((n, k) => { if (n > bn) { bn = n; best = k } }); return best }
    return { font: top(fonts), sizePt: top(sizes) }
  }
  const [lastListType, setLastListType] = useState<ListType>('bulletList')
  const [lastAlign,    setLastAlign]    = useState<Align>('left')
  const [lastIndent,   setLastIndent]   = useState<IndentAction>('line+')

  const fontBtnRef   = useRef<HTMLButtonElement>(null)
  const sizeBtnRef   = useRef<HTMLButtonElement>(null)
  const fmtBtnRef    = useRef<HTMLButtonElement>(null)
  const hlBtnRef     = useRef<HTMLButtonElement>(null)
  const colorBtnRef  = useRef<HTMLButtonElement>(null)
  const alignBtnRef  = useRef<HTMLButtonElement>(null)
  const listBtnRef   = useRef<HTMLButtonElement>(null)
  const indentBtnRef = useRef<HTMLButtonElement>(null)

  const ping = () => onActivity?.()

  // Re-render (for the isActive button states) only while the bar is actually VISIBLE. The bar
  // stays mounted inside the collapsed footer row, and this per-transaction force-update was a
  // full re-render of the whole bar on EVERY keystroke while hidden (typing-lag ablation,
  // 2026-07-11). Re-opening forces one refresh via the [barVisible] dep re-running the effect.
  useEffect(() => {
    if (!barVisible) return
    const upd = () => force(n => n + 1)
    upd() // refresh active states the moment the bar becomes visible
    editor.on('selectionUpdate', upd)
    editor.on('transaction', upd)
    return () => { editor.off('selectionUpdate', upd); editor.off('transaction', upd) }
  }, [editor, barVisible])

  // Highlight should never extend to newly typed text — clear it from stored marks whenever
  // the cursor lands anywhere, so typing always starts without an ambient highlight.
  useEffect(() => {
    const clearHighlight = () => {
      const { state } = editor
      if (!state.selection.empty) return
      const marks = state.storedMarks ?? state.selection.$from.marks()
      if (!marks.some((m: { type: { name: string } }) => m.type.name === 'highlight')) return
      const filtered = marks.filter((m: { type: { name: string } }) => m.type.name !== 'highlight')
      editor.view.dispatch(state.tr.setStoredMarks(filtered))
    }
    editor.on('selectionUpdate', clearHighlight)
    return () => { editor.off('selectionUpdate', clearHighlight) }
  }, [editor])

  const closeAll = () => { setFontOpen(false); setSizeOpen(false); setFmtOpen(false); setHlOpen(false); setColorOpen(false); setAlignOpen(false); setListOpen(false); setIndentOpen(false) }
  const anyOpen = fontOpen || sizeOpen || fmtOpen || hlOpen || colorOpen || alignOpen || listOpen || indentOpen

  useEffect(() => {
    if (!anyOpen) return
    const onDown = () => closeAll()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAll() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [anyOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived ──────────────────────────────────────────────────────────────
  const ts = editor.getAttributes('textStyle')
  const rawSize = ts.fontSize ?? ''
  const curSizePx = rawSize.endsWith('em') ? parseFloat(rawSize) * BASE_SIZE : parseInt(rawSize, 10) || BASE_SIZE
  const curSize = Math.round(curSizePx / PT_TO_PX)
  const curFont = FONTS.find(f => f.css === ts.fontFamily)?.label ?? 'Fell'
  const curAlign: Align = (['left', 'center', 'right', 'justify'] as const).find(a => editor.isActive({ textAlign: a })) ?? 'left'
  const curHlColor = (editor.getAttributes('highlight') as { color?: string }).color ?? null
  const curTxtColor = (ts as { color?: string }).color ?? null
  const listActive = editor.isActive('bulletList') || editor.isActive('orderedList') || editor.isActive('taskList')
  // Button faces: the first three letters of the SELECTION's value (Peter, 2026-09-18: "show first
  // three letters of the selection, not A"), falling back to what a click would apply.
  const face = (list: ReadonlyArray<{ label: string; color: string | null }>, color: string | null) =>
    (list.find(c => c.color === color)?.label ?? list[0].label).slice(0, 3)
  const hlFace = face(HIGHLIGHT_COLORS, curHlColor ?? lastHlColor)
  const txtFace = face(TEXT_COLORS, curTxtColor ?? lastTxtColor)

  // ── Actions ───────────────────────────────────────────────────────────────
  const setFont = (css: string) => { ping(); setLastFont(css); editor.chain().focus().setFontFamily(css).run(); setFontOpen(false) }
  const setSize = (pt: number) => {
    ping(); setLastSize(pt)
    editor.chain().focus().setMark('textStyle', { fontSize: `${+((pt * PT_TO_PX) / BASE_SIZE).toFixed(4)}em` }).run()
    setSizeOpen(false)
  }
  function applyFmt(fmt: CharFmt) {
    ping(); setLastFmt(fmt)
    const cmds: Record<CharFmt, () => boolean> = {
      bold: () => editor.chain().toggleBold().run(),
      italic: () => editor.chain().toggleItalic().run(),
      underline: () => editor.chain().toggleUnderline().run(),
      strike: () => editor.chain().toggleStrike().run(),
    }
    cmds[fmt]()
  }
  function applyHighlight(color: string | null) {
    ping()
    if (!color) setLastHlColor(null) // clearing is a choice — see applyTextColor's note
    if (color) {
      setLastHlColor(color)
      // Toggle semantics: highlighting text ALREADY in this exact colour unhighlights it
      // (a different colour still re-colours, below).
      if (editor.isActive('highlight', { color })) {
        editor.chain().unsetHighlight().run()
        setHlOpen(false)
        return
      }
      editor.chain().setHighlight({ color }).run()
      // After applying highlight to a selection, storedMarks is null (range selection has no
      // stored marks). But when the cursor later collapses to the right edge of highlighted text,
      // ProseMirror auto-inherits the highlight mark. Override this by setting storedMarks now
      // to the marks at the cursor position minus highlight, so typing never extends the highlight.
      const { view } = editor
      const st = view.state
      const marksAtPos = st.selection.$from.marks()
      const filtered = marksAtPos.filter((m: { type: { name: string } }) => m.type.name !== 'highlight')
      view.dispatch(st.tr.setStoredMarks(filtered))
    } else {
      editor.chain().unsetHighlight().run()
    }
    setHlOpen(false)
  }
  function applyTextColor(color: string | null) {
    ping()
    // ⚠ REMEMBER 'Default' TOO (Peter, 2026-08-23: "stop the text from going red"). This was
    // `if (color) setLastTxtColor(color)`, so choosing Default cleared the text but left the
    // remembered colour as whatever was picked before — and since a plain CLICK on this button
    // re-applies the remembered colour, the next click put the red straight back. The writer's way
    // OUT of a colour therefore could not stick: clear it, click the button, red again. Default is a
    // choice like any other, so it is remembered like any other, and a click after it is a no-op
    // rather than a relapse.
    setLastTxtColor(color)
    // ⚠ CLEARING NEEDS `removeEmptyTextStyle` (2026-08-23, Peter: "the colour's still not
    // changing"). `setMark('textStyle', { color: null })` alone does NOT revert the text — REPRODUCED:
    // apply Red, choose Default, and the span stays rgb(153,27,27). The mark survives with its old
    // inline style, so Default looked like a dead menu item and the writer had no way out of a
    // colour at all. This is the pairing Tiptap's own colour extension uses, and it must run in the
    // SAME chain: null the attribute, then drop any textStyle mark left carrying nothing.
    // Applying a colour is unchanged — the cleanup is a no-op on a mark that still has attributes,
    // which is why it can sit on both paths rather than being branched on `color`.
    editor.chain().focus().setMark('textStyle', { color }).removeEmptyTextStyle().run()
    setColorOpen(false)
  }
  function applyAlign(a: Align) { ping(); setLastAlign(a); editor.chain().focus().setTextAlign(a).run(); setAlignOpen(false) }
  function applyListType(type: ListType) {
    ping(); setLastListType(type); setListOpen(false)
    if (type === 'taskList') { editor.chain().focus().toggleTaskList().run(); return }
    if (type === 'bulletList') { editor.chain().focus().toggleBulletList().run(); return }
    const inOrdered = editor.isActive('orderedList')
    const cur = (editor.getAttributes('orderedList') as { listType?: string }).listType ?? 'decimal'
    if (inOrdered && cur === type) editor.chain().focus().toggleOrderedList().run()
    else if (inOrdered) editor.chain().focus().updateAttributes('orderedList', { listType: type }).run()
    else { editor.chain().focus().toggleOrderedList().run(); if (type !== 'decimal') editor.chain().focus().updateAttributes('orderedList', { listType: type }).run() }
  }
  // Indent: whole-line/block indent = paddingLeft (stepped, stackable); paragraph first-line
  // indent = textIndent (on/off). Values live on ParagraphStyle attrs. A non-em paddingLeft
  // (pasted px values) unindents straight to none. 'clear' keeps the old ⌫¶ escape hatch for
  // stuck pasted margins/line-height that the remove actions don't touch.
  const INDENT_STEP = 2 // em
  const emVal = (v: string | null | undefined): number | null => {
    const m = /^([\d.]+)em$/.exec(v ?? ''); return m ? parseFloat(m[1]) : null
  }
  function applyIndent(action: IndentAction) {
    ping()
    if (action !== 'clear') setLastIndent(action)
    const attrs = editor.getAttributes('paragraph') as { paddingLeft?: string | null; textIndent?: string | null }
    if (action === 'line+') {
      const cur = emVal(attrs.paddingLeft) ?? 0
      editor.chain().focus().setParaStyle({ paddingLeft: `${cur + INDENT_STEP}em` }).run()
    } else if (action === 'line-') {
      const cur = emVal(attrs.paddingLeft)
      const next = cur != null ? cur - INDENT_STEP : 0
      editor.chain().focus().setParaStyle({ paddingLeft: next > 0 ? `${next}em` : null }).run()
    } else if (action === 'para+') {
      editor.chain().focus().setParaStyle({ textIndent: `${INDENT_STEP}em` }).run()
    } else if (action === 'para-') {
      editor.chain().focus().setParaStyle({ textIndent: null }).run()
    } else {
      // Clear line format — the one-click fix for pasted layout debris. Pasted "indents" arrive
      // THREE different ways and this clears all of them: (1) the six ParagraphStyle attrs,
      // (2) textAlign (justify/center riding in on pasted HTML is a separate TextAlign attr),
      // (3) LITERAL leading whitespace/tabs — content, not attrs (Peter's stuck "Honours
      // Proposal" title, 2026-07-10).
      editor.chain().focus()
        .setParaStyle({ lineHeight: null, marginBottom: null, marginTop: null, paddingLeft: null, paddingRight: null, textIndent: null })
        .unsetTextAlign()
        .run()
      const { state } = editor
      const dels: Array<{ from: number; to: number }> = []
      state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
        if (!node.isTextblock) return
        // Length of the block-leading whitespace run, walked across adjacent TEXT children only
        // (a leading atom — math, citation — stops the walk so offsets stay position-true).
        let len = 0
        for (let i = 0; i < node.childCount; i++) {
          const ch = node.child(i)
          if (!ch.isText) break
          const m = /^\s+/.exec(ch.text || '')
          if (!m) break
          len += m[0].length
          if (m[0].length < (ch.text || '').length) break
        }
        if (len > 0) dels.push({ from: pos + 1, to: pos + 1 + len })
        return false // don't descend into inline content
      })
      if (dels.length) {
        const tr = editor.state.tr
        for (const d of dels.sort((a, b) => b.from - a.from)) tr.delete(d.from, d.to)
        editor.view.dispatch(tr)
      }
    }
    setIndentOpen(false)
  }

  // CLICK APPLIES, HOLD OPENS THE MENU — every button on this bar behaves the same way now
  // (Peter, 2026-08-23: "clicking any of these style buttons applies the given style. Only click
  // and hold should bring up the menu"). Font and size used to be the exceptions: a plain click
  // did nothing at all, which reads as a dead button. They now re-apply the last value the writer
  // picked, exactly as the highlight and text-colour buttons already did — and, like those, fall
  // back to opening the menu when there is nothing remembered yet, because a click that silently
  // does nothing is the thing being fixed.
  const fontPress   = useLongPress(
    () => setFont(lastFont ?? docMode().font ?? HOUSE_FONT_CSS),
    () => { closeAll(); holdOpenRef.current = true; setFontOpen(true) },
  )
  const sizePress   = useLongPress(
    () => setSize(lastSize ?? docMode().sizePt ?? HOUSE_SIZE_PT),
    () => { closeAll(); holdOpenRef.current = true; setSizeOpen(true) },
  )
  const fmtPress    = useLongPress(() => applyFmt(lastFmt),          () => { closeAll(); holdOpenRef.current = true; setFmtOpen(true) })
  const hlPress     = useLongPress(
    () => applyHighlight(lastHlColor ?? HOUSE_HL_COLOR),
    () => { closeAll(); holdOpenRef.current = true; setHlOpen(true) },
  )
  const colorPress  = useLongPress(
    () => applyTextColor(lastTxtColor ?? HOUSE_TXT_COLOR),
    () => { closeAll(); holdOpenRef.current = true; setColorOpen(true) },
  )
  const listPress   = useLongPress(() => applyListType(lastListType), () => { closeAll(); holdOpenRef.current = true; setListOpen(true) })
  const alignPress  = useLongPress(() => applyAlign(lastAlign),       () => { closeAll(); holdOpenRef.current = true; setAlignOpen(true) })
  const indentPress = useLongPress(() => applyIndent(lastIndent),     () => { closeAll(); holdOpenRef.current = true; setIndentOpen(true) })

  // THE PRESS CONTRACT (Peter, 2026-09-18), the same on every button here:
  //   click            → applies the button's current default;
  //   click-and-hold   → opens the popup; release ON an item selects it (the item's onPointerUp),
  //                      release OUTSIDE closes only the popup — the style bar stays — and release
  //                      on the button itself leaves the popup open for a click;
  //   click while open → closes only the popup (no apply).
  // `holdOpenRef` marks a popup opened by THIS press so the release rule applies once, and
  // `wasOpenAtDown` remembers, per press, whether the click began with the popup already up.
  const holdOpenRef = useRef(false)
  const wasOpenAtDownRef = useRef(false)
  const press = (p: ReturnType<typeof useLongPress>, isOpen: boolean) => ({
    ...p,
    onPointerDown: (e: React.PointerEvent) => { wasOpenAtDownRef.current = isOpen; holdOpenRef.current = false; p.onPointerDown(e) },
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation()
      if (wasOpenAtDownRef.current) { wasOpenAtDownRef.current = false; closeAll(); return }
      p.onClick()
    },
  })
  useEffect(() => {
    if (!anyOpen) return
    const onUp = (e: PointerEvent) => {
      if (!holdOpenRef.current) return
      holdOpenRef.current = false
      // By the point: the popup's full-screen scrim is the event target when the release lands
      // back on the button, so the target alone would read every in-place release as "outside".
      const under = document.elementsFromPoint(e.clientX, e.clientY)
      if (under.some(el => el.closest('[data-iw-stylepop], [data-iw-styletrigger]'))) return
      closeAll()
    }
    document.addEventListener('pointerup', onUp)
    return () => document.removeEventListener('pointerup', onUp)
  }, [anyOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  function above(ref: React.RefObject<HTMLElement | null>): React.CSSProperties {
    const br = ref.current?.getBoundingClientRect()
    if (!br) return { position: 'fixed', bottom: 80, left: 10 }
    const vh = window.visualViewport?.height ?? window.innerHeight
    return { position: 'fixed', bottom: Math.max(8, Math.round(vh - br.top + 8)), left: Math.max(8, Math.round(br.left)) }
  }
  const box = (w: number): React.CSSProperties => ({ border: `1px solid ${INK}55`, borderRadius: 12, width: w })
  // Desktop: every picker is the shared DESKTOP POPUP (styles/panelSheet.ts) — fixed above its
  // button at ONE height (gap + tail, the same for all eight, "a bit more" than before), the SVG
  // tail on the button, content-sized so there is no slack on the right. Phone: the old boxes.
  const pop = (ref: React.RefObject<HTMLElement | null>, w: number): React.CSSProperties =>
    phone ? { ...above(ref), ...box(w) } : { ...desktopPopupStyle(ref.current?.getBoundingClientRect(), w), minWidth: 0, width: 'max-content' }
  const popClass = `z-[99] iw-touch-guard iw-nightable bg-white shadow-xl ${phone ? '' : DESKTOP_POPUP_CLASS}`

  // Font panel is MULTI-COLUMN (Peter, 2026-07-16): 2 columns on desktop, 3 on phone — 17 families
  // in one column was a long scroll. Group headers span the full row (gridColumn 1/-1) so they stay
  // readable separators rather than becoming cells. It's the only popup wider than its button, so
  // its left edge is clamped to the viewport (above() anchors to the button and would overflow the
  // right edge on a phone when the S button sits right-of-centre).
  const FONT_COLS = phone ? 3 : 2
  const FONT_PANEL_W = phone ? 324 : 272
  const fontPanelStyle = (): React.CSSProperties => {
    const pos = above(fontBtnRef)
    const vw = window.innerWidth
    const left = Math.min(typeof pos.left === 'number' ? pos.left : 8, Math.max(8, vw - FONT_PANEL_W - 8))
    return {
      ...(phone ? { ...pos, ...box(FONT_PANEL_W), left } : pop(fontBtnRef, FONT_PANEL_W)),
      display: 'grid', gridTemplateColumns: `repeat(${FONT_COLS}, minmax(0, 1fr))`, alignItems: 'start',
    }
  }

  // Circular badge buttons everywhere. Phone: same circles as desktop, ~19% bigger (38px — the max
  // nine controls fit a 360px row with the tightened spacing) for comfortable tapping. flex-shrink-0
  // keeps them true circles — without it a tight row squeezes them oval.
  const circleSize = phone ? 'w-[38px] h-[38px] flex-shrink-0' : 'w-8 h-8'
  const pill = (open: boolean, hl = false): string =>
    `flex items-center justify-center ${circleSize} rounded-full border transition-colors ${open || hl ? 'border-[#302438] text-[#302438]' : 'border-stone-200 text-stone-500 hover:border-stone-400'}`

  const fontClass = `flex items-center justify-center ${phone ? 'h-[38px]' : 'h-8'} px-1.5 rounded-full border border-stone-200 text-stone-500 hover:border-stone-400 transition-colors text-left whitespace-nowrap text-xs min-w-[2.5rem]`
  const sizeClass = `flex items-center justify-center ${phone ? 'h-[38px]' : 'h-8'} px-2 rounded-full border border-stone-200 text-stone-500 hover:border-stone-400 transition-colors cursor-pointer text-xs tabular-nums min-w-[2.5rem]`

  return (
    <div
      // Both platforms spread across the row: the bar takes the toolbar's width and the controls
      // fit it (desktop gap = the main row's --iw-bar-gap, index.css .iw-desktop-bar).
      className="flex items-center justify-between text-sm text-stone-500 font-serif w-full"
      onMouseDown={e => { if (!(e.target as Element).closest('input')) e.preventDefault() }}
      onMouseEnter={() => onActivity?.()}
    >
      {/* Font — opens on click-and-hold only */}
      <button ref={fontBtnRef} type="button" data-iw-styletrigger="" {...press(fontPress, fontOpen)}
        className={fontClass}
        title="Font (hold to change)">
        {curFont.slice(0, 3).toLowerCase()}
      </button>
      {fontOpen && createPortal(
        <><div className="fixed inset-0 z-[98]" onMouseDown={() => setFontOpen(false)} />
        <div data-iw-stylepop="" className={`${popClass} py-1.5`} style={fontPanelStyle()}
          onPointerDown={e => { e.stopPropagation(); e.preventDefault() }}>
          {FONTS.map((f, i) => (<Fragment key={f.label}>
            {(i === 0 || FONTS[i - 1].group !== f.group) && (
              <div className={`${phone ? 'px-2' : 'px-3'} pt-1.5 pb-0.5 text-[10px] uppercase tracking-widest select-none`}
                style={{ color: 'var(--iw-pill-fg, #a8a29e)', gridColumn: '1 / -1' }}>{f.group}</div>
            )}
            <button type="button"
              onPointerDown={e => e.preventDefault()} onPointerUp={() => setFont(f.css)}
              className={`w-full text-left ${phone ? 'px-2' : 'px-3'} py-1.5 text-sm hover:bg-stone-50 truncate`}
              style={{ fontFamily: f.css, color: f.label === curFont ? INK : '#374151',
                fontWeight: f.label === curFont ? 500 : 400,
                borderLeft: f.label === curFont ? `2px solid ${INK}` : '2px solid transparent' }}>
              {f.label}
            </button>
          </Fragment>))}
        </div></>,
        document.body,
      )}

      {/* Size — opens on click-and-hold only */}
      <button ref={sizeBtnRef} type="button" data-iw-styletrigger="" {...press(sizePress, sizeOpen)}
        className={sizeClass}
        title="Font size (hold to change)">
        <span className="text-xs select-none">{curSize}</span>
      </button>
      {sizeOpen && createPortal(
        <><div className="fixed inset-0 z-[98]" onMouseDown={() => setSizeOpen(false)} />
        <div data-iw-stylepop="" className={`${popClass} py-1.5 overflow-y-auto`} style={{ ...pop(sizeBtnRef, 64), width: 64, maxHeight: 280 }}
          onPointerDown={e => { e.stopPropagation(); e.preventDefault() }}>
          {FONT_SIZES.map(sz => (
            <button key={sz} type="button"
              onPointerDown={e => e.preventDefault()} onPointerUp={() => setSize(sz)}
              className="w-full text-center px-2 py-1 text-sm hover:bg-stone-50"
              style={{ color: sz === curSize ? INK : '#374151', fontWeight: sz === curSize ? 600 : 400, background: sz === curSize ? `${INK}12` : undefined }}>
              {sz}
            </button>
          ))}
        </div></>,
        document.body,
      )}

      {/* B — tap=last fmt, hold=picker */}
      <button ref={fmtBtnRef} type="button" data-iw-styletrigger="" {...press(fmtPress, fmtOpen)}
        className={pill(fmtOpen)}
        style={{ ...CHAR_FMT_STYLES[lastFmt], textAlign: 'center', fontSize: '0.82rem' }}
        title="Character formatting (hold for options)">
        {CHAR_FMT_LABELS[lastFmt]}
      </button>
      {fmtOpen && createPortal(
        <><div className="fixed inset-0 z-[98]" onMouseDown={() => setFmtOpen(false)} />
        <div data-iw-stylepop="" className={`${popClass} py-1`} style={pop(fmtBtnRef, 140)}
          onPointerDown={e => { e.stopPropagation(); e.preventDefault() }}>
          {(['bold', 'italic', 'underline', 'strike'] as CharFmt[]).map(fmt => (
            <button key={fmt} type="button"
              onPointerDown={e => e.preventDefault()} onPointerUp={() => { applyFmt(fmt); setFmtOpen(false) }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-stone-50"
              style={{ ...CHAR_FMT_STYLES[fmt], color: editor.isActive(fmt) ? INK : '#374151',
                borderLeft: editor.isActive(fmt) ? `2px solid ${INK}` : '2px solid transparent' }}>
              {CHAR_FMT_NAMES[fmt]}
            </button>
          ))}
        </div></>,
        document.body,
      )}

      {/* H — tap=last colour (toggles off on same-colour text), hold=picker */}
      <button ref={hlBtnRef} type="button" data-iw-styletrigger="" {...press(hlPress, hlOpen)}
        className={pill(hlOpen, !!lastHlColor)}
        style={{ textAlign: 'center', fontSize: '0.7rem',
          background: lastHlColor ?? undefined, color: (hlOpen || lastHlColor) ? (hlOpen ? INK : '#374151') : '#6b7280' }}
        title="Highlight (hold for colours; same colour again removes it)">
        {hlFace}
      </button>
      {hlOpen && createPortal(
        <><div className="fixed inset-0 z-[98]" onMouseDown={() => setHlOpen(false)} />
        <div data-iw-stylepop="" className={`${popClass} p-2`} style={pop(hlBtnRef, 156)}
          onPointerDown={e => { e.stopPropagation(); e.preventDefault() }}>
          <div className="grid grid-cols-3 gap-1.5">
            {HIGHLIGHT_COLORS.map(h => (
              <button key={h.label} type="button"
                onPointerDown={e => e.preventDefault()} onPointerUp={() => applyHighlight(h.color)}
                className="rounded py-1 text-[0.68rem] text-center hover:opacity-80 border"
                style={{ background: h.color ?? '#f3f4f6', borderColor: curHlColor === h.color ? INK : (h.color ? 'transparent' : '#d1d5db'), color: '#374151' }}>
                {h.label}
              </button>
            ))}
          </div>
        </div></>,
        document.body,
      )}

      {/* T (text colour) — tap=last colour, hold=palette */}
      <button ref={colorBtnRef} type="button" data-iw-styletrigger="" {...press(colorPress, colorOpen)}
        className={pill(colorOpen)}
        style={{ textAlign: 'center', fontSize: '0.7rem', fontWeight: 600,
          color: lastTxtColor ?? 'var(--iw-ink, #302438)' }}
        title="Text colour (hold for palette)">
        {txtFace}
      </button>
      {colorOpen && createPortal(
        <><div className="fixed inset-0 z-[98]" onMouseDown={() => setColorOpen(false)} />
        <div data-iw-stylepop="" className={`${popClass} py-1.5`} style={pop(colorBtnRef, 136)}
          onPointerDown={e => { e.stopPropagation(); e.preventDefault() }}>
          {TEXT_COLORS.map(c => (
            <button key={c.label} type="button"
              onPointerDown={e => e.preventDefault()} onPointerUp={() => applyTextColor(c.color)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-stone-50"
              style={{ color: curTxtColor === c.color ? INK : '#374151', fontWeight: curTxtColor === c.color ? 500 : 400,
                borderLeft: curTxtColor === c.color ? `2px solid ${INK}` : '2px solid transparent' }}>
              <span className="w-3.5 h-3.5 rounded-full border flex-shrink-0"
                style={{ background: c.color ?? 'transparent', borderColor: c.color ? 'transparent' : '#d1d5db' }} />
              <span>{c.label}</span>
            </button>
          ))}
        </div></>,
        document.body,
      )}

      {/* A — tap=last align, hold=picker */}
      <button ref={alignBtnRef} type="button" data-iw-styletrigger="" {...press(alignPress, alignOpen)}
        className={pill(alignOpen) + ' font-serif'}
        style={{ textAlign: 'center', fontSize: '0.7rem' }}
        title="Alignment (hold for options)">
        {curAlign.slice(0, 3)}
      </button>
      {alignOpen && createPortal(
        <><div className="fixed inset-0 z-[98]" onMouseDown={() => setAlignOpen(false)} />
        <div data-iw-stylepop="" className={`${popClass} py-1.5`} style={pop(alignBtnRef, 110)}
          onPointerDown={e => { e.stopPropagation(); e.preventDefault() }}>
          {(['left', 'center', 'right', 'justify'] as Align[]).map(a => (
            <button key={a} type="button"
              onPointerDown={e => e.preventDefault()} onPointerUp={() => applyAlign(a)}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-stone-50"
              style={{ color: a === curAlign ? INK : '#374151', fontWeight: a === curAlign ? 500 : 400,
                borderLeft: a === curAlign ? `2px solid ${INK}` : '2px solid transparent' }}>
              {ALIGN_LABELS[a]}
            </button>
          ))}
        </div></>,
        document.body,
      )}

      {/* L — tap=last list, hold=picker */}
      <button ref={listBtnRef} type="button" data-iw-styletrigger="" {...press(listPress, listOpen)}
        className={pill(listOpen, listActive)}
        style={{ textAlign: 'center', fontSize: '0.82rem' }}
        title="Lists (hold for types)">
        {LIST_TYPE_LABELS[lastListType]}
      </button>
      {listOpen && createPortal(
        <><div className="fixed inset-0 z-[98]" onMouseDown={() => setListOpen(false)} />
        <div data-iw-stylepop="" className={`${popClass} py-1.5`} style={pop(listBtnRef, 148)}
          onPointerDown={e => { e.stopPropagation(); e.preventDefault() }}>
          {([
            { type: 'bulletList'  as ListType, label: 'bullets',  preview: '•' },
            { type: 'taskList'    as ListType, label: 'checkboxes', preview: '☐' },
            { type: 'decimal'     as ListType, label: 'numbered', preview: '1.' },
            { type: 'lower-roman' as ListType, label: 'roman',    preview: 'i.' },
            { type: 'lower-alpha' as ListType, label: 'alphabet',  preview: 'a.' },
            { type: 'upper-roman' as ListType, label: 'roman caps', preview: 'I.' },
          ]).map(item => {
            const active = item.type === 'taskList'
              ? editor.isActive('taskList')
              : item.type === 'bulletList'
              ? editor.isActive('bulletList')
              : editor.isActive('orderedList') &&
                ((editor.getAttributes('orderedList') as { listType?: string }).listType ?? 'decimal') === item.type
            return (
              <button key={item.type} type="button"
                onPointerDown={e => e.preventDefault()} onPointerUp={() => applyListType(item.type)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-stone-50"
                style={{ color: active ? INK : '#374151', fontWeight: active ? 500 : 400,
                  borderLeft: active ? `2px solid ${INK}` : '2px solid transparent' }}>
                <span className="w-5 text-center tabular-nums" style={{ color: INK, opacity: 0.8 }}>{item.preview}</span>
                <span>{item.label}</span>
              </button>
            )
          })}
        </div></>,
        document.body,
      )}

      {/* ⇥ (indent) — tap=last indent action, hold=picker. Replaces the old ⌫¶ button; its
          clear-line-formatting escape hatch lives on as the drop-up's last row. */}
      <button ref={indentBtnRef} type="button" data-iw-styletrigger="" {...press(indentPress, indentOpen)}
        className={pill(indentOpen)}
        style={{ textAlign: 'center', fontSize: '0.82rem' }}
        title="Indent (hold for options)">
        ⇥
      </button>
      {indentOpen && createPortal(
        <><div className="fixed inset-0 z-[98]" onMouseDown={() => setIndentOpen(false)} />
        <div data-iw-stylepop="" className={`${popClass} py-1.5`} style={pop(indentBtnRef, 168)}
          onPointerDown={e => { e.stopPropagation(); e.preventDefault() }}>
          {INDENT_ITEMS.map(item => (
            <button key={item.action} type="button"
              onPointerDown={e => e.preventDefault()} onPointerUp={() => applyIndent(item.action)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-stone-50"
              style={{ color: '#374151', borderLeft: '2px solid transparent' }}>
              <span className="w-6 text-center" style={{ color: INK, opacity: 0.8 }}>{item.preview}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div></>,
        document.body,
      )}

      {/* ∀ — select all */}
      <button type="button"
        onClick={() => { ping(); editor.chain().focus().selectAll().run() }}
        title="Select all"
        className={pill(false) + ' text-sm'}>
        ∀
      </button>
    </div>
  )
}
