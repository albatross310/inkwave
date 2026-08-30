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
      const c = parse(cs.backgroundColor)
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
})()
`
