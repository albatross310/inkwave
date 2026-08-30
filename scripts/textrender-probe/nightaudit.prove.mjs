// NIGHT MODE, MEASURED — the reader, the PDF viewer, the references panel, and the back chip.
//
// ⚠ WHY A BROWSER AND NOT A TEST. CLAUDE.md records the exact reason twice over. The ledger drop-up
// shipped `color:#fff` on `background:var(--iw-ink)`, which is white-on-dark-purple in day and
// white-on-LIGHT-purple at night: "structural assertions could never have caught this: the class was
// present and the token resolved — it was *correct* and *wrong*". And jsdom does not resolve custom
// properties from a stylesheet, so a unit test reports the DAY value in both themes and passes while
// proving nothing. The only instrument that can see this failure is a real engine resolving real
// cascade, so this probe reads COMPUTED colours off the live app and computes WCAG contrast.
//
// ⚠ BLOCK THE SERVICE WORKER. Inkwave registers one (public/sw.js) which answers from its own cache,
// and `page.route` does not intercept service-worker-originated requests — reader.prove.mjs records
// the four wrong theories that cost. `serviceWorkers: 'block'` on the context.
//
// ⚠ THE PAPER EXEMPTION IS RETIRED (2026-08-30). This header used to say the reader's ARTICLE and
// the PDF's reader PAGE stay light in both themes, so they were audited for legibility only and
// never for "did it go dark". Peter: *"the whole read mode on both pdfs and web pages needs a night
// mode too — but make sure the palette is slightly different from the main page and there's a
// dividing line between."* The reading surfaces now INVERT, and this probe measures that directly
// (`readingSurface()`, below) instead of exempting it.
//
// What survives of the old argument — and what makes the inversion safe — is the FILL/STROKE split:
// a mark's FILL keeps its exact stored hex in both themes, so one highlight is still one colour on
// every device, and gains a stated dark ink on top. The probe PLACES A REAL HIGHLIGHT and reads
// both back, because that is the claim Peter actually made ("a yellow highlight has to look like a
// yellow highlight") and no token assertion can see it.
//
// ⚠ AND THE CONTRAST WALKER ALONE COULD NOT HAVE CAUGHT WHAT HE REPORTED. It ran 0 failures in BOTH
// themes on the build he complained about: the markup bar was a near-white slab reading an
// undefined token (`--iw-panel-bg`, declared nowhere), and dark-on-near-white passes; the invisible
// back arrow was DISABLED in the probe's one-entry history and therefore exempt under WCAG 1.4.3.
// Contrast is the FLOOR. So the checks below ask what the pixels ARE — and the probe now NAVIGATES,
// so the arrows are live when they are read.
import { chromium } from '@playwright/test'
import { startProbeServer } from './serve.mjs'
import { extractBlocks } from '../../src/reader/extract.mjs'

const EDITOR = '.ProseMirror[contenteditable="true"]'
const PAGE_HTML = `<!doctype html><html><head><title>Identity Over Time</title></head><body><main>
  <h1>Identity Over Time</h1>
  <p>An opening paragraph long enough to select a real sentence out of. It mentions
     <a href="/entries/change/">change</a> in passing.</p>
  <h2 id="Intr">1. Introduction</h2>
  <p>The first section says something quotable about persistence and the puzzle of change over time.</p>
  <h2 id="Chng">2.1 Identity and Change</h2>
  <p>Consider the property version of Leibniz's Law. The relation of identity mentioned in the
     antecedent is the one at issue.</p>
</main></body></html>`

// ── The contrast walker, injected into the page ──────────────────────────────────────────────────
// It is a STRING because it runs in the page, and it is ONE definition used by every surface so two
// surfaces can never be scored by two rules.
const WALKER = `
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
  window.__iwBgOf = (el) => {
    const stack = []
    let n = el
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n)
      const c = parse(cs.backgroundColor)
      // An ancestor's opacity dims what is painted over it too; treat it as extra alpha.
      const op = parseFloat(cs.opacity)
      if (c && c.a > 0) stack.push({ ...c, a: c.a * (Number.isFinite(op) ? op : 1) })
      if (c && c.a * (Number.isFinite(op) ? op : 1) >= 0.999) break
      n = n.parentElement
    }
    let base = { r: 255, g: 255, b: 255, a: 1 }   // the page is white under everything
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

  // ── WHAT A SURFACE ACTUALLY IS ────────────────────────────────────────────────────────────────
  // The audit above answers "does this clear a ratio". These answer "what colour is it", which is
  // the question Peter's report was about and the one the ratio walker is structurally blind to:
  // a near-white bar at midnight passes every contrast check ever written.
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
})()
`

const { base, stop } = await startProbeServer()
const b = await chromium.launch({ headless: true })
const ctx = await b.newContext({ viewport: { width: 1500, height: 980 }, serviceWorkers: 'block' })
const page = await ctx.newPage()
await page.addInitScript(WALKER)

let fail = 0
const bad = []
const check = (ok, msg, extra = '') => { console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra ? ' — ' + extra : ''}`); if (!ok) fail++ }

/** Audit one surface in the CURRENT theme and print every failure. */
async function audit(theme, label, sel, opts = {}) {
  const res = await page.evaluate(([s, o]) => window.__iwAudit(s, o), [sel, opts])
  if (res.missing) { check(false, `[${theme}] ${label}: surface not present`, sel); return }
  const fails = res.items.filter((i) => !i.ok)
  console.log(`  · [${theme}] ${label}: ${res.items.length} painted items, ${fails.length} below threshold`)
  for (const f of fails) {
    console.log(`      ✗ ${f.fg} on ${f.bg} = ${f.ratio}:1 (needs ${f.need}) ${f.size}px/${f.weight} "${f.label}"`)
    bad.push({ theme, label, ...f })
  }
  for (const p of res.items.filter((i) => i.ok && i.via !== 'fill')) {
    console.log(`      · passes by ${p.via}: ${p.fg} on ${p.bg} → ${p.ratio}:1 "${p.label}"`)
  }
  return fails
}

const setTheme = async (t) => {
  await page.evaluate((v) => { try { localStorage.setItem('inkwave:theme', v) } catch {} }, t)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector(EDITOR, { timeout: 60000 })
  await page.waitForTimeout(2200)
  const applied = await page.evaluate(() => document.documentElement.dataset.theme)
  check(applied === t, `theme "${t}" is applied to <html>`, `data-theme=${applied}`)
}

// A minimal but REAL PDF (pdf.js parses it) so the viewer's toolbar renders over a real document
// rather than an error panel — an error panel is a different surface with different colours.
function tinyPdf() {
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 400]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    null, // stream, built below
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ]
  const stream = 'BT /F1 14 Tf 30 340 Td (Persistence and change over time.) Tj ET'
  objs[3] = `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`
  let out = '%PDF-1.4\n'
  const offs = []
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (const o of offs) out += String(o).padStart(10, '0') + ' 00000 n \n'
  out += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`
  return out
}

try {
  await page.route((u) => u.pathname === '/api/reader', (route) => {
    const u = new URL(route.request().url())
    if (u.searchParams.get('probe') === '1') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"framable":true}' })
    const target = u.searchParams.get('url') || ''
    try {
      const { title, blocks } = extractBlocks(PAGE_HTML, target)
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: target, title, blocks }) })
    } catch (e) { route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: e.message }) }) }
  })

  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(EDITOR, { timeout: 60000 })
  await page.waitForTimeout(2000)

  // ── ARM THE INSTRUMENT FIRST ──────────────────────────────────────────────────────────────────
  // A contrast walker that reports "no failures" is indistinguishable from one that measured
  // nothing, and this project has shipped exactly that instrument more than once (the bake counter
  // that reported 116/116 while every lookup missed). So: plant the REAL bug — the ledger's
  // `#5c2d8a` ink sitting on the night chrome's `#454e59` — and a known-GOOD control, and assert
  // the walker separates them before a single real number is read.
  const armed = await page.evaluate(() => {
    const host = document.createElement('div')
    host.id = 'iw-probe-selftest'
    host.style.cssText = 'position:fixed;left:-9999px;top:0;background:#454e59;padding:8px;font-size:13px'
    host.innerHTML = '<span style="color:#5c2d8a">dark purple on dolphin grey</span>' +
                     '<span style="color:#dfe3e9">light grey on dolphin grey</span>' +
                     '<span style="color:rgba(255,255,255,0.08)">nearly transparent white</span>' +
                     '<button disabled style="color:#5c2d8a;background:transparent">disabled dark purple</button>' +
                     '<span style="color:#5c2d8a;-webkit-text-stroke:0.7px #f4f2ff">outlined dark purple</span>' +
                     '<span style="color:#5c2d8a;-webkit-text-stroke:0.7px #4a4f57">badly outlined purple</span>'
    document.body.appendChild(host)
    const r = window.__iwAudit('#iw-probe-selftest')
    host.remove()
    return r.items.map((i) => ({ label: i.label.slice(0, 12), ratio: i.ratio, ok: i.ok, via: i.via }))
  })
  const known = Object.fromEntries(armed.map((a) => [a.label, a]))
  check(known['dark purple '] && !known['dark purple '].ok && known['dark purple '].ratio < 1.6,
    'the walker SEES the known bug (#5c2d8a on #454e59)', JSON.stringify(known['dark purple ']))
  check(known['light grey o'] && known['light grey o'].ok,
    'the walker PASSES a known-good (#dfe3e9 on #454e59)', JSON.stringify(known['light grey o']))
  check(known['nearly trans'] && !known['nearly trans'].ok,
    'alpha is composited, not ignored (rgba white 0.08 must fail)', JSON.stringify(known['nearly trans']))
  // ⚠ EVERY EXEMPTION NEEDS ITS OWN KNOWN-NEGATIVE, or an exemption is only a way of not seeing
  // things. The disabled arm must be SKIPPED (its enabled twin two lines up IS reported, so the
  // skip is the exemption and not a blind walker), and the outline arm must rescue a glyph ONLY
  // where the outline really carries the contrast.
  check(!('disabled dar' in known), 'a DISABLED control is exempt (WCAG 1.4.3), not scored',
    JSON.stringify(known['disabled dar'] || 'skipped'))
  check(known['outlined dar'] && known['outlined dar'].ok && /outline/.test(known['outlined dar'].via || ''),
    'a glyph outlined in a contrasting colour passes BY ITS OUTLINE', JSON.stringify(known['outlined dar']))
  check(known['badly outlin'] && !known['badly outlin'].ok,
    '…and an outline carrying no contrast does NOT rescue it', JSON.stringify(known['badly outlin']))
  // ⚠ THE SURFACE COMPARATOR NEEDS ARMING TOO, and it failed its first real use for want of it:
  // `__iwRatio` parsed only rgb() while every other helper here REPORTS hex, so comparing two
  // surfaces returned null — and a null read as "these two are the same", i.e. as a verdict about
  // the app rather than about the instrument. A comparator that cannot report a number must VOID.
  const cmp = await page.evaluate(() => ({
    hexPair: window.__iwRatio('#26241f', '#2c2e35'),
    mixed: window.__iwRatio('rgb(255,255,255)', '#000000'),
    same: window.__iwRatio('#26241f', '#26241f'),
    junk: window.__iwRatio('not-a-colour', '#000'),
  }))
  check(cmp.hexPair !== null && cmp.hexPair > 1 && cmp.hexPair < 2,
    'the surface comparator reads HEX (its own output format)', JSON.stringify(cmp))
  check(cmp.mixed !== null && Math.abs(cmp.mixed - 21) < 0.1 && cmp.same === 1,
    '…mixes formats, and bottoms out at 1 for identical surfaces', JSON.stringify(cmp))
  check(cmp.junk === null, '…and returns null ONLY when it genuinely cannot parse', JSON.stringify(cmp))

  const docId = 'nightaudit-' + Math.random().toString(36).slice(2, 8)
  const pdfBytes = tinyPdf()
  // ⚠ TWO SOURCES, NOT ONE. A citation whose source has an embedded PDF opens the PDF VIEWER on a
  // click; only a source with a web URL and NO PDF opens the READER. Seeding one source with both
  // meant every "the reader opened" check was really watching the PDF panel — a surface that never
  // rendered scoring as a surface with no failures.
  const seeded = await page.evaluate(async ([id, pdf]) => {
    const web = {
      id: 'sider2001', type: 'article-journal', title: 'Identity Over Time',
      author: [{ family: 'Sider', given: 'T' }], issued: { 'date-parts': [[2001]] },
      URL: 'https://plato.stanford.edu/entries/identity-time/',
    }
    const withPdf = {
      id: 'parfit1984', type: 'book', title: 'Reasons and Persons',
      author: [{ family: 'Parfit', given: 'D' }], issued: { 'date-parts': [[1984]] },
      _iw: { pdfName: 'parfit.pdf', source: 'crossref' },
    }
    const cite = (k) => ({ type: 'citation', attrs: { citekeys: [k], prefix: '', suffix: '', locator: '', suppressAuthor: false } })
    const doc = {
      id, title: 'Night audit', createdAt: new Date().toISOString(), schemaVersion: '1',
      contentJson: { type: 'doc', content: [
        { type: 'paragraph', content: [
          { type: 'text', text: 'As argued ' }, cite('sider2001'),
          { type: 'text', text: ' the puzzle persists, and again ' }, cite('parfit1984'),
          { type: 'text', text: ' at length.' },
        ] },
        { type: 'referenceList' },
      ] },
    }
    try {
      const root = await navigator.storage.getDirectory()
      const w = async (dirs, name, data) => {
        let d = root
        for (const p of dirs) d = await d.getDirectoryHandle(p, { create: true })
        const h = await d.getFileHandle(name, { create: true })
        const s = await h.createWritable(); await s.write(data); await s.close()
      }
      await w(['documents', id], 'current.json', JSON.stringify(doc))
      await w(['library', id], 'citations.json', JSON.stringify([web, withPdf]))
      const bytes = new Uint8Array(pdf.length)
      for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i)
      await w(['library', 'pdfs'], 'parfit1984.pdf', bytes)
    } catch (e) { return 'opfs: ' + e.message }
    return 'ok'
  }, [docId, pdfBytes])
  check(seeded === 'ok', 'seeded document + two citations + a real one-page PDF', String(seeded))

  for (const theme of ['day', 'night']) {
    console.log(`\n──────── ${theme.toUpperCase()} ────────`)
    await page.goto(`${base}/?doc=${docId}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector(EDITOR, { timeout: 60000 })
    await setTheme(theme)

    // ── 1. THE SOURCE READER ──────────────────────────────────────────────────────────────────
    await page.evaluate(() => {
      // The FIRST citation is the web-only source; the second has a PDF and would open the viewer.
      const link = document.querySelectorAll('.iw-cite-link')[0]
      if (!link) return
      link.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      link.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
      link.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    try { await page.waitForSelector('div[data-iw-selectable]', { timeout: 25000 }) } catch { /* reported below */ }
    await page.waitForTimeout(1500)
    const readerRoot = await page.evaluate(() => {
      const b2 = document.querySelector('div[data-iw-selectable]')
      const p = b2 && b2.closest('.iw-nightable')
      if (p) { p.setAttribute('data-iw-probe', 'reader'); return true }
      return false
    })
    check(readerRoot, `[${theme}] the source reader opened`)
    if (readerRoot) {
      // ── NAVIGATE, SO THE BACK ARROW IS LIVE ──────────────────────────────────────────────────
      // ⚠ WITHOUT THIS THE PROBE CANNOT SEE THE BUG PETER REPORTED. With a one-entry history both
      // arrows are `disabled`, and the walker exempts disabled controls (WCAG 1.4.3 — a greyed
      // control is meant to look unavailable, and scoring it is the instrument inventing work).
      // So the enabled arrow's colour — the literal #5c2d8a that measured 1.13:1 on the night
      // header — had never been scored by anything. A second page in the stack is what makes the
      // exemption stop covering it.
      const navigated = await page.evaluate(() => {
        const i = document.querySelector('input[placeholder="address or search"]')
        if (!i) return 'no address bar'
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        set.call(i, 'https://plato.stanford.edu/entries/change/')
        i.dispatchEvent(new Event('input', { bubbles: true }))
        i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        return 'went'
      })
      await page.waitForTimeout(1600)
      const arrows = await page.evaluate(() => {
        const back = [...document.querySelectorAll('[data-iw-probe="reader"] button')]
          .find((b) => b.getAttribute('title') === 'Back')
        return back ? { disabled: back.disabled, ...window.__iwSurface('[data-iw-probe="reader"] button[title="Back"]') } : null
      })
      check(navigated === 'went' && arrows && !arrows.disabled,
        `[${theme}] the reader navigated, so the BACK arrow is enabled and no longer exempt`,
        JSON.stringify(arrows))
      if (arrows && !arrows.disabled) {
        // 3:1 — it is a glyph, which is what the walker's own `glyph` rule asks of a one-character
        // control. The literal it replaced scored 1.13.
        check(arrows.ratio >= 3, `[${theme}] the enabled BACK arrow is legible on the header`,
          `${arrows.fg} on ${arrows.bg} = ${arrows.ratio}:1`)
      }

      // Open a hold-palette FIRST so the chrome audit sees it. A palette that is only reachable by
      // a 500ms hold is exactly the surface nobody eyeballs.
      const heldPalette = await page.evaluate(async () => {
        const btns = [...document.querySelectorAll('[data-iw-probe="reader"] button')]
        const hl = btns.find((x) => (x.getAttribute('title') || '').startsWith('Highlight'))
        if (!hl) return 'no highlight tool'
        hl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
        await new Promise((r) => setTimeout(r, 700))
        return 'held'
      })
      await page.waitForTimeout(300)
      check(heldPalette === 'held', `[${theme}] the highlight tool's hold-palette opened`, heldPalette)
      // The reader's CHROME (everything but the article — the article is paper, audited separately).
      await audit(theme, 'reader chrome', '[data-iw-probe="reader"]', { skip: '.iw-reader-page' })
      await audit(theme, 'reader article (paper)', '.iw-reader-page')
      await page.evaluate(() => document.body.click())
      await page.waitForTimeout(200)

      // ── THE READING SURFACE ITSELF ────────────────────────────────────────────────────────────
      // What the ratio walker cannot ask: what colour IS this. Peter's markup bar passed every
      // contrast check while being a near-white slab at midnight.
      const surf = await page.evaluate(() => ({
        page: window.__iwSurface('.iw-reader-page'),
        bar: window.__iwSurface('[data-iw-probe="reader"] .flex-wrap'),
        panel: window.__iwSurface('[data-iw-probe="reader"]'),
        editor: window.__iwEditorPaper(),
      }))
      const ok = surf.page && surf.bar && surf.panel
      check(ok, `[${theme}] read back the reading page, the markup bar and the panel`, JSON.stringify(surf))
      if (ok) {
        console.log(`      · page ${surf.page.bg} (lum ${surf.page.lum}) · bar ${surf.bar.bg} · panel ${surf.panel.bg} · editor ${surf.editor}`)
        if (theme === 'night') {
          check(surf.page.lum < 0.1, '[night] the reading page INVERTED', `${surf.page.bg} lum ${surf.page.lum}`)
          // The bug: the bar stayed #faf8fc while the page went dark. Byte-identical day and night.
          check(surf.bar.lum < 0.1, '[night] the MARKUP BAR inverted with it', `${surf.bar.bg} lum ${surf.bar.lum}`)
          check(surf.page.bg !== surf.editor,
            '[night] …and it is NOT the editor page — "slightly different from the main page"',
            `reader ${surf.page.bg} vs editor ${surf.editor}`)
          check(surf.page.bg !== surf.panel.bg,
            '[night] …nor the chrome grey', `reader ${surf.page.bg} vs panel ${surf.panel.bg}`)
          // ⚠ `page.evaluate` takes ONE argument. Passing two silently throws "Too many arguments"
          // and aborts the whole theme pass — which is what it did on the first run here.
          const sep = await page.evaluate(([a, b]) => window.__iwRatio(a, b), [surf.page.bg, surf.editor])
          check(sep !== null && sep > 1.05 && sep < 2,
            '[night] the two pages are near in value but distinct', `ratio ${sep}`)
          // ── THE DIVIDING LINE ──────────────────────────────────────────────────────────────────
          // Read the edge that actually FACES the editor, not an arbitrary side: `dockPanelPos`
          // borders exactly one (or two, fullscreen), so asking about border-top on a side-docked
          // panel measures a 0px edge and would pass or fail for the wrong reason.
          const edge = await page.evaluate(([sel, ed]) => {
            const el = document.querySelector(sel)
            const cs = getComputedStyle(el)
            const sides = ['Top', 'Right', 'Bottom', 'Left']
              .map((s) => ({ s, w: parseFloat(cs[`border${s}Width`]), c: cs[`border${s}Color`] }))
              .filter((x) => x.w > 0)
            return { sides, vs: sides.length ? window.__iwRatio(sides[0].c, ed) : null }
          }, ['[data-iw-probe="reader"]', surf.editor])
          check(edge.sides.length > 0, '[night] the docked reader draws an edge against the editor',
            JSON.stringify(edge.sides))
          // A line you cannot see is not a line. The literal it replaced (#5c2d8a at 20% alpha over
          // the night panel) composited to almost exactly the panel itself.
          check(edge.vs !== null && edge.vs > 1.5,
            '[night] …and that edge is VISIBLE against the editor page', `ratio ${edge.vs}`)
        } else {
          check(surf.page.lum > 0.5, '[day] the reading page is UNCHANGED — still light', surf.page.bg)
          check(surf.bar.lum > 0.5, '[day] and so is the markup bar', surf.bar.bg)
        }
      }

      // ── A REAL MARK, PLACED AND READ BACK ─────────────────────────────────────────────────────
      // "A yellow highlight has to look like a yellow highlight." No token assertion can see this:
      // it needs the mark to exist, be painted, and be measured off the DOM in both themes.
      const mark = await page.evaluate(async () => {
        const page2 = document.querySelector('.iw-reader-page')
        const p = page2 && page2.querySelectorAll('p')[1]
        if (!p) return { err: 'no paragraph' }
        const r = document.createRange(); r.selectNodeContents(p)
        const s = getSelection(); s.removeAllRanges(); s.addRange(r)
        p.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
        await new Promise((x) => setTimeout(x, 400))
        // The selection popover's first swatch is #ffe066 — highlight in that colour immediately.
        const dot = [...document.querySelectorAll('button[title="Highlight"]')]
          .find((b) => /255,\s*224,\s*102/.test(getComputedStyle(b).backgroundColor))
        if (!dot) return { err: 'no yellow swatch in the popover' }
        dot.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await new Promise((x) => setTimeout(x, 600))
        const span = [...page2.querySelectorAll('span')]
          .find((el) => /255,\s*224,\s*102/.test(getComputedStyle(el).backgroundColor))
        if (!span) return { err: 'the highlight did not paint' }
        const cs = getComputedStyle(span)
        return { fill: cs.backgroundColor, ink: cs.color, ratio: window.__iwRatio(cs.color, cs.backgroundColor) }
      })
      check(!mark.err, `[${theme}] a real highlight was placed on the article`, JSON.stringify(mark))
      if (!mark.err) {
        // THE STORED COLOUR IS UNTOUCHED — the invariant the inversion had to not cost.
        check(mark.fill === 'rgb(255, 224, 102)',
          `[${theme}] the highlight FILL is the stored #ffe066, not a theme's reading of it`, mark.fill)
        // …and the ink on it is dark, in BOTH themes, so the words on it are readable.
        check(mark.ratio >= 4.5, `[${theme}] the text ON the highlight reads`,
          `${mark.ink} on ${mark.fill} = ${mark.ratio}:1`)
      }
      // ⚠ NOT Escape. This panel listens for it and CLOSES — every later check would then be
      // measuring a reader that is not on screen (phonetouch.prove.mjs records the same trap).
      await page.evaluate(() => document.body.click())
      await page.waitForTimeout(200)
      // Selection popover.
      await page.evaluate(() => {
        const p = document.querySelector('.iw-reader-page').querySelectorAll('p')[1]
        const r = document.createRange(); r.selectNodeContents(p)
        const s = getSelection(); s.removeAllRanges(); s.addRange(r)
        p.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
      })
      await page.waitForTimeout(500)
      const popover = await page.evaluate(() => {
        const q = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'quote this')
        if (!q || !q.parentElement) return false
        q.parentElement.setAttribute('data-iw-probe', 'popover')
        return true
      })
      check(popover, `[${theme}] the selection popover appeared`)
      if (popover) await audit(theme, 'reader selection popover', '[data-iw-probe="popover"]')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
    }

    // ── 2. THE "BACK TO WHERE YOU WERE" CHIP (inline styles, no React) ────────────────────────
    await page.evaluate(() => {
      const el = document.getElementById('iw-nav-back')
      if (el) return
      // The chip is shown by a citation jump; drive the real jump rather than minting a fake chip.
      const bl = document.querySelector('.iw-cite-biblink')
      if (bl) bl.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.waitForTimeout(700)
    const chip = await page.evaluate(() => !!document.getElementById('iw-nav-back'))
    check(chip, `[${theme}] the "back to where you were" chip appeared`)
    if (chip) await audit(theme, 'back chip', '#iw-nav-back')

    // ── 3. THE REFERENCES PANEL ────────────────────────────────────────────────────────────────
    await page.evaluate(() => {
      const b2 = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('title') || '') === 'Bibliography / citations')
      b2 && b2.click()
    })
    await page.waitForTimeout(900)
    const bib = await page.evaluate(() => {
      const p = document.querySelector('.iw-nightable.z-\\[91\\]') ||
        [...document.querySelectorAll('.iw-nightable')].find((x) => /Download the Inkwave citation extension|no sources yet/i.test(x.textContent || ''))
      if (!p) return false
      p.setAttribute('data-iw-probe', 'bib'); return true
    })
    check(bib, `[${theme}] the references panel opened`)
    if (bib) await audit(theme, 'references panel', '[data-iw-probe="bib"]')
    await page.evaluate(() => {
      const b2 = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('title') || '') === 'Bibliography / citations')
      b2 && b2.click()
    })
    await page.waitForTimeout(400)

    // ── 4. THE PDF VIEWER + ITS READER VIEW ────────────────────────────────────────────────────
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('inkwave:open-pdf', { detail: { citekey: 'parfit1984', page: 1, label: 'Parfit 1984' } }))
    })
    await page.waitForTimeout(4000)
    // ⚠ MARK THE TOOLBAR ITSELF, not "the outermost div that contains a ✕". `querySelectorAll('div')
    // .find(...)` returns the OUTERMOST match — a zero-sized wrapper whose own rect fails the
    // visibility gate, so the walker returned immediately and the toolbar scored 0 painted items
    // and 0 failures. A surface that was never read reported as a surface with nothing wrong.
    const pdfOpen = await page.evaluate(() => {
      const close = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('title') || '').startsWith('Close (Esc)') && x.textContent.trim() === '×')
      const bar = close && close.parentElement
      if (!bar) return 'no pdf panel'
      bar.setAttribute('data-iw-probe', 'pdfbar')
      return document.querySelector('canvas') ? 'rendered' : 'toolbar only'
    })
    check(pdfOpen !== 'no pdf panel', `[${theme}] the PDF viewer opened`, pdfOpen)
    if (pdfOpen !== 'no pdf panel') {
      const barItems = await audit(theme, 'pdf toolbar', '[data-iw-probe="pdfbar"]')
      check(Array.isArray(barItems), `[${theme}] the pdf toolbar was actually read`)
      // Hold the highlight tool for its palette, then re-audit so the palette is included.
      await page.evaluate(async () => {
        const hl = [...document.querySelectorAll('[data-iw-probe="pdfbar"] button')].find((x) => (x.getAttribute('title') || '').toLowerCase().includes('highlight'))
        if (!hl) return
        hl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
        await new Promise((r) => setTimeout(r, 700))
      })
      await page.waitForTimeout(300)
      await audit(theme, 'pdf toolbar + hold-palette', '[data-iw-probe="pdfbar"]')
      await page.evaluate(() => document.body.click())
      await page.waitForTimeout(200)
      // Reader view (¶). ⚠ IT IS A PERSISTED TOGGLE — the day pass turned it ON and the setting
      // survived into the night pass, so blindly clicking it again turned it OFF and the night
      // audit reported "the reader view did not render" about a view that works. Click only when
      // it is currently off, which is a question the button's own lit state answers.
      const readerBtn = await page.evaluate(() => {
        const b2 = [...document.querySelectorAll('[data-iw-probe="pdfbar"] button')].find((x) => x.textContent.trim() === '¶')
        if (!b2) return false
        if (!document.querySelector('.iw-pdf-reader')) b2.click()
        return true
      })
      await page.waitForTimeout(3000)
      check(readerBtn, `[${theme}] the PDF reader view (¶) toggled`)
      if (readerBtn) {
        const rv = await page.evaluate(() => {
          const el = document.querySelector('.iw-pdf-reader')
          if (!el) return false
          el.setAttribute('data-iw-probe', 'pdfreader'); return true
        })
        check(rv, `[${theme}] the PDF reader view rendered`)
        if (rv) await audit(theme, 'pdf reader view', '[data-iw-probe="pdfreader"]')
      }
    }
  }

  console.log('\n──────── VERDICT ────────')
  const nightOnly = bad.filter((x) => x.theme === 'night')
  const dayOnly = bad.filter((x) => x.theme === 'day')
  console.log(`  day failures:   ${dayOnly.length}`)
  console.log(`  night failures: ${nightOnly.length}`)
  check(bad.length === 0, 'every painted surface meets its contrast threshold in BOTH themes',
    bad.length ? bad.slice(0, 6).map((x) => `${x.theme}/${x.label}:${x.ratio}`).join(' ') : '')
} catch (e) {
  console.log(`  ✗ ${e.message}\n${e.stack}`)
  fail++
} finally { await b.close(); await stop() }

console.log(fail ? `\nFAIL (${fail})` : '\nPASS')
process.exitCode = fail ? 1 : 0
