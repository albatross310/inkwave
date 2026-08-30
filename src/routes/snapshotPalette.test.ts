// THE /snapshot PALETTE, KEPT IN THE GATE — ~20ms, no browser.
//
// WHY THIS FILE EXISTS. `pnpm prove:snapnight` is the in-browser TRUTH: only a real engine resolving
// real cascade can see that a control is legible. But CLAUDE.md's headline finding is that a probe
// which ran once is indistinguishable, six weeks later, from one that never ran — the gate says green
// either way, and it demonstrated exactly that on a real fix. So: of every claim proved in a browser,
// ask what cheap unit-level version KEEPS it true. These are the three that can be kept without one.
//
// ⚠ jsdom DOES NOT RESOLVE CUSTOM PROPERTIES DECLARED IN A STYLESHEET. A test that mounted a
// component and read `getComputedStyle(...).color` would report the DAY value under both themes and
// pass while proving nothing — theme.test.ts records this exact trap. So this file reads index.css
// AS TEXT and reasons about the declarations, never about a resolved value.
//
// ⚠ COMMENTS ARE STRIPPED BEFORE ANY SOURCE SCAN, deliberately. The fixes these guards protect are
// EXPLAINED by sentences that must NAME the literals they forbid — "never a literal white", "the day
// literal #5c2d8a on #454e59 measures 1.5:1". A guard reading raw text fires on its own
// documentation, and the tempting fix is always to delete the sentence. That is the corrosion
// CLAUDE.md records biting three lanes in one round (noAutoDelete.test.ts, claims.test.ts,
// micBoundary.test.ts all carry the same rule). A test below proves the stripping works AND that the
// guard still fires on a real violation, because a guard you narrow and do not re-prove is how a
// real hole opens.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string) => readFileSync(resolve(__dirname, '..', '..', p), 'utf8')
const CSS = read('src/styles/index.css')
const SNAPSHOT_VIEW = read('src/routes/SnapshotView.tsx')
const RICH_DIFF = read('src/components/RichDiffView.tsx')

/** Strip block and line comments. See the banner: this is load-bearing, not tidiness. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** The `--iw-snap-*` declarations inside one `:root…{ }` block, as a name → value map. */
function tokensIn(block: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of block.matchAll(/(--iw-snap-[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}

/** The body of the first `<selector> {` … matching `}` at nesting depth 0. */
function blockAfter(css: string, selector: string): string {
  const i = css.indexOf(selector)
  if (i < 0) throw new Error(`selector not found: ${selector}`)
  const open = css.indexOf('{', i)
  let depth = 0
  for (let j = open; j < css.length; j++) {
    if (css[j] === '{') depth++
    else if (css[j] === '}') { depth--; if (depth === 0) return css.slice(open + 1, j) }
  }
  throw new Error(`unterminated block for ${selector}`)
}

const DAY = tokensIn(blockAfter(CSS, ':root {\n  --iw-snap-bar:'))
const NIGHT = tokensIn(blockAfter(CSS, ':root[data-theme="night"] {\n  --iw-snap-bar:'))

describe('/snapshot palette — the token block', () => {
  // VOID GUARD. An empty sweep must FAIL, never pass: "all 0 tokens are themed" is the shape of an
  // instrument that measured nothing and reported success.
  it('actually found the two blocks (a vacuous pass is a failure)', () => {
    expect(Object.keys(DAY).length).toBeGreaterThan(20)
    expect(Object.keys(NIGHT).length).toBeGreaterThan(20)
  })

  it('declares exactly the same token set in both themes', () => {
    // A token declared in day only silently resolves to the day value at night — which IS the bug
    // this palette was written to fix, one token at a time.
    expect(Object.keys(NIGHT).sort()).toEqual(Object.keys(DAY).sort())
  })

  it('gives every token a DIFFERENT value at night', () => {
    // Not aesthetics: a token identical in both themes is doing no theming work, and the whole
    // reported bug was surfaces that were byte-identical in day and night.
    const same = Object.keys(DAY).filter((k) => DAY[k].replace(/\s/g, '') === NIGHT[k].replace(/\s/g, ''))
    expect(same).toEqual([])
  })

  it('keeps the diff ring/fill channels as bare RGB triples', () => {
    // These are substituted into `rgba(var(--x), <alpha>)` so the alignment glow can multiply them
    // by the live --iw-align. A hex here would make every glow rule silently invalid — and an
    // invalid box-shadow paints NOTHING, which reads as "the alignment glow was removed".
    for (const k of ['--iw-snap-add-ring-rgb', '--iw-snap-add-fill-rgb', '--iw-snap-del-ring-rgb', '--iw-snap-del-fill-rgb']) {
      expect(DAY[k], `${k} (day)`).toMatch(/^\d+,\s*\d+,\s*\d+$/)
      expect(NIGHT[k], `${k} (night)`).toMatch(/^\d+,\s*\d+,\s*\d+$/)
    }
  })

  it('keeps the destructive-action colour separate from the deletion mark', () => {
    // "✕ snapshot" destroys a Bitcoin-anchored record and is allowed to look destructive; a deleted
    // WORD is not an error (cutting is writing). Two tokens means retuning one cannot retune the
    // other by accident — which a shared token would guarantee it eventually does.
    expect(DAY['--iw-snap-danger']).toBeDefined()
    expect(DAY['--iw-snap-del-fg']).toBeDefined()
    expect(NIGHT['--iw-snap-danger']).toBeDefined()
    expect(NIGHT['--iw-snap-del-fg']).toBeDefined()
  })
})

describe('/snapshot palette — no un-tokenised colour in the route', () => {
  // Everything a `var(--…, fallback)` supplies is fine — that IS the pattern. What must not exist is
  // a colour with no token in front of it, because /snapshot's panes sit outside every scope that
  // remaps one, so such a literal is a night bug by construction.
  const VAR = /var\(--[a-z0-9-]+(?:,\s*(?:[^()]|\([^()]*\))*)?\)/g
  const LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*[\d.]+\s*,[^)]*\)/g

  // EXEMPTIONS, each with a reason. An exemption without one is just a way of not seeing things.
  const EXEMPT = [
    // Theme-NEUTRAL by design: a translucent black shadow reads the same on cream and on charcoal.
    /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,/,
    // White at low alpha: used for the minimap's EMPTY page slots, which must read as absence over
    // both the day mint and the night teal. A white hairline does that on both.
    /^rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.[0-4]/,
  ]

  // ⚠ THE EXEMPTIONS ARE BY REGION, NOT BY VALUE — and the first cut got this wrong in a way worth
  // recording. It allow-LISTED the values the neutral surfaces happen to use, which included `#fff`
  // — so `const CARD = '#fff'` anywhere in the file would have passed, and CARD is exactly the kind
  // of thing someone adds. Mutation testing found it: `#ffffff` died, `#fff` survived. An allow-list
  // of VALUES exempts every future use of that value; an allow-list of PLACES exempts only the
  // places that earned it. The three regions below are deliberately theme-neutral, each a dark chip
  // carrying light text in BOTH themes:
  //   · the injected ::selection rules — a dark wash that must overwrite the diff tint on either
  //     ground, so it cannot follow the theme
  //   · the first-open scrub hint — a dark tooltip floating over the water
  //   · ScrubDebugOverlay — the ?snapThumbs=debug diagnostic, its own fixed scheme, never shown to a
  //     writer (and its colours are a debugging vocabulary, not a palette)
  // Adding a fourth is therefore a DECISION recorded here, not a value that quietly slips through.

  /** Cut a brace/paren-balanced region starting at `marker` (which must precede the opener). */
  const cutRegion = (src: string, marker: string, open: string, close: string): string => {
    const i = src.indexOf(marker)
    if (i < 0) return src
    const o = src.indexOf(open, i)
    if (o < 0) return src
    let depth = 0
    for (let j = o; j < src.length; j++) {
      if (src[j] === open) depth++
      else if (src[j] === close) { depth--; if (depth === 0) return src.slice(0, i) + src.slice(j + 1) }
    }
    return src
  }
  /** Cut a whole top-level declaration: from `marker` to the next declaration at column 0.
   *  ⚠ Brace-matching does NOT work for a function — the first `{` after `function Foo` is the
   *  DESTRUCTURED PARAMETER, so the balance closes at the end of the signature and the body sails
   *  through. Caught by this guard failing on the overlay's own colours. */
  const cutTopLevel = (src: string, marker: string): string => {
    const i = src.indexOf(marker)
    if (i < 0) return src
    const rest = src.slice(i + marker.length)
    const m = /\n(?:function |const |export |\/\/ ──)/.exec(rest)
    return src.slice(0, i) + (m ? rest.slice(m.index) : '')
  }
  const cutNeutralRegions = (src: string) =>
    cutRegion(cutTopLevel(src, 'function ScrubDebugOverlay'), 'showScrubHint && (', '(', ')')
      .split('\n').filter((l) => !/::(-moz-)?selection/.test(l)).join('\n')

  const scan = (src: string, { regions = false } = {}) => {
    let body = stripComments(src)
    if (regions) body = cutNeutralRegions(body)
    body = body.replace(VAR, 'VAR')
    return [...body.matchAll(LITERAL)].map((m) => m[0]).filter((v) => !EXEMPT.some((r) => r.test(v)))
  }

  it('the scanner is not blind (it finds literals when they are there)', () => {
    // Prove the instrument BEFORE reading its verdict: a scanner that matches nothing reports a
    // clean file and a broken regex identically.
    expect(scan('const a = { color: "#abcdef" }')).toEqual(['#abcdef'])
    expect(scan('const a = { color: "rgba(1,2,3,0.5)" }')).toEqual(['rgba(1,2,3,0.5)'])
  })

  it('a token with a literal FALLBACK is not a violation', () => {
    expect(scan('const a = "var(--iw-snap-ink, #5c2d8a)"')).toEqual([])
    expect(scan('const a = "var(--iw-snap-bar, rgba(255,255,255,0.95))"')).toEqual([])
  })

  it('comments are stripped — the guard survives its own documentation', () => {
    // This file's own fixes are explained by prose naming #5c2d8a and #fff. A raw-text guard would
    // fire on the explanation, and the tempting fix is always to delete the sentence.
    expect(scan('// never write a literal #5c2d8a here\nconst a = 1')).toEqual([])
    expect(scan('/* the day literal #fff on var(--iw-ink) vanishes */\nconst a = 1')).toEqual([])
    // …and it still fires on the real thing on the very next line.
    expect(scan('// never write #5c2d8a\nconst a = { color: "#5c2d8a" }')).toEqual(['#5c2d8a'])
  })

  it('the region cuts remove SOMETHING — an exemption that matches nothing is not an exemption', () => {
    // If a region marker ever stops matching (a rename, a refactor), the cut becomes a no-op and
    // this guard would tighten silently into a false failure — or, if it were phrased the other way,
    // loosen silently into nothing. Assert the cuts are live.
    expect(scan(SNAPSHOT_VIEW).length).toBeGreaterThan(scan(SNAPSHOT_VIEW, { regions: true }).length)
  })

  it('SnapshotView.tsx carries no un-tokenised colour', () => {
    expect(scan(SNAPSHOT_VIEW, { regions: true })).toEqual([])
  })

  it('…and a bare #fff outside those regions is still caught', () => {
    // The mutation that survived the first cut of this guard. `#fff` is used inside the neutral
    // regions, and exempting it BY VALUE would have exempted it everywhere.
    const planted = SNAPSHOT_VIEW.replace(
      "const CARD = 'var(--iw-snap-card, #ffffff)'",
      "const CARD = '#fff'",
    )
    expect(planted).not.toEqual(SNAPSHOT_VIEW) // the plant must actually land
    expect(scan(planted, { regions: true })).toContain('#fff')
  })

  it('RichDiffView.tsx carries no un-tokenised colour', () => {
    expect(scan(RICH_DIFF)).toEqual([])
  })
})

describe('/snapshot — the browser must not steal the sideways swipe', () => {
  // Peter, 2026-08-30: a two-finger horizontal swipe on his Mac trackpad fired the browser's own
  // history navigation mid-review. `pnpm prove:snapswipe` is the in-browser truth (it reads the
  // COMPUTED overscroll-behavior on the real route, with the class-removed known-negative). These
  // keep the two halves that a text read can keep.
  it('declares overscroll containment on the ROOT, not on body', () => {
    // The rule propagates to the viewport from the ROOT ELEMENT only. On `body` it would compute
    // fine, apply to nothing, and look exactly like a working fix.
    expect(CSS).toMatch(/html\.iw-no-swipe-nav\s*\{[^}]*overscroll-behavior-x:\s*contain/)
  })

  it('declares it on the pane scrollers too', () => {
    expect(blockAfter(CSS, '.iw-snap-scroll {')).toMatch(/overscroll-behavior-x:\s*contain/)
  })

  it('SnapshotView adds the class on mount AND removes it on unmount', () => {
    // A class written onto <html> by a route is a global. One that outlives its route is the
    // `iw-wave-video-on` latch this codebase was already bitten by: a promise about the page that
    // stayed true after the thing making it true was gone. The cleanup is the load-bearing half.
    const body = stripComments(SNAPSHOT_VIEW)
    expect(body).toMatch(/classList\.add\('iw-no-swipe-nav'\)/)
    expect(body).toMatch(/classList\.remove\('iw-no-swipe-nav'\)/)
  })
})
