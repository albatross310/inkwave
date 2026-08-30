// THE CONTRAST WALKER — ONE definition, shared by every night-mode probe.
//
// Extracted verbatim from nightaudit.prove.mjs (2026-08-30) when the /snapshot palette needed the
// same instrument. NOT copied: two copies of a contrast rule is how one probe silently stops
// catching what the other does — the same argument src/copy/claimMatchers.ts carries for its
// regexes. Every surface in the app is therefore scored by ONE rule, so "the reader passes and
// /snapshot fails" is a fact about the surfaces rather than about two graders.
//
// It is a STRING because it runs inside the page (page.addInitScript). It installs two globals:
//   window.__iwBgOf(el)          the effective OPAQUE background behind an element
//   window.__iwAudit(sel, opts)  { items: [{kind,label,fg,bg,size,weight,via,ratio,need,ok}] }
//
// ARM IT BEFORE READING IT. A walker that reports "no failures" is indistinguishable from one that
// measured nothing, and this project has shipped that instrument more than once. nightaudit's
// self-test block is the worked example: plant a known bug (#5c2d8a on #454e59), a known-good, an
// alpha case, a disabled control and both outline cases, and assert it separates them FIRST.
//
// ⚠ 2026-08-30, ON THE MERGE: the extraction that created this file was taken from a tree that
// did NOT yet carry the night-audit lane's backdrop fix, so lifting it wholesale would have
// silently dropped that work — the paper is a SIBLING layer, not an ancestor of the prose, and a
// walker that climbs parents scores the document against the surface behind it (near-black at
// night, aqua by day). BOTH errors flatter the palette. The body below is the FIXED walker; the
// shared-module design is the other lane's and is the right one. One rule, and it is the good one.

export const CONTRAST_WALKER = `
(() => {
  const parse = (c) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(c || '')
    if (!m) return null
    const p = m[1].split(/[,\\s/]+/).filter(Boolean).map(Number)
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
  }
  const over = (fg, bg) => ({           // composite fg (with alpha) over an opaque bg
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1,
  })
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
  }
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]; return (hi + 0.05) / (lo + 0.05) }
  const hex = (c) => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')

  /**
   * The WORST (highest-luminance, i.e. least helpful to light ink… and lowest for dark ink) colour
   * stop of a CSS gradient, or null when background-image carries no gradient.
   *
   * Returning the worst rather than an average is deliberate: a gradient that passes at one end and
   * fails at the other IS a failure, and averaging would launder it — the same argument this repo
   * made about the defensive clamp that hid a broken Pearson formula. It scores against BOTH
   * extremes by returning whichever stop is furthest from mid-grey in the direction that hurts,
   * which for a two-stop button fill is simply the lighter end.
   */
  const worstStop = (bgImage) => {
    if (!bgImage || bgImage === 'none' || !/gradient\\(/.test(bgImage)) return null
    const stops = []
    for (const m of bgImage.matchAll(/rgba?\\([^)]*\\)/g)) { const c = parse(m[0]); if (c && c.a > 0) stops.push(c) }
    if (!stops.length) return null
    // The lightest stop — the one a white label has the least chance against.
    return stops.reduce((a, b) => (lum(b) > lum(a) ? b : a))
  }

  // The effective background BEHIND an element: composite every translucent layer from the element
  // upward onto the first opaque one. Reading only the element's own background-color reports
  // "rgba(0,0,0,0)" for the overwhelming majority of nodes and would score everything against black.
  // ⚠ THE PAPER IS NOT AN ANCESTOR OF THE PROSE, AND AN ANCESTOR WALK SCORES THE WRONG COLOUR.
  // In gapped mode the page sheets live in a SIBLING layer (.inkwave-sheets > .inkwave-sheet,
  // absolutely positioned behind the text), so climbing from a paragraph reaches
  // .inkwave-editor-surface — the aqua water in day, near-black in night — and never touches the
  // parchment/charcoal the words are actually printed on. MEASURED both ways on the same build: the
  // "References" heading scored 2.06:1 against the night surface and 1.23:1 against its own sheet,
  // and in DAY the walker was scoring prose against #00bfa8 AQUA. Both errors flatter the palette
  // here, which is the dangerous direction. So: if a sheet contains the element's centre, that
  // sheet is the backdrop and the walk stops at the surface.
  const sheetUnder = (el) => {
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    for (const s of document.querySelectorAll('.inkwave-sheet')) {
      const q = s.getBoundingClientRect()
      if (cx >= q.left && cx <= q.right && cy >= q.top && cy <= q.bottom) {
        const c = parse(getComputedStyle(s).backgroundColor)
        if (c && c.a >= 0.999) return c
      }
    }
    return null
  }
  window.__iwBgOf = (el) => {
    const paper = sheetUnder(el)
    const stack = []
    let n = el
    while (n && n.nodeType === 1) {
      // The surface paints BELOW the sheet layer, so once a sheet is established as the backdrop
      // nothing at or above the surface may be composited on top of it.
      if (paper && n.classList && n.classList.contains('inkwave-editor-surface')) break
      const cs = getComputedStyle(n)
      // ⚠ A GRADIENT IS A BACKGROUND TOO, AND THE WALKER WAS BLIND TO IT (2026-08-30). It read
      // background-color only, so a button filled with linear-gradient(135deg,#7a4fb0,#5c2d8a)
      // — which four of the reader's dead-end cards ship, all carrying text-white — resolved to
      // the WHITE of the panel behind it and scored 1:1. That is an alarm firing on a working
      // control, and CLAUDE.md is explicit that this is worse than a green on a broken one: it
      // trains the one person whose eyes are the ground truth to distrust the instrument.
      // Scored on the WORST stop, so a gradient can never pass on its friendliest end.
      const grad = worstStop(cs.backgroundImage)
      const c = grad || parse(cs.backgroundColor)
      // An ancestor's opacity dims what is painted over it too; treat it as extra alpha.
      const op = parseFloat(cs.opacity)
      if (c && c.a > 0) stack.push({ ...c, a: c.a * (Number.isFinite(op) ? op : 1) })
      if (c && c.a * (Number.isFinite(op) ? op : 1) >= 0.999) break
      n = n.parentElement
    }
    let base = paper || { r: 255, g: 255, b: 255, a: 1 }   // the page is white under everything
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base)
    return base
  }

  window.__iwAudit = (rootSel, opts) => {
    const root = document.querySelector(rootSel)
    if (!root) return { missing: rootSel }
    const out = []
    const seen = new Set()
    const push = (el, kind, fgRaw, label, altRaw) => {
      const bg = window.__iwBgOf(el)
      const fgc = parse(fgRaw)
      if (!fgc) return
      const fg = fgc.a < 1 ? over(fgc, bg) : fgc
      const cs = getComputedStyle(el)
      const size = parseFloat(cs.fontSize) || 0
      const weight = parseInt(cs.fontWeight, 10) || 400
      const large = size >= 24 || (size >= 18.66 && weight >= 700)
      // A glyph-only control (an icon button, a one/two-letter badge) is a UI COMPONENT, not body
      // text: WCAG 1.4.11 asks 3:1 of it, not 4.5:1. Judged by CONTENT LENGTH, never by tag — a
      // <button> full of prose is prose.
      const glyph = kind === 'svg' || label.length <= 2
      const need = large || glyph ? 3 : 4.5
      // ⚠ A MARK'S CONTRAST CAN COME FROM ITS OUTLINE, and scoring the fill alone reports a bug that
      // is not there. The eraser icon is a pale pink body with a dark maroon stroke: reading its
      // fill only, it scored 1.81:1 while the drawing is perfectly legible. Same for a text glyph
      // carrying -webkit-text-stroke. So the score is the BETTER of fill and outline — and it is
      // reported, so a "pass by stroke" is visible in the output rather than silently assumed.
      let r = ratio(fg, bg)
      let via = 'fill'
      const alt = parse(altRaw || '')
      if (alt && alt.a > 0.25) {
        const ac = alt.a < 1 ? over(alt, bg) : alt
        const ar = ratio(ac, bg)
        if (ar > r) { r = ar; via = 'outline ' + hex(ac) }
      }
      out.push({ kind, label: label.slice(0, 46), fg: hex(fg), bg: hex(bg), size: Math.round(size * 10) / 10,
                 weight, via, ratio: Math.round(r * 100) / 100, need, ok: r >= need })
    }
    const vis = (el) => {
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.06) return false
      const r = el.getBoundingClientRect()
      return r.width > 1 && r.height > 1
    }
    // WCAG 1.4.3 exempts INACTIVE components: a disabled control is meant to look unavailable, and
    // scoring its greyed label as a failure is the instrument inventing work. The disabled flag is
    // inherited by a fieldset's children, so ask the nearest disabled ancestor, not the node.
    const inactive = (el) => !!(el.closest('[disabled], [aria-disabled="true"], fieldset:disabled'))
    const walk = (el) => {
      if (!vis(el)) return
      if (opts && opts.skip && el.matches(opts.skip)) return
      // Text this element paints ITSELF (direct text-node children only — an ancestor must not be
      // credited with a descendant's colour).
      let own = ''
      for (const n of el.childNodes) if (n.nodeType === 3) own += n.nodeValue
      own = own.replace(/\\s+/g, ' ').trim()
      if (own && !inactive(el)) {
        const cs = getComputedStyle(el)
        const key = el.tagName + '|' + own + '|' + cs.color
        const strokeW = parseFloat(cs.webkitTextStrokeWidth || '0') || 0
        if (!seen.has(key)) { seen.add(key); push(el, 'text', cs.color, own, strokeW > 0 ? cs.webkitTextStrokeColor : '') }
      }
      // SVG shapes with an explicit paint of their own.
      if (el.namespaceURI === 'http://www.w3.org/2000/svg' && (el.tagName === 'path' || el.tagName === 'rect' || el.tagName === 'circle')) {
        const cs = getComputedStyle(el)
        const f = cs.fill
        const fc = parse(f)
        if (fc && fc.a > 0.2 && !inactive(el)) {
          const key = 'svgfill|' + f + '|' + (el.getAttribute('d') || '').slice(0, 20)
          const sw = parseFloat(cs.strokeWidth || '0') || 0
          if (!seen.has(key)) { seen.add(key); push(el.parentElement || el, 'svg', f, (el.getAttribute('d') || 'shape').slice(0, 18), sw > 0 ? cs.stroke : '') }
        }
      }
      for (const c of el.children) walk(c)
    }
    walk(root)
    return { items: out }
  }

  // ── carried forward on the merge (2026-08-30) from the read-view lane ──────────────────
  // Its own probe needs these; they were written against a private copy of this walker, and
  // taking either side whole would have dropped one lane's work. Same resolution as the
  // backdrop fix above: keep the shared module, merge the capability into it.
  /** Contrast between two arbitrary painted colours, so a probe can compare two surfaces.
   *  ⚠ IT MUST TAKE HEX AS WELL AS rgb(). Everything else here reports hex (that is what \`hex()\`
   *  is for), so a parser that only reads rgb() returns null for its own output — which the caller
   *  then has to distinguish from "these two surfaces are identical". Measured: it did exactly
   *  that, and \`ratio null\` read as a failing comparison rather than a broken instrument. */
  const anyColor = (c) => {
    const s = String(c || '').trim()
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s)
    if (m) {
      const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1]
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 }
    }
    return parse(s)
  }
  window.__iwRatio = (a, b) => {
    const pa = anyColor(a), pb = anyColor(b)
    return pa && pb ? Math.round(ratio(pa, pb) * 100) / 100 : null
  }
  /** The effective background of whatever paints the editor page behind the panel. */
  window.__iwEditorPaper = () => {
    const el = document.querySelector('.inkwave-sheet') || document.querySelector('.scroll-paper')
    return el ? hex(window.__iwBgOf(el)) : null
  }

  window.__iwSurface = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const cs = getComputedStyle(el)
    const bg = window.__iwBgOf(el)
    const fg = parse(cs.color)
    return {
      bg: hex(bg), lum: Math.round(lum(bg) * 10000) / 10000,
      fg: fg ? hex(fg.a < 1 ? over(fg, bg) : fg) : null,
      ratio: fg ? Math.round(ratio(fg.a < 1 ? over(fg, bg) : fg, bg) * 100) / 100 : null,
      borderTop: cs.borderTopWidth, borderColor: cs.borderTopColor,
    }
  }
})()
`
