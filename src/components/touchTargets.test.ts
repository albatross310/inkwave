// THE PHONE RULES, KEPT IN THE GATE — because `phonetouch.prove.mjs` is not a guard.
//
// ⚠ WHY THIS FILE EXISTS. CLAUDE.md's sharpest lesson: "this codebase is excellent at ESTABLISHING
// truth and has no mechanism for KEEPING it — a proof that ran once is indistinguishable, six weeks
// later, from a proof that never ran, and the gate says green either way." Everything asserted here
// was MEASURED in a real browser at 375×667 with touch, and every one of those measurements is
// invisible to `pnpm test`. This runs in ~20ms with no browser and no fixture; the probe stays as
// the in-browser truth.
//
// ⚠ COMMENTS ARE STRIPPED BEFORE SCANNING, and that is load-bearing rather than tidy. This repo's
// comments must NAME the thing they forbid in order to forbid it — the fixes below are explained by
// sentences containing the literal words "onMouseDown", "mousedown" and "pan-x pan-y". A guard that
// read raw text would fire on its own documentation, and the tempting fix would be to delete the
// explanation. CLAUDE.md records that exact corrosion biting three lanes in one round.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

/** Strip // and /* *​/ comments (and JSX {/* *​/}) so the guard judges CODE, never prose about it. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const CSS = read('styles/index.css')
const READER = code(read('components/SourceBrowser.tsx'))
const PDF = code(read('components/PdfViewer.tsx'))
const PDF_READER = code(read('components/PdfReaderView.tsx'))

// The guard is worth nothing if the stripper ate the file or the file moved.
describe('the sources this suite scans are real', () => {
  it('reads all three components and the stylesheet', () => {
    expect(CSS.length).toBeGreaterThan(20_000)
    for (const [name, src] of [['SourceBrowser', READER], ['PdfViewer', PDF], ['PdfReaderView', PDF_READER]] as const) {
      expect(src.length, name).toBeGreaterThan(2_000)
      expect(src, name).toContain('return')
    }
  })
  it('the comment stripper removes prose but keeps code', () => {
    // Both halves, or a stripper that deleted everything would make every "absent" assertion vacuous.
    expect(code('/* onMouseDown */ const a = 1')).not.toContain('onMouseDown')
    expect(code('/* onMouseDown */ const a = 1')).toContain('const a = 1')
    expect(code('x() // onMouseDown\ny()')).not.toContain('onMouseDown')
    expect(code('x() // onMouseDown\ny()')).toContain('y()')
  })
})

// ── THE HIT-REGION RULE ─────────────────────────────────────────────────────────────────────────
describe('the .iw-tap hit region', () => {
  // Slice from the media query that OPENS the rule to the last selector inside it, so the
  // assertions below cannot accidentally read some other block that happens to say `44px`.
  const start = CSS.indexOf('.iw-tap, .iw-tap-row button { position: relative; }')
  const end = CSS.indexOf('.iw-tap-row .iw-tap-off button::after')
  const rule = start > -1 && end > start ? CSS.slice(start, end + 200) : ''

  it('the block is findable at all (VOID guard — an empty slice must fail, never pass)', () => {
    expect(start).toBeGreaterThan(-1)
    expect(rule.length).toBeGreaterThan(200)
  })

  it('lives inside the coarse-pointer media query — it must never reach a mouse', () => {
    // A desktop button growing an invisible 44px halo would swallow clicks meant for its neighbour.
    // Read the nearest @media ABOVE the rule rather than assuming the file's whitespace.
    const before = CSS.slice(0, start)
    const lastMedia = before.lastIndexOf('@media')
    expect(lastMedia).toBeGreaterThan(-1)
    expect(before.slice(lastMedia, lastMedia + 60)).toContain('(pointer: coarse) and (hover: none)')
  })

  it('is 44px TALL', () => {
    expect(rule).toMatch(/height:\s*max\(100%,\s*44px\)/)
  })

  it('is (control + row gap) WIDE, never a flat size', () => {
    // MEASURED: a flat expansion overlaps neighbours, and the later sibling wins the overlap — so
    // an unconditional 44px WIDTH takes pixels off the button next door. `phonetouch.prove.mjs`
    // reproduces it: a flat max(100%, 80px) fires its collision check on 24 pairs in the reader and
    // 22 in the PDF toolbar. Half the gap per side is the largest expansion that cannot contend.
    expect(rule).toMatch(/width:\s*calc\(100%\s*\+\s*var\(--iw-tap-x/)
    expect(rule).not.toMatch(/width:\s*max\(100%,\s*\d+px\)/)
  })

  it('never applies inside a vertical menu', () => {
    // The PDF toolbar's ⋮ drop-up is a COLUMN of items 2px apart: 44px-tall regions there would each
    // reach into both neighbours, and "Print" would eat part of "Export".
    expect(rule).toMatch(/\.iw-tap-row \[role="menu"\] button::after[\s\S]*?content:\s*none/)
  })

  it('paints nothing — it is a hit region, not a control', () => {
    expect(rule).toMatch(/background:\s*transparent/)
  })
})

// ── EVERY BAR THAT USES IT DECLARES ITS OWN GAP ─────────────────────────────────────────────────
describe('--iw-tap-x is set wherever the rule is used', () => {
  it('the PDF toolbar is a tap row and names its gap', () => {
    expect(PDF).toContain('className="iw-tap-row"')
    expect(PDF).toMatch(/--iw-tap-x['"] as string\]:\s*'3px'/)
  })
  it('the reader header, markup bar and zoom cluster each name their own gap', () => {
    // Three different gaps (8 / 6 / 2). One shared constant would be wrong in two of the three, and
    // wrong here means a region that reaches into the button beside it.
    for (const gap of ['8px', '6px', '2px']) {
      expect(READER, gap).toMatch(new RegExp(`--iw-tap-x['"] as string\\]:\\s*'${gap}'`))
    }
  })
})

// ── THE LIVE-VIEW CONTROLS ADDED 2026-08-30 ─────────────────────────────────────────────────────
// Peter asked for zoom + pan in the live browser and for the PDF's zoom controls to be ported. Every
// control in this file that shipped without a hit region had to be found by an audit; these are
// pinned as they land instead.
describe('the live-view zoom cluster and the refresh button are reachable by a finger', () => {
  it('every new control carries the hit region', () => {
    // The zoom cluster is four controls at a 2px gap, which is exactly the density that makes a
    // painted 22px button unhittable without one.
    for (const marker of ['Zoom out', 'Zoom in', 'Fit the page to the panel width and re-centre']) {
      const at = READER.indexOf(marker)
      expect(at, marker).toBeGreaterThan(-1)
      // The className sits within the same element as its aria-label/title.
      expect(READER.slice(at, at + 400), marker).toContain('iw-tap')
    }
    const refresh = READER.indexOf('data-iw-reader-refresh')
    expect(refresh).toBeGreaterThan(-1)
    expect(READER.slice(refresh, refresh + 400)).toContain('iw-tap')
  })
  it('the live bar WRAPS — at 375px its label, select and four controls do not fit on one line', () => {
    // A bar that overflows takes its own controls off the screen, which is the failure this file
    // was written after.
    const at = READER.indexOf("background: 'var(--iw-reader-bar")
    expect(at).toBeGreaterThan(-1)
    // Both bars that use that background declare flex-wrap; find the one carrying the zoom cluster.
    expect(READER).toMatch(/border-t border-stone-200 flex-wrap[\s\S]{0,4000}Fit the page to the panel width/)
  })
})

// ── THE iOS 16px FLOOR NEEDS A BOX THAT CAN HOLD IT ─────────────────────────────────────────────
describe('typing controls are sized for the forced 16px phone font', () => {
  it('index.css still floors every phone form control at 16px', () => {
    // The premise of everything below. If this ever goes, the box sizes are over-generous rather
    // than wrong — but the assertion is what makes the connection visible.
    expect(CSS).toMatch(/input,\s*select,\s*textarea\s*\{\s*font-size:\s*max\(16px,\s*1em\)\s*!important/)
  })
  it('the reader gives its inputs and selects a ≥40px box on touch', () => {
    const m = /const TOUCH_FIELD_H = (\d+)/.exec(READER)
    expect(m).toBeTruthy()
    expect(Number(m![1])).toBeGreaterThanOrEqual(40)
    // …and actually USES it. A constant nothing reads is the "mechanism with no surface" this repo
    // keeps meeting; measured, it feeds the address bar, the composer and three selects.
    expect((READER.match(/isPhone \? TOUCH_FIELD_H :/g) ?? []).length).toBeGreaterThanOrEqual(5)
  })
  it('a <select> gets a real box, because it can never borrow the hit region', () => {
    // Chrome and Safari render no pseudo-element on a replaced element, so `.iw-tap` is unavailable
    // to a <select> — its own height is the only target it has.
    expect(PDF).toMatch(/height:\s*isTouch \? 40 : 28/)
    expect(PDF_READER).toMatch(/height:\s*touch \? 40 : 26/)
  })
})

// ── GESTURES ────────────────────────────────────────────────────────────────────────────────────
describe('an element that owns a gesture declares touch-action', () => {
  it('a PDF text note does — without it, drag-to-move does not exist on touch', () => {
    // touch-action does NOT inherit, and the app-wide phone rule is `pan-x pan-y`, so a finger on a
    // note is a candidate pan: the browser takes the gesture, scrolls, and sends pointercancel.
    // setPointerCapture cannot override that.
    const note = PDF.slice(PDF.indexOf('note.style.cssText'), PDF.indexOf('note.style.cssText') + 700)
    expect(note).toContain('touch-action:none')
  })
  it("the reader's hold-to-open tool buttons do", () => {
    expect(READER).toMatch(/touchAction:\s*'none'/)
  })
  it("the PDF toolbar's hold wrapper does", () => {
    expect(PDF).toMatch(/touchAction:\s*'none'/)
  })
  it("the PDF reader view's size and spacing sliders do", () => {
    // A range input owns a HORIZONTAL drag, and no UA stylesheet overrides `pan-x pan-y` for it —
    // so without this the browser could take the drag as a pan and scroll instead of moving the
    // thumb. Measured 86×16 before; a 16px-tall drag target is also simply a miss.
    const r = /const RANGE: React\.CSSProperties = touch\s*\?\s*\{([^}]*)\}/.exec(PDF_READER)
    expect(r, 'the touch branch of RANGE').toBeTruthy()
    expect(r![1]).toMatch(/touchAction:\s*'none'/)
    expect(Number(/height:\s*(\d+)/.exec(r![1])![1])).toBeGreaterThanOrEqual(40)
    // …and both sliders use it. Two sliders and one styled would be the worse bug: half-fixed.
    expect((PDF_READER.match(/style=\{RANGE\}/g) ?? []).length).toBe(2)
  })
})

describe('a hold gesture survives the browser taking the gesture', () => {
  it("the reader's hold clears its timer on pointercancel", () => {
    // Without it the 400ms timer still fires after a cancelled press: the palette opens under a
    // finger that has left, AND `heldRef` stays set and swallows the next tap on that tool.
    expect(READER).toContain('onPointerCancel')
    const hold = READER.slice(READER.indexOf('onPointerDown={() => { holcRef') >= 0 ? 0 : READER.indexOf('setPaletteOpen(t.kind) }, 400)') - 400,
                             READER.indexOf('setPaletteOpen(t.kind) }, 400)') + 600)
    expect(hold).toContain('onPointerCancel')
  })
  it("the PDF toolbar's hold does too (it always has — the reader was the one missing it)", () => {
    expect(PDF).toContain('onPointerCancel={() => { const h = holdRef.current[t.kind]')
  })
})

describe('dismiss scrims listen for the event a finger actually sends', () => {
  // iOS withholds the synthetic mousedown whenever the gesture is treated as a scroll or a
  // touchmove was preventDefaulted — which the reader panel's own .iw-touch-guard handler does. A
  // scrim on mousedown alone is a dismiss that sometimes is not there.
  const scrims = (src: string) =>
    [...src.matchAll(/position:\s*'fixed',\s*inset:\s*0,\s*zIndex:\s*20\s*\}\}\s*\n?\s*on(\w+)=/g)].map((m) => m[1])

  it('every full-screen scrim in the reader uses onPointerDown', () => {
    const found = scrims(READER)
    expect(found.length).toBeGreaterThan(0)          // VOID guard: an empty scan must not pass
    expect(found.every((e) => e === 'PointerDown'), found.join(',')).toBe(true)
  })
  it('every full-screen scrim in the PDF viewer uses onPointerDown', () => {
    const found = scrims(PDF)
    expect(found.length).toBeGreaterThanOrEqual(2)   // the colour palette AND the ⋮ export menu
    expect(found.every((e) => e === 'PointerDown'), found.join(',')).toBe(true)
  })
})

// ── FLOATING BOXES STAY ON A 375px SCREEN ───────────────────────────────────────────────────────
describe('a popover centred on your finger cannot hang off the edge', () => {
  it('the reader clamps both of its floating boxes', () => {
    // MEASURED: the composer is ~354px wide and is centred on the touched point, so ANY selection
    // near a margin put half of it — and the ✓/✕ that commit or cancel — past the edge.
    expect(READER).toContain('function useClampedX')
    expect(READER).toContain('useClampedX(sel?.x)')
    expect(READER).toContain('useClampedX(composer?.x)')
  })
  it("the PDF's ⋮ export menu is clamped", () => {
    // MEASURED at left = -134: `right: 0` of the ⋮ BUTTON, and the toolbar wraps on a phone, so the
    // ⋮ can land near the left edge with a 232px right-aligned card behind it.
    expect(PDF).toContain('moreMenuRef')
    expect(PDF).toMatch(/if \(r\.left < 8\) el\.style\.right/)
  })
})

// ── THE READING SURFACE ─────────────────────────────────────────────────────────────────────────
describe('the reader panel is guarded but its article stays selectable', () => {
  it('the panel carries the touch guard', () => {
    expect(READER).toContain('iw-touch-guard')
  })
  it('the article body carries the selectable exemption', () => {
    // BOTH halves are needed and both are asserted: the CSS `user-select` exemption in index.css
    // and the JS exemption in TiptapEditor's pointerdown/touchmove guards, which read the same
    // attribute. Either alone still blocks the selection the whole feature exists for.
    expect(READER).toContain('data-iw-selectable')
    expect(CSS).toMatch(/\.iw-touch-guard \[data-iw-selectable\][\s\S]{0,200}user-select:\s*text/)
    const tiptap = code(read('editor/TiptapEditor.tsx'))
    expect(tiptap).toContain("[data-iw-selectable]")
  })
})
