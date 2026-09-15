// THE FOOTER'S HALF OF THE TOOLBAR-SLOT SEAM — ~5ms, no browser.
//
// WHY THIS FILE EXISTS. The toolbar slot customisation (the row the writer arranged, the ▲ drawer,
// drag + touch-hold reorder, the positional hotkeys) is ONE mechanism in TWO files: the state and
// the listeners live in `useToolbarSlots.ts`; the circles that give those listeners something to
// hit are JSX in `TiptapEditor.tsx`. A hook can be green in its own harness while the real footer
// quietly stops attaching the refs it depends on — `slotElsRef` is how Alt+3 finds the third
// circle, `toolbarPickerRef` is how Alt+0 finds the ▲ — and nothing but a hand-run browser probe
// would notice. This pins the JSX side: the wiring the hook's own tests cannot see.
//
// WRITTEN BEFORE THE MOVE (2026-09-15), against the unmoved TiptapEditor.tsx, and every assertion
// held there first. It stays pointed at TiptapEditor.tsx afterwards because the footer JSX did not
// move — only the state and listeners did.
//
// ⚠ COMMENTS ARE STRIPPED BEFORE SCANNING. The JSX comments beside these lines NAME the identifiers
// (“see slotTouchHandlers above”, “slotDragView preview”), so a raw-text scan would pass on prose
// alone. Judge what the code DOES.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SRC = readFileSync(resolve(__dirname, 'TiptapEditor.tsx'), 'utf8')
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

describe('the footer JSX wires the toolbar-slot hook', () => {
  // VOID GUARD. Every assertion below is about a file located by path and stripped. If the strip
  // ate the file or the path moved, "contains X" would be false for the wrong reason — but "does
  // not contain Y" would be TRUE and meaningless. Pin that the scan is looking at the footer.
  it('the scan found the footer', () => {
    expect(CODE.length).toBeGreaterThan(50_000)
    expect(CODE).toContain('iw-toolbar-circles')
    expect(CODE).toContain('toolbarSlots.map((slotId, slotIdx)')
  })

  // THE HOTKEY IS THE TAP: Alt+N dispatches `slotElsRef.current[N-1]`'s own button click, so the
  // row must register each circle's wrapper by INDEX. Registering by id, or not at all, leaves the
  // hotkeys addressing nothing while every circle still renders.
  it('each row circle registers its wrapper in slotElsRef by row index', () => {
    expect(CODE).toMatch(/ref=\{el => \{ slotElsRef\.current\[slotIdx\] = el \}\}/)
  })

  // Alt+0 clicks the FIRST button inside `toolbarPickerRef`. That is the ▲ toggle only while the
  // toggle stays the wrapper's first button — put the drop-up's "+" ahead of it and Alt+0 opens the
  // wrong thing with no error anywhere.
  it('the ▲ wrapper carries toolbarPickerRef and its first button is the ▲ toggle', () => {
    expect(CODE).toMatch(/ref=\{toolbarPickerRef\}>\s*<button type="button"\s+onClick=\{\(\) => \{ setToolbarPickerOpen\(o => !o\)/)
  })

  // Positional hints wear the row index, only while Alt is held, never on a phone.
  it('the hotkey hint renders on altHeld, off touch, from hotkeyHintFor(slotIdx)', () => {
    expect(CODE).toContain('{altHeld && !isTouch && hotkeyHintFor(slotIdx) && (')
  })

  // A click synthesised from a just-finished touch-hold drag must not activate the dropped button.
  // The hook sets the deadline; the row's capture handler is the ONLY place it is read.
  it('the row swallows the post-drag synthetic click in the capture phase', () => {
    expect(CODE).toMatch(/onClickCapture=\{\(e\) => \{\s*if \(Date\.now\(\) < suppressSlotClickUntilRef\.current\) \{\s*e\.preventDefault\(\)\s*e\.stopPropagation\(\)/)
  })

  // Both touch-hold drags: the row circles AND the ▲ drawer entries take the hook's handlers on
  // touch, and each wrapper owns its gesture with `touch-action: none` (per-element — it does not
  // inherit; without it the browser pans and sends pointercancel, and the drag never arms).
  it('row circles and drawer entries spread the touch handlers and declare touch-action', () => {
    expect(CODE).toContain('{...(isTouch ? slotTouchHandlers(slotIdx) : {})}')
    expect(CODE).toContain('{...(isTouch ? popupTouchHandlers(id) : {})}')
    expect(CODE).toMatch(/const base: React\.CSSProperties = \{ touchAction: 'none' \}/)
    expect(CODE).toMatch(/popupTouchHandlers\(id\) : \{\}\)\}\s*style=\{isTouch \? \{ touchAction: 'none' \} : undefined\}/)
  })

  // The desktop HTML5 drop writes through `updateSlots` — the ONE write path (state + the writer's
  // stored default + the document's config). A JSX drop that called setToolbarSlots directly would
  // reorder the screen and persist nothing.
  it('the desktop drop commits through updateSlots, never a bare state set', () => {
    expect(CODE).toMatch(/onDrop=\{e => \{[\s\S]{0,600}?updateSlots\(newSlots\)\s*setToolbarPickerOpen\(false\)/)
    expect(CODE).not.toMatch(/onDrop=\{e => \{[\s\S]{0,600}?setToolbarSlots\(/)
  })

  // The drawer is DERIVED from the row (one population) — the JSX never keeps its own list.
  it('the ▲ drawer is overflowSlots(toolbarSlots)', () => {
    expect(CODE).toContain('const available = overflowSlots(toolbarSlots)')
  })
})
