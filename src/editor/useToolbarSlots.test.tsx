// @vitest-environment jsdom
//
// CHARACTERIZATION of the toolbar slot customisation — the writer's arrangement of the footer's
// slot row and the positional hotkeys that address it — written to hold what TiptapEditor.tsx did
// BEFORE this block moved out of it (2026-09-15, docs/REFACTOR-QUEUE.md item 3, seam 1). Every case
// below is an observation of the shipped behaviour read off the unmoved code, not a guarantee
// invented here — the distinction matters because a test written AFTER a move can only certify the
// move against the mover's own assumptions (CLAUDE.md, "write the characterization test before the
// move"; the `docTitle.test.ts` precedent).
//
// WHY A HARNESS AND NOT THE EDITOR. Rendering TiptapEditor itself in jsdom was tried first and
// abandoned on evidence: eight missing platform APIs/contexts across three render layers (canvas
// getContext at PaginationExtension's module scope, a Router for OptionsMenu's useNavigate,
// matchMedia, ResizeObserver, document.elementFromPoint in a Scroll.tsx layout effect, indexedDB,
// navigator.storage) with the 63-effect layer only just begun. A harness that needs that many stubs
// measures a fiction (docs/RULES.md R5). So the hook renders here inside a footer of the SAME SHAPE
// as the real one — wrappers with `.iw-slot`, one button each, `slotElsRef` registered by index,
// `toolbarPickerRef` on the ▲ wrapper — and `toolbarSlotsWiring.test.ts` pins that the REAL footer
// still has that shape. The in-browser truth remains `scripts/toolbar.prove.mjs`.
//
// MUTATION-PROVED 2026-09-15, each applied to useToolbarSlots.ts, the named test(s) observed to fail,
// then reverted:
//   h1 Alt+N clicks circle 0 instead of N            → 2 fail (Alt+N position; Alt+digit during the hold)
//   h2 drop the `mayPersistConfig` refusal           → 1 fail (NEVER writes back over a failed parse)
//   h3 `if (!e.altKey) return` (other modifiers pass) → 1 fail (Alt with any other modifier)
//   h4 ALT_HINT_DELAY_MS = 0                          → 1 fail (Alt alone, held 400ms)
//   h5 slop no longer cancels the row hold            → 1 fail (movement before the hold elapses)
//   h6 drop `saveStoredRow`                           → 2 fail (write-back; failed-parse still moves default)
//   h7 drop the `isTouchDevice()` early return        → 1 fail (a phone binds nothing)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
import { useToolbarSlots } from './useToolbarSlots'
import { DEFAULT_SLOTS, SLOT_KEY, overflowSlots, hotkeyHintFor, slotIsLive, type SlotId } from './toolbarContract'
import { setProdLedgerEnabled, _resetProdLedgerFlag } from '../productivity/ledgerFlag'
import type { InkwaveDocument } from '../types/document'

// ─── the harness: a footer of the real footer's shape ────────────────────────────────────────

const TITLE: Record<SlotId, string> = {
  bib: 'Bibliography / citations', guide: 'Guide', math: 'Math', receipt: 'Review — comments & track changes',
  page: 'Page', style: 'Style', settings: 'Settings', clock: 'Pomodoro & your ledger',
  media: 'Import a photo, audio or video', music: 'Music — turn a photo into a piece',
}

// Deterministic geometry: jsdom lays nothing out, so each row circle answers its own rectangle.
// Centres 120, 180, 240, 300, 360, 420 — a 60px step — on a row at y 500–540.
const SLOT_LEFT0 = 100, SLOT_STEP = 60, SLOT_W = 40, SLOT_TOP = 500, SLOT_H = 40
function rectFor(i: number): DOMRect {
  const left = SLOT_LEFT0 + i * SLOT_STEP
  return {
    left, right: left + SLOT_W, width: SLOT_W, top: SLOT_TOP, bottom: SLOT_TOP + SLOT_H, height: SLOT_H,
    x: left, y: SLOT_TOP, toJSON() { return {} },
  } as DOMRect
}
const centreOf = (i: number) => SLOT_LEFT0 + i * SLOT_STEP + SLOT_W / 2

interface Log { clicks: string[]; commits: InkwaveDocument[] }

function Harness({ doc, log, phone }: { doc: InkwaveDocument; log: Log; phone: boolean }) {
  const docRef = useRef(doc)
  const commitDoc = (updated: InkwaveDocument) => { docRef.current = updated; log.commits.push(updated) }
  const api = useToolbarSlots({ docRef, commitDoc })
  const isTouch = phone
  const slotButton = (id: SlotId) => (
    <button type="button" title={TITLE[id]} data-slot={id} onClick={() => log.clicks.push(id)} />
  )
  return (
    <div className="iw-toolbar-circles" onClickCapture={(e) => {
      if (Date.now() < api.suppressSlotClickUntilRef.current) { e.preventDefault(); e.stopPropagation() }
    }}>
      <div className="relative" ref={api.toolbarPickerRef}>
        <button type="button" data-test="picker" onClick={() => { log.clicks.push('▲'); api.setToolbarPickerOpen(o => !o) }} />
        <div data-test="drawer" className={api.toolbarPickerOpen ? '' : 'invisible'}>
          {overflowSlots(api.toolbarSlots).map(id => (
            <div key={id} className="iw-slot" onClick={() => api.setToolbarPickerOpen(false)}
              {...(isTouch ? api.popupTouchHandlers(id) : {})}>
              {slotButton(id)}
            </div>
          ))}
        </div>
      </div>
      {api.toolbarSlots.map((id, i) => (
        <div key={id} className="iw-slot relative"
          ref={el => { api.slotElsRef.current[i] = el; if (el) el.getBoundingClientRect = () => rectFor(i) }}
          {...(isTouch ? api.slotTouchHandlers(i) : {})}>
          {slotButton(id)}
          {api.altHeld && !isTouch && hotkeyHintFor(i) && <span data-hint="">{hotkeyHintFor(i)}</span>}
        </div>
      ))}
      {/* The desktop drop's write path, without HTML5 drag: swap the first two circles. */}
      <button type="button" data-test="swap" onClick={() => {
        const next = [...api.toolbarSlots]; [next[0], next[1]] = [next[1], next[0]]; api.updateSlots(next)
      }} />
      <output data-test="state">{JSON.stringify({
        row: api.toolbarSlots, view: api.slotDragView, target: api.popupDragTarget,
        active: api.popupDragActive, open: api.toolbarPickerOpen, alt: api.altHeld,
      })}</output>
    </div>
  )
}

interface State { row: SlotId[]; view: { fromIdx: number; overIdx: number; step: number } | null; target: number | null; active: boolean; open: boolean; alt: boolean }
const stateOf = (c: HTMLElement): State => JSON.parse(c.querySelector('output')!.textContent!)
const hintsIn = (c: HTMLElement) => [...c.querySelectorAll('[data-hint]')].map(s => s.textContent)
const rowSlot = (c: HTMLElement, i: number) => c.querySelectorAll<HTMLElement>('.iw-slot.relative')[i]
const drawerEntry = (c: HTMLElement, id: SlotId) =>
  c.querySelector<HTMLElement>(`[data-test="drawer"] [data-slot="${id}"]`)!.parentElement!

function makeDoc(toolbar?: unknown): InkwaveDocument {
  return {
    id: 'doc-1', title: 'Untitled',
    contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
    createdAt: '2026-09-15T00:00:00.000Z', updatedAt: '2026-09-15T00:00:00.000Z',
    schemaVersion: '0.1.0', scasLimitN: 'infinite', scasSessionSeed: 'seed',
    ...(toolbar !== undefined ? { toolbar: toolbar as InkwaveDocument['toolbar'] } : {}),
  }
}

// A CURATED, REORDERED six — the same one `scripts/toolbar.prove.mjs` uses, and for the same
// reason: the default order cannot tell "kept" from "reset".
const CURATED: SlotId[] = ['settings', 'style', 'receipt', 'math', 'guide', 'bib']

function mount({ toolbar, stored, phone = false }: { toolbar?: unknown; stored?: SlotId[]; phone?: boolean } = {}) {
  if (stored) localStorage.setItem(SLOT_KEY, JSON.stringify(stored))
  if (phone) {
    // isTouchDevice() asks this exact media query; jsdom has no matchMedia at all, so desktop is
    // the default and the phone is opted into per test.
    ;(window as unknown as { matchMedia: (q: string) => { matches: boolean } }).matchMedia =
      (q: string) => ({ matches: q === '(pointer: coarse) and (hover: none)' })
  }
  const log: Log = { clicks: [], commits: [] }
  const r = render(<Harness doc={makeDoc(toolbar)} log={log} phone={phone} />)
  return { c: r.container, log }
}

function key(type: 'keydown' | 'keyup', init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init })
  act(() => { window.dispatchEvent(e) })
  return e
}
// A plain Event wearing `touches`: jsdom cannot construct a Touch, and React's synthetic touch
// event only copies the field off the native event.
function touch(el: Element, type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel', points: { x: number; y: number }[] = []) {
  const ev = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(ev, 'touches', { value: points.map(p => ({ clientX: p.x, clientY: p.y })) })
  act(() => { el.dispatchEvent(ev) })
}
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  cleanup() // MANDATORY without globals:true — or the next test measures this one's still-mounted footer
  vi.useRealTimers()
  localStorage.clear()
  _resetProdLedgerFlag() // the flag CACHES; cleared storage + reset = its default (ON wherever a window exists)
  delete (window as unknown as { matchMedia?: unknown }).matchMedia
})

// ─── the row it starts from ──────────────────────────────────────────────────────────────────

describe('the row it starts from — the resolution chain, wired', () => {
  it('a document that carries a layout opens with THAT layout, over the writer’s own', () => {
    const { c } = mount({ toolbar: { v: 1, row: CURATED }, stored: ['bib', 'guide', 'math', 'receipt', 'page', 'style'] })
    expect(stateOf(c).row).toEqual(CURATED)
  })
  it('a document with no layout opens with the writer’s stored default', () => {
    const { c } = mount({ stored: CURATED })
    expect(stateOf(c).row).toEqual(CURATED)
  })
  it('a writer with nothing gets the first-run six', () => {
    const { c } = mount()
    expect(stateOf(c).row).toEqual([...DEFAULT_SLOTS])
  })
})

// ─── hotkeys ─────────────────────────────────────────────────────────────────────────────────

describe('hotkeys — the hotkey IS the tap', () => {
  it('Alt+N clicks the Nth circle’s OWN button (position, not identity) and claims the key', () => {
    const { log } = mount({ toolbar: { v: 1, row: CURATED } })
    const e = key('keydown', { key: '3', altKey: true })
    expect(log.clicks).toEqual(['receipt'])       // third in the CURATED order — not third canonically
    expect(e.defaultPrevented).toBe(true)
  })
  it('Alt+7 addresses nothing on a six-slot row, and does not claim the key', () => {
    const { log } = mount({ toolbar: { v: 1, row: CURATED } })
    const e = key('keydown', { key: '7', altKey: true })
    expect(log.clicks).toEqual([])
    expect(e.defaultPrevented).toBe(false)
  })
  it('Alt+0 clicks the ▲ drawer’s own toggle', () => {
    const { c, log } = mount({ toolbar: { v: 1, row: CURATED } })
    const e = key('keydown', { key: '0', altKey: true })
    expect(log.clicks).toEqual(['▲'])
    expect(stateOf(c).open).toBe(true)
    expect(e.defaultPrevented).toBe(true)
  })
  it('Alt with any other modifier is a different chord, not a hotkey', () => {
    const { log } = mount({ toolbar: { v: 1, row: CURATED } })
    key('keydown', { key: '1', altKey: true, shiftKey: true })
    key('keydown', { key: '1', altKey: true, ctrlKey: true })
    key('keydown', { key: '1', altKey: true, metaKey: true })
    key('keydown', { key: '1' })
    expect(log.clicks).toEqual([])
  })
  it('⌘, and Ctrl+, click Settings from the row', () => {
    const { log } = mount({ toolbar: { v: 1, row: CURATED } })
    const e1 = key('keydown', { key: ',', metaKey: true })
    const e2 = key('keydown', { key: ',', ctrlKey: true })
    expect(log.clicks).toEqual(['settings', 'settings'])
    expect(e1.defaultPrevented && e2.defaultPrevented).toBe(true)
  })
  it('⌘, still reaches Settings when it lives in the ▲ drawer — one population', () => {
    const noSettings: SlotId[] = ['bib', 'guide', 'math', 'receipt', 'page', 'style']
    const { c, log } = mount({ toolbar: { v: 1, row: noSettings } })
    expect(stateOf(c).row).not.toContain('settings')
    key('keydown', { key: ',', metaKey: true })
    expect(log.clicks).toEqual(['settings'])
  })
  it('Alt+⌘, is not the preferences key', () => {
    const { log } = mount({ toolbar: { v: 1, row: CURATED } })
    key('keydown', { key: ',', metaKey: true, altKey: true })
    expect(log.clicks).toEqual([])
  })
  it('a phone binds nothing', () => {
    const { c, log } = mount({ toolbar: { v: 1, row: CURATED }, phone: true })
    key('keydown', { key: '1', altKey: true })
    key('keydown', { key: ',', metaKey: true })
    key('keydown', { key: 'Alt', altKey: true }); tick(1000)
    expect(log.clicks).toEqual([])
    expect(stateOf(c).alt).toBe(false)
  })
})

// ─── the Alt hints ───────────────────────────────────────────────────────────────────────────

describe('the Alt hints — a deliberate hold, never a chord', () => {
  it('Alt alone, held 400ms, wears 1…6 on the row in order', () => {
    const { c } = mount({ toolbar: { v: 1, row: CURATED } })
    key('keydown', { key: 'Alt', altKey: true })
    tick(399)
    expect(stateOf(c).alt).toBe(false)
    expect(hintsIn(c)).toEqual([])
    tick(1)
    expect(stateOf(c).alt).toBe(true)
    expect(hintsIn(c)).toEqual(['1', '2', '3', '4', '5', '6'])
  })
  it('a key arriving during the hold makes it a chord: the hint never shows', () => {
    const { c } = mount({ toolbar: { v: 1, row: CURATED } })
    key('keydown', { key: 'Alt', altKey: true })
    tick(100)
    key('keydown', { key: 'Backspace', altKey: true })   // ⌥⌫ — delete-word-left, many times a minute
    tick(1000)
    expect(stateOf(c).alt).toBe(false)
  })
  it('Alt+digit during the hold still fires instantly — the hotkey never consults the hint', () => {
    const { c, log } = mount({ toolbar: { v: 1, row: CURATED } })
    key('keydown', { key: 'Alt', altKey: true })
    tick(100)
    key('keydown', { key: '2', altKey: true })
    expect(log.clicks).toEqual(['style'])
    tick(1000)
    expect(stateOf(c).alt).toBe(false)
  })
  it('releasing Alt hides them again', () => {
    const { c } = mount({ toolbar: { v: 1, row: CURATED } })
    key('keydown', { key: 'Alt', altKey: true }); tick(400)
    expect(stateOf(c).alt).toBe(true)
    key('keyup', { key: 'Alt', altKey: false })
    expect(stateOf(c).alt).toBe(false)
    expect(hintsIn(c)).toEqual([])
  })
  it('Alt+Tab away (window blur) drops them — the keyup never arrives', () => {
    const { c } = mount({ toolbar: { v: 1, row: CURATED } })
    key('keydown', { key: 'Alt', altKey: true }); tick(400)
    expect(stateOf(c).alt).toBe(true)
    act(() => { window.dispatchEvent(new Event('blur')) })
    expect(stateOf(c).alt).toBe(false)
  })
})

// ─── the write-back ──────────────────────────────────────────────────────────────────────────

describe('updateSlots — one write path, three destinations', () => {
  it('reorders the row, stores the writer’s default, and commits the document with the MERGED config', () => {
    // Authored with the ledger on (clock in the row); opened here with it OFF — SET, not assumed:
    // the flag is default ON wherever a window exists, and the first cut of this test assumed the
    // opposite and failed on the ORIGINAL behaviour (the corollary in CLAUDE.md, working). So `clock`
    // is not live and the RENDERED row omits it. The drag must not delete it from the author's file.
    setProdLedgerEnabled(false); _resetProdLedgerFlag()
    expect(slotIsLive('clock')).toBe(false)
    const { c, log } = mount({ toolbar: { v: 1, row: ['clock', 'page', 'style'] } })
    const before = stateOf(c).row
    expect(before).not.toContain('clock')
    fireEvent.click(c.querySelector('[data-test="swap"]')!)
    const after = [before[1], before[0], ...before.slice(2)]
    expect(stateOf(c).row).toEqual(after)
    expect(JSON.parse(localStorage.getItem(SLOT_KEY)!)).toEqual(after)
    expect(log.commits).toHaveLength(1)
    expect(log.commits[0].toolbar).toEqual({ v: 1, row: [...after, 'clock'] })
    expect(log.commits[0].updatedAt).not.toBe('2026-09-15T00:00:00.000Z')
  })
  it('a document with no layout gets one', () => {
    const { c, log } = mount({ stored: CURATED })
    fireEvent.click(c.querySelector('[data-test="swap"]')!)
    expect(log.commits[0].toolbar).toEqual({ v: 1, row: ['style', 'settings', 'receipt', 'math', 'guide', 'bib'] })
  })
  it('NEVER writes back over a layout it failed to parse — the screen and the default still move', () => {
    const { c, log } = mount({ toolbar: { v: 2, row: CURATED }, stored: CURATED })
    fireEvent.click(c.querySelector('[data-test="swap"]')!)
    expect(stateOf(c).row).toEqual(['style', 'settings', 'receipt', 'math', 'guide', 'bib'])
    expect(JSON.parse(localStorage.getItem(SLOT_KEY)!)).toEqual(['style', 'settings', 'receipt', 'math', 'guide', 'bib'])
    expect(log.commits).toEqual([])
  })
})

// ─── the ▲ drawer ────────────────────────────────────────────────────────────────────────────

describe('the ▲ drawer', () => {
  it('closes on a mousedown outside it and stays open on one inside', () => {
    const { c } = mount({ toolbar: { v: 1, row: CURATED } })
    fireEvent.click(c.querySelector('[data-test="picker"]')!)
    expect(stateOf(c).open).toBe(true)
    fireEvent.mouseDown(c.querySelector('[data-test="drawer"]')!)
    expect(stateOf(c).open).toBe(true)
    fireEvent.mouseDown(document.body)
    expect(stateOf(c).open).toBe(false)
  })
})

// ─── phone: touch-hold drag-to-reorder ───────────────────────────────────────────────────────

describe('phone: touch-hold drag-to-reorder of the row', () => {
  it('arms after a STILL 400ms hold, previews the hovered slot, commits the reorder on release', () => {
    const { c, log } = mount({ toolbar: { v: 1, row: CURATED }, phone: true })
    touch(rowSlot(c, 0), 'touchstart', [{ x: centreOf(0), y: 520 }])
    tick(399)
    expect(stateOf(c).view).toBeNull()
    tick(1)
    expect(stateOf(c).view).toEqual({ fromIdx: 0, overIdx: 0, step: SLOT_STEP })
    // Past the midpoint of slot 1 and over slot 2's centre: the preview retargets to 2.
    touch(rowSlot(c, 0), 'touchmove', [{ x: centreOf(2) + 10, y: 520 }])
    expect(stateOf(c).view?.overIdx).toBe(2)
    touch(rowSlot(c, 0), 'touchend')
    tick(160) // the drop glide, then the commit
    expect(stateOf(c).view).toBeNull()
    expect(stateOf(c).row).toEqual(['style', 'receipt', 'settings', 'math', 'guide', 'bib'])   // lifted 0, inserted at 2
    expect(log.commits).toHaveLength(1)
    expect(log.commits[0].toolbar).toEqual({ v: 1, row: ['style', 'receipt', 'settings', 'math', 'guide', 'bib'] })
  })
  it('the click the browser synthesises after the drop is swallowed for 400ms', () => {
    const { c, log } = mount({ toolbar: { v: 1, row: CURATED }, phone: true })
    touch(rowSlot(c, 0), 'touchstart', [{ x: centreOf(0), y: 520 }]); tick(400)
    touch(rowSlot(c, 0), 'touchmove', [{ x: centreOf(1) + 5, y: 520 }])
    touch(rowSlot(c, 0), 'touchend'); tick(160)
    fireEvent.click(rowSlot(c, 0).querySelector('button')!)
    expect(log.clicks).toEqual([])
    tick(400)
    fireEvent.click(rowSlot(c, 0).querySelector('button')!)
    expect(log.clicks).toHaveLength(1)
  })
  it('movement before the hold elapses is a tap or a slide, not a drag', () => {
    const { c, log } = mount({ toolbar: { v: 1, row: CURATED }, phone: true })
    touch(rowSlot(c, 0), 'touchstart', [{ x: centreOf(0), y: 520 }])
    tick(100)
    touch(rowSlot(c, 0), 'touchmove', [{ x: centreOf(0) + 15, y: 520 }])   // past the 10px slop
    tick(1000)
    expect(stateOf(c).view).toBeNull()
    touch(rowSlot(c, 0), 'touchend'); tick(200)
    expect(stateOf(c).row).toEqual(CURATED)
    expect(log.commits).toEqual([])
  })
  it('a cancelled touch commits nothing', () => {
    const { c, log } = mount({ toolbar: { v: 1, row: CURATED }, phone: true })
    touch(rowSlot(c, 0), 'touchstart', [{ x: centreOf(0), y: 520 }]); tick(400)
    touch(rowSlot(c, 0), 'touchmove', [{ x: centreOf(2), y: 520 }])
    expect(stateOf(c).view?.overIdx).toBe(2)
    touch(rowSlot(c, 0), 'touchcancel'); tick(160)
    expect(stateOf(c).view).toBeNull()
    expect(stateOf(c).row).toEqual(CURATED)
    expect(log.commits).toEqual([])
  })
  it('dropping a circle back on its own slot commits nothing', () => {
    const { c, log } = mount({ toolbar: { v: 1, row: CURATED }, phone: true })
    touch(rowSlot(c, 3), 'touchstart', [{ x: centreOf(3), y: 520 }]); tick(400)
    touch(rowSlot(c, 3), 'touchend'); tick(160)
    expect(stateOf(c).row).toEqual(CURATED)
    expect(log.commits).toEqual([])
  })
})

// ─── phone: touch-hold drag FROM the ▲ drop-up ONTO a row slot ───────────────────────────────

describe('phone: touch-hold drag from the ▲ drop-up onto a row slot', () => {
  it('arms on the hold, targets the slot under the finger (8px forgiving), swaps on release, closes the drawer', () => {
    const { c, log } = mount({ toolbar: { v: 1, row: CURATED }, phone: true })
    fireEvent.click(c.querySelector('[data-test="picker"]')!)
    expect(stateOf(c).open).toBe(true)
    const entry = drawerEntry(c, 'page')   // not in CURATED, so it is in the drawer
    touch(entry, 'touchstart', [{ x: 50, y: 300 }])
    tick(399)
    expect(stateOf(c).active).toBe(false)
    tick(1)
    expect(stateOf(c).active).toBe(true)
    touch(entry, 'touchmove', [{ x: rectFor(1).right + 6, y: SLOT_TOP - 6 }])   // inside slot 1's inflated rect
    expect(stateOf(c).target).toBe(1)
    touch(entry, 'touchend')
    expect(stateOf(c)).toMatchObject({ active: false, target: null, open: false })
    expect(stateOf(c).row).toEqual(['settings', 'page', 'receipt', 'math', 'guide', 'bib'])   // page took slot 1; style went to the pool
    expect(log.commits).toHaveLength(1)
    expect(log.commits[0].toolbar).toEqual({ v: 1, row: ['settings', 'page', 'receipt', 'math', 'guide', 'bib'] })
  })
  it('released off the row: nothing changes', () => {
    const { c, log } = mount({ toolbar: { v: 1, row: CURATED }, phone: true })
    const entry = drawerEntry(c, 'page')
    touch(entry, 'touchstart', [{ x: 50, y: 300 }]); tick(400)
    touch(entry, 'touchmove', [{ x: 50, y: 320 }])
    expect(stateOf(c).target).toBeNull()
    touch(entry, 'touchend')
    expect(stateOf(c).row).toEqual(CURATED)
    expect(log.commits).toEqual([])
  })
  it('sliding away before the hold cancels it', () => {
    const { c, log } = mount({ toolbar: { v: 1, row: CURATED }, phone: true })
    const entry = drawerEntry(c, 'page')
    touch(entry, 'touchstart', [{ x: 50, y: 300 }]); tick(100)
    touch(entry, 'touchmove', [{ x: 50, y: 330 }])
    tick(1000)
    expect(stateOf(c).active).toBe(false)
    touch(entry, 'touchend')
    expect(log.commits).toEqual([])
  })
})
