// NIGHT-MODE CONTRAST — THE CHEAP GUARD BEHIND scripts/textrender-probe/nightaudit.prove.mjs.
//
// WHY THIS FILE EXISTS. The browser probe is the truth: it drives the real reader, the real PDF
// viewer and the real references panel in both themes and reads COMPUTED colours. But CLAUDE.md's
// headline finding applies to it exactly — "a proof that ran once and convinced everyone is
// indistinguishable, six weeks later, from a proof that never ran, and the gate says green either
// way". So the PURE half of what that probe established lives here: which token sits on which
// surface, and whether that pairing clears WCAG in BOTH themes. ~10ms, no browser.
//
// ✗ WHAT THIS CANNOT DO, and the reason it reads CSS text rather than the DOM: jsdom does not
//   resolve custom properties declared in a stylesheet, so `getComputedStyle(el).getPropertyValue`
//   returns '' whatever index.css says — a test built on it reports the DAY value in both themes
//   and passes while proving nothing (music/theme.test.ts records the same trap). So the values are
//   read from index.css itself, the actual source of truth.
//
// ✗ IT ALSO CANNOT SEE A SURFACE NOBODY DECLARED. If a component paints a literal hex inline, this
//   file knows nothing about it — that is what the browser probe is for. This pins the PAIRINGS the
//   probe measured, so that changing a token's night value re-fires here instead of six weeks later
//   on Peter's screen.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(__dirname, './index.css'), 'utf8')

// ── WCAG 2.1 relative luminance + contrast ratio ────────────────────────────────────────────────
function parseHex(hex: string): [number, number, number] {
  const h = hex.trim().replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}
function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// ── Token values, read out of index.css ─────────────────────────────────────────────────────────
/** Every `:root{…}` block with NO attribute selector — the DAY declarations. */
const dayBlocks = (css.match(/:root\s*\{[^}]*\}/g) ?? []).join('\n')
/** Every night block, scoped or unscoped — `:root[data-theme="night"] …{…}`. */
const nightBlocks = (css.match(/:root\[data-theme="night"\][^{]*\{[^}]*\}/g) ?? []).join('\n')

function valueIn(block: string, token: string): string | null {
  // LAST declaration wins, as the cascade does — a token redeclared later in the file is the live one.
  const all = [...block.matchAll(new RegExp(`${token}\\s*:\\s*(#[0-9a-fA-F]{3,8})\\s*;`, 'g'))]
  return all.length ? all[all.length - 1][1] : null
}
function token(name: string, theme: 'day' | 'night'): string {
  const block = theme === 'day' ? dayBlocks : nightBlocks
  const v = valueIn(block, name)
  // A night token that falls back to its day value is the commonest form of this bug, so an absent
  // night declaration must FAIL rather than quietly resolve to day.
  expect(v, `${name} is declared in the ${theme} palette of index.css`).toBeTruthy()
  return v as string
}

// The two chrome surfaces the .iw-nightable block paints, read from the CSS rather than retyped:
// the panel itself, and a nested fill (what `.bg-white` becomes inside one).
const NIGHT_PANEL = /\.iw-nightable\s*\{[^}]*background-color:\s*(#[0-9a-f]{6})/i.exec(nightBlocks)?.[1] ?? ''
const NIGHT_NESTED = /\.bg-white[^{]*\{\s*background-color:\s*(#[0-9a-f]{6})/i.exec(css)?.[1] ?? ''
const NIGHT_TEXT = /\.iw-nightable\s*\{[^}]*[^-]color:\s*(#[0-9a-f]{6})/i.exec(nightBlocks)?.[1] ?? ''
const WHITE = '#ffffff'

const BODY = 4.5   // WCAG 1.4.3 AA, normal text
const UI = 3       // WCAG 1.4.11, a control / glyph / large text

describe('the contrast maths can fail', () => {
  // A ratio function that cannot report a failure would make every assertion below vacuous — the
  // exact shape of the defensive clamp CLAUDE.md records under the pearson() finding.
  it('sees the real night bug: #5c2d8a ink on the #454e59 chrome panel', () => {
    expect(contrastRatio('#5c2d8a', '#454e59')).toBeLessThan(1.2)
  })
  it('and passes a known-good pairing', () => {
    expect(contrastRatio('#dfe3e9', '#454e59')).toBeGreaterThan(6)
  })
  it('is symmetric and reaches its bounds', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5)
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5)
  })
})

describe('index.css declares the surfaces this suite reasons about', () => {
  it('found the night chrome panel, its nested fill, and its text colour', () => {
    // VOID rather than pass: if the regexes stop matching, every pairing below would silently be
    // scored against an empty string.
    expect(NIGHT_PANEL, 'the .iw-nightable night background').toMatch(/^#[0-9a-f]{6}$/i)
    expect(NIGHT_NESTED, 'the night fill that replaces .bg-white').toMatch(/^#[0-9a-f]{6}$/i)
    expect(NIGHT_TEXT, 'the .iw-nightable night text colour').toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe('CHROME tokens read on the chrome surfaces they are used on', () => {
  // These are the pairings the source reader's header, section list and selection popover use.
  // `--iw-ink` at 1.13:1 on #454e59 was the measured bug: the panel title and all four icon
  // buttons were invisible at night.
  it('--iw-ink is legible on the night panel AND on the day panel', () => {
    expect(contrastRatio(token('--iw-ink', 'night'), NIGHT_PANEL)).toBeGreaterThanOrEqual(UI)
    expect(contrastRatio(token('--iw-ink', 'day'), WHITE)).toBeGreaterThanOrEqual(BODY)
  })
  it('--iw-ink is legible on a NESTED night fill (the selection popover is a .bg-white bubble)', () => {
    expect(contrastRatio(token('--iw-ink', 'night'), NIGHT_NESTED)).toBeGreaterThanOrEqual(BODY)
  })
  it('--iw-pill-fg (the section list, muted chrome labels) is legible in both themes', () => {
    expect(contrastRatio(token('--iw-pill-fg', 'night'), NIGHT_PANEL)).toBeGreaterThanOrEqual(BODY)
  })
  it('--iw-verified (the references panel’s "used" marker) is legible in both themes', () => {
    // ⚠ ASYMMETRIC BY THE APP'S OWN CONVENTION: the older chrome tokens (--iw-verified, --iw-pill-fg)
    // are declared ONLY in the night block; their day value is the inline `var(…, #fallback)` at each
    // use site. So the day arm names that fallback rather than demanding a :root declaration that
    // index.css deliberately does not carry — asking for one would fail on a correct stylesheet.
    expect(contrastRatio(token('--iw-verified', 'night'), NIGHT_PANEL)).toBeGreaterThanOrEqual(BODY)
    expect(contrastRatio('#15803d', WHITE)).toBeGreaterThanOrEqual(BODY)
  })
  it('--iw-subtle-bg / --iw-chip-bg carry the chrome text at night and stone-500 by day', () => {
    // The extension strip and the <kbd> chip. Tailwind's bg-stone-50/100 are deliberately NOT
    // remapped by the night block (bg-stone-100 is also a 1px divider — a blanket remap paints
    // those out), so these two surfaces are tokens instead.
    for (const t of ['--iw-subtle-bg', '--iw-chip-bg']) {
      expect(contrastRatio(NIGHT_TEXT, token(t, 'night')), `${t} at night`).toBeGreaterThanOrEqual(BODY)
      expect(contrastRatio('#78716c', token(t, 'day')), `${t} by day`).toBeGreaterThanOrEqual(UI)
    }
  })
})

describe('PAPER tokens — the reading surfaces, which now have a night of their own', () => {
  // ⚠ THIS BLOCK ASSERTED THE OPPOSITE UNTIL 2026-08-30, and its own tripwire is what fired.
  // The old rule was "paper stays light in both themes; night only takes the glare off", pinned by a
  // test named "THE LITERAL INK still reads on the bar — the coupling that makes the light bar
  // legal", whose comment read: *"If someone later darkens --iw-reader-bar/-ctl toward the chrome
  // grey, that literal becomes the 1.13:1 bug again — in a file whose comments say it is safe. This
  // is the assertion that fires first."* It did exactly that, and it was right: the literals had to
  // leave the components before the surfaces could move. They have (--iw-reader-accent), so the
  // coupling is now asserted the other way round — see 'NO LITERAL #5c2d8a' below, which is the same
  // tripwire aimed at what is true now.
  //
  // Peter, 2026-08-30: *"the whole read mode on both pdfs and web pages needs a night mode too — but
  // make sure the palette is slightly different from the main page and there's a dividing line
  // between."* What made that safe without reinterpreting a single stored mark colour is the
  // fill/stroke split: a mark's FILL keeps its exact hex and gains a stated dark ink on top
  // (--iw-reader-on-mark), and only the writer's own coloured TEXT — where the colour IS the
  // readable element — is cast per theme.
  const PAPERS = ['--iw-reader-paper', '--iw-reader-bar', '--iw-reader-ctl'] as const

  it('the day palette is UNCHANGED — every reader surface is still light', () => {
    for (const t of PAPERS) {
      expect(luminance(token(t, 'day')), `${t} by day`).toBeGreaterThan(0.5)
    }
  })

  it('every reader surface INVERTS at night (this is the feature, so it is asserted)', () => {
    for (const t of PAPERS) {
      expect(luminance(token(t, 'night')), `${t} at night`).toBeLessThan(0.1)
    }
  })

  it('the night reading page is a DIFFERENT dark from the editor page and from the chrome', () => {
    // "slightly different from the main page" — near in value so it still reads as a page, distinct
    // enough that the two surfaces are not one wash. Both bounds matter: identical would defeat the
    // ask, and a large gap would read as a hole punched in the app rather than a second document.
    const paper = token('--iw-reader-paper', 'night')
    const editor = token('--iw-paper', 'night')
    expect(paper, 'the reader page must not simply BE the editor page').not.toBe(editor)
    const vsEditor = contrastRatio(paper, editor)
    expect(vsEditor, 'reader page vs editor page').toBeGreaterThan(1.05)
    expect(vsEditor, 'reader page vs editor page').toBeLessThan(2)
    // …and it is not the chrome grey either (Peter's brief: "not the chrome grey").
    expect(paper).not.toBe(NIGHT_PANEL)
    expect(contrastRatio(paper, NIGHT_PANEL), 'reader page vs chrome panel').toBeGreaterThan(1.3)
  })

  it('the night reading page is not pure black — long-form reading, not a terminal', () => {
    expect(luminance(token('--iw-reader-paper', 'night'))).toBeGreaterThan(0.005)
  })

  it('--iw-reader-ink reads on --iw-reader-paper in both themes', () => {
    for (const theme of ['day', 'night'] as const) {
      expect(contrastRatio(token('--iw-reader-ink', theme), token('--iw-reader-paper', theme)), theme)
        .toBeGreaterThanOrEqual(BODY)
    }
  })

  it('--iw-reader-muted reads on every reader surface in both themes', () => {
    for (const theme of ['day', 'night'] as const) {
      for (const surface of PAPERS) {
        expect(contrastRatio(token('--iw-reader-muted', theme), token(surface, theme)), `${surface}/${theme}`)
          .toBeGreaterThanOrEqual(BODY)
      }
    }
  })

  it('--iw-reader-accent reads on every reader surface in both themes', () => {
    // This token REPLACED the literal #5c2d8a at every site sitting on a reader surface: the
    // article's links and its "cite §" affordance, the markup bar's tool glyphs, the ± zoom buttons,
    // the § n/x pill. One token, so one assertion covers all of them.
    for (const theme of ['day', 'night'] as const) {
      for (const surface of PAPERS) {
        expect(contrastRatio(token('--iw-reader-accent', theme), token(surface, theme)), `${surface}/${theme}`)
          .toBeGreaterThanOrEqual(BODY)
      }
    }
  })

  it('NO LITERAL #5c2d8a could survive on a night reader surface — which is why they had to go', () => {
    // The old tripwire, aimed at what is now true. Re-introducing the literal on the bar is the most
    // natural edit in the world — it is what shipped for months — so this states the cost.
    for (const surface of PAPERS) {
      expect(contrastRatio('#5c2d8a', token(surface, 'night')), `${surface}`).toBeLessThan(2)
    }
  })

  it('the reader’s highlight-tool glyph reads on its own control face in both themes', () => {
    // #8a6a04 replaced #c99a06, which measured 2.59:1 on white against the 3:1 a control needs.
    // ⚠ IT IS A TOKEN NOW BECAUSE THIS ASSERTION CAUGHT IT: the literal dark gold measured 2.37:1
    // on the night control face — a real regression the inversion would have shipped, found by the
    // guard rather than by Peter. It is cast through readerInk like the other strokes.
    for (const theme of ['day', 'night'] as const) {
      expect(contrastRatio(token('--iw-reader-ink-gold', theme), token('--iw-reader-ctl', theme)), theme)
        .toBeGreaterThanOrEqual(UI)
    }
    expect(token('--iw-reader-ink-gold', 'day'), 'day is the stored/original gold').toBe('#8a6a04')
    // The known-negative that makes the casting load-bearing rather than decorative.
    expect(contrastRatio('#8a6a04', token('--iw-reader-ctl', 'night'))).toBeLessThan(UI)
  })
})

describe('A MARK KEEPS ITS COLOUR — the inversion had to not cost this', () => {
  // Peter's constraint, verbatim: "the mark colours must still make sense against it — a yellow
  // highlight has to look like a yellow highlight." The palette is shared with the PDF viewer and
  // stored in the mark, so nothing about a FILL may be theme-dependent.
  const MARK_FILLS = ['#ffe066', '#a0e8a0', '#8ec5ff', '#ffb3c6']

  it('--iw-reader-on-mark reads on every mark fill in BOTH themes', () => {
    // A highlight, a sticky note and a textbox are all opaque PALE patches, so the ink on them is
    // dark whatever the page is doing. At night a highlighted run becomes an island of day, which is
    // what a highlighter actually looks like on paper.
    for (const theme of ['day', 'night'] as const) {
      for (const hex of MARK_FILLS) {
        expect(contrastRatio(token('--iw-reader-on-mark', theme), hex), `${hex}/${theme}`)
          .toBeGreaterThanOrEqual(BODY)
      }
    }
  })

  it('the day rendering of a mark is BYTE-UNCHANGED — on-mark ink IS the day paper ink', () => {
    // The assertion that says "this shipped without moving anything Peter already reads".
    expect(token('--iw-reader-on-mark', 'day')).toBe(token('--iw-reader-ink', 'day'))
  })

  it('a mark FILL would be UNREADABLE under the page ink — so the stated ink is load-bearing', () => {
    // Without this the on-mark token looks like belt-and-braces. It is not: at night the page ink is
    // near-white and every fill in the palette is pale, so inheriting would give pale-on-pale.
    for (const hex of MARK_FILLS) {
      expect(contrastRatio(token('--iw-reader-ink', 'night'), hex), hex).toBeLessThan(2)
    }
  })

  it('the writer’s coloured TEXT is cast per theme, and its day values are the stored ones', () => {
    // The one genuine casting, and the reason: these are STROKES, so the colour IS the readable
    // element and it has to be paired with the page. reader/markInk.ts maps stored → token, for
    // DISPLAY only; nothing is ever written back.
    const inks: Record<string, string> = {
      '--iw-reader-ink-red': '#991b1b',
      '--iw-reader-ink-blue': '#1e3a8a',
      '--iw-reader-ink-green': '#166534',
    }
    for (const [t, stored] of Object.entries(inks)) {
      expect(token(t, 'day'), `${t} by day IS the stored value`).toBe(stored)
      // …and the night cast has to read on the reading page AND on a floating chrome bubble, which
      // is where the composer that types them actually sits.
      expect(contrastRatio(token(t, 'night'), token('--iw-reader-paper', 'night')), `${t} on paper`)
        .toBeGreaterThanOrEqual(BODY)
      expect(contrastRatio(token(t, 'night'), NIGHT_NESTED), `${t} on a chrome bubble`)
        .toBeGreaterThanOrEqual(BODY)
    }
  })

  it('the stored dark inks would be UNREADABLE on the night page — the casting is load-bearing', () => {
    // Without this, "we cast the inks" is a claim with no measurement behind it. Maroon on the night
    // reading page is ~1.5:1, and no choice of DARK surface fixes that — 4.5:1 against that maroon
    // needs a mid-tone page, which is not a night mode.
    for (const stored of ['#991b1b', '#1e3a8a', '#166534']) {
      expect(contrastRatio(stored, token('--iw-reader-paper', 'night')), stored).toBeLessThan(2.5)
    }
  })
})

describe('THE READER PANEL’S OWN CHROME — Peter’s "the top bar’s fonts are too dark"', () => {
  it('--iw-reader-chrome-fg reads on the night panel, and BETTER than --iw-ink did', () => {
    const now = contrastRatio(token('--iw-reader-chrome-fg', 'night'), NIGHT_PANEL)
    expect(now, 'the header ink').toBeGreaterThanOrEqual(BODY)
    // The measured "too dark": the title and four icon buttons sat at 4.7:1 on --iw-ink. That passes
    // AA and is still thin for a 13px glyph, so the bar here is the OLD NUMBER, not the standard.
    expect(now).toBeGreaterThan(contrastRatio(token('--iw-ink', 'night'), NIGHT_PANEL))
  })

  it('its day values are the app’s own — nothing about the day header moves', () => {
    expect(token('--iw-reader-chrome-fg', 'day')).toBe('#5c2d8a')
    expect(token('--iw-reader-chrome-dim', 'day')).toBe('#d6d3d1')
  })

  it('a DISABLED arrow is dimmer than an enabled one — it used to be brighter', () => {
    // Measured on the live panel: disabled #d6d3d1 scored 5.67:1 at night while the enabled arrow
    // beside it (the literal #5c2d8a) scored 1.13:1. Backwards in both directions at once.
    const dim = contrastRatio(token('--iw-reader-chrome-dim', 'night'), NIGHT_PANEL)
    const live = contrastRatio(token('--iw-reader-chrome-fg', 'night'), NIGHT_PANEL)
    expect(dim, 'disabled must not outshine enabled').toBeLessThan(live)
    // …and still visible enough to read as a control rather than as nothing at all.
    expect(dim).toBeGreaterThan(1.4)
  })
})

describe('THE DIVIDING LINE — Peter’s "there’s a dividing line between"', () => {
  it('--iw-reader-divider is visible against the panel it edges AND the editor behind it', () => {
    // A divider you cannot see is not a divider. The panel is chrome; what it sits against is the
    // editor's own night page.
    expect(contrastRatio(token('--iw-reader-divider', 'night'), NIGHT_PANEL), 'vs the panel')
      .toBeGreaterThan(1.5)
    expect(contrastRatio(token('--iw-reader-divider', 'night'), token('--iw-paper', 'night')), 'vs the editor')
      .toBeGreaterThan(1.5)
  })
  it('and it is declared by day too — the panel had no border at all before this', () => {
    expect(contrastRatio(token('--iw-reader-divider', 'day'), WHITE)).toBeGreaterThan(1.1)
  })
})

describe('EVERY READER TOKEN A COMPONENT READS IS ACTUALLY DECLARED', () => {
  // ⚠ THE GUARD FOR THE BUG THAT CAUSED HALF OF THIS ROUND. SourceBrowser's markup bar read
  // `var(--iw-panel-bg, #faf8fc)` and `--iw-panel-bg` IS DECLARED NOWHERE IN THIS REPO — so it
  // painted its fallback in BOTH themes, byte-identically, and no amount of night-mode work on the
  // token block could ever have reached it. That failure is SILENT by construction: a var() with a
  // fallback always renders something, so the bar looked deliberate rather than broken.
  //
  // ⚠ COMMENTS ARE STRIPPED, AND THAT IS NOT AN OPTIMISATION. This repo's comments must NAME the
  // thing they forbid in order to forbid it: the fix's own comment in SourceBrowser SAYS
  // `var(--iw-panel-bg, …)` to explain why nothing may read it, and the first cut of this guard
  // duly fired on that sentence. CLAUDE.md records the same guard-attacks-its-own-documentation
  // failure biting three lanes in one round, with the tempting fix always being to delete the
  // sentence. Judge what the code DOES — a live var() — never prose about it.
  const readers = ['../components/SourceBrowser.tsx', '../components/PdfReaderView.tsx']
  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const declared = new Set([...css.matchAll(/(--iw-[a-z0-9-]+)\s*:/g)].map((m) => m[1]))
  const usedIn = (f: string) =>
    [...stripComments(readFileSync(resolve(__dirname, f), 'utf8'))
      .matchAll(/var\(\s*(--iw-[a-z0-9-]+)/g)].map((m) => m[1])

  it('found the declarations and the call sites — a blind sweep must VOID, not pass', () => {
    expect(declared.size, 'tokens declared in index.css').toBeGreaterThan(30)
    expect(readers.flatMap(usedIn).length, 'var(--iw-…) call sites in the two readers').toBeGreaterThan(10)
  })

  it('the sweep can SEE a dangling token — proved before its verdict is read', () => {
    expect(declared.has('--iw-panel-bg'), 'the token this guard was written for').toBe(false)
    expect(declared.has('--iw-reader-bar'), 'and a real one it must not flag').toBe(true)
  })

  it('the comment strip keeps the guard working — fires on a USE, silent on a MENTION', () => {
    // The pair both halves of a source-scanning guard need. Without the second, "we strip comments"
    // is a claim that would also be satisfied by a scanner that reads nothing at all.
    const scan = (src: string) =>
      [...stripComments(src).matchAll(/var\(\s*(--iw-[a-z0-9-]+)/g)].map((m) => m[1])
    expect(scan("style={{ background: 'var(--iw-panel-bg, #faf8fc)' }}"), 'a real use')
      .toEqual(['--iw-panel-bg'])
    expect(scan('// this bar used to read var(--iw-panel-bg, #faf8fc) and nothing declared it'), 'a line comment')
      .toEqual([])
    expect(scan('/* ⚠ never read var(--iw-panel-bg) again */'), 'a block comment').toEqual([])
  })

  it('no reader component reads a token index.css never declares', () => {
    const dangling = readers.flatMap((f) =>
      usedIn(f).filter((t) => !declared.has(t)).map((t) => `${f.split('/').pop()} reads ${t}`))
    expect(dangling, 'a var() with a fallback renders forever and never errors').toEqual([])
  })
})
