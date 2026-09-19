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
    // ⚠ RE-AIMED 2026-09-19. #9 pinned `setToolbarPickerOpen(o => !o)` here. Master opens the
    //   drawer through the PANEL system instead — `togglePanel('drawer')`, which is also what
    //   closes any bar in the same click — so the old literal cannot match and matching it would
    //   mean master had regressed. What this guard protects is unchanged and is the reason Alt+0
    //   works: the wrapper carries the ref, and the FIRST button inside it is the ▲ toggle.
    expect(CODE).toMatch(/ref=\{toolbarPickerRef\}>\s*<button type="button"[\s\S]{0,200}?togglePanel\('drawer'\)/)
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
    // ⚠ RE-AIMED 2026-09-19, same reason: the drop no longer closes the drawer with a local
    //   setter, because the drawer's open state is derived from the panel system now. The half
    //   that matters — the drop writes through the ONE write path — is asserted exactly as before,
    //   and the known-negative below is untouched.
    expect(CODE).toMatch(/onDrop=\{e => \{[\s\S]{0,600}?updateSlots\(newSlots\)/)
    expect(CODE).not.toMatch(/onDrop=\{e => \{[\s\S]{0,600}?setToolbarSlots\(/)
  })

  // The drawer is DERIVED from the row (one population) — the JSX never keeps its own list.
  // RULE (a), WHERE IT ACTUALLY LIVES. The hook owns the ROW; the component owns what is OPEN, so
  // the outside-click close of the ▲ is asserted here rather than in useToolbarSlots.test.tsx (see
  // the note there). Three things, each of which has been got wrong before:
  //   • POINTERDOWN, never mousedown — iOS withholds the synthetic mouse event under the touch
  //     guard's preventDefault, so a mousedown listener never fires on a phone at all.
  //   • the MAIN-ROW EXEMPTION — without it a pointerdown on a row circle closes the drawer before
  //     a drag out of the row can start, and dragging a slot into a blank honeycomb cell becomes
  //     impossible while looking like nothing is wrong.
  //   • the exemption is scoped to the drawer and to the main row, not to every panel and slot.
  it('the component closes the ▲ on an outside POINTERdown, and exempts a main-row slot drag', () => {
    // ⚠ ANCHORED TO *THIS* LISTENER, not to the word anywhere in the file. My first version
    //   asserted `addEventListener('pointerdown'` on its own, and a mutation changing THIS
    //   listener to mousedown survived it — the file has other pointerdown listeners that kept the
    //   match alive. A guard that can be satisfied by an unrelated line is not a guard.
    // ⚠ ANCHORED TO *THIS* LISTENER, and two attempts were needed. Asserting
    //   `addEventListener('pointerdown'` on its own let a mutation of this very line survive —
    //   the file has other pointerdown listeners. Anchoring to `const onDown = (e: PointerEvent)`
    //   ALSO survived, because there are two handlers with that identical name. The anchor has to
    //   be text that exists exactly once, so it starts from the slot-drag exemption below it.
    expect(CODE).toMatch(/const slotDragStart = open === 'drawer'[\s\S]{0,900}?addEventListener\('pointerdown', onDown, \{ capture: true \}\)/)
    expect(CODE).toMatch(/const slotDragStart = open === 'drawer' && !!t\?\.closest\('\.iw-slot'\) && !!mainRowRef\.current\?\.contains\(t\)/)
    expect(CODE).toMatch(/if \(open && !slotDragStart && tapClosesPanel\(t, open\)\) setOpenPanel\(null\)/)
    // KNOWN-NEGATIVE: a mousedown listener here would mean the phone silently lost the rule.
    expect(CODE).not.toMatch(/addEventListener\('mousedown'[^)]*\)[\s\S]{0,200}?tapClosesPanel/)
  })

  it('the ▲ drawer is overflowSlots(toolbarSlots)', () => {
    expect(CODE).toContain('const available = overflowSlots(toolbarSlots)')
  })
})
