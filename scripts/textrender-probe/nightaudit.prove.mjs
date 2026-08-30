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
import { CONTRAST_WALKER } from './contrastWalker.mjs'
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

// ── The contrast walker ──────────────────────────────────────────────────────────────────────────
// MOVED to ./contrastWalker.mjs (2026-08-30) so the /snapshot palette probe scores by the SAME rule
// rather than a second copy of it. Byte-identical; the self-test below still arms it before any real
// number is read, which is the part that matters.
const WALKER = CONTRAST_WALKER

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

  // ⚠ AND THE BACKDROP RULE NEEDS ITS OWN PAIR. `__iwBgOf` now prefers the .inkwave-sheet under an
  // element over its ancestor chain; a mechanism with no known-negative is how "0 failures" comes to
  // mean "nothing was measured". Two probes, identical but for POSITION: one over a real sheet must
  // report the SHEET's colour, one outside every sheet must report the surface's. If the sheets have
  // not laid out yet the arm VOIDS loudly rather than passing.
  const backdrop = await page.evaluate(() => {
    const s = document.querySelector('.inkwave-sheet')
    if (!s) return { void: 'no .inkwave-sheet laid out' }
    const q = s.getBoundingClientRect()
    if (q.width < 4 || q.height < 4) return { void: 'sheet has no box' }
    // ⚠ THE HOST MATTERS, and the first cut of this arm got it wrong in a way worth keeping.
    // Appended to <body>, a probe div's ancestor chain never passes through .inkwave-editor-surface,
    // so the "stop at the surface" clause could not fire and BOTH samples came back as the surface's
    // own colour — the negative reported the rule broken while the rule was fine. A page sheet only
    // paints under things INSIDE the surface, so the probe has to live where the prose lives.
    const host = document.querySelector('.scroll-paper') || document.querySelector('.inkwave-editor-surface')
    if (!host) return { void: 'no paper host' }
    const mk = (x, y) => {
      const d = document.createElement('div')
      d.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:6px;height:6px;background:transparent`
      host.appendChild(d)
      const bg = window.__iwBgOf(d)
      d.remove()
      return '#' + [bg.r, bg.g, bg.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
    }
    return {
      sheetHex: getComputedStyle(s).backgroundColor,
      onSheet: mk(q.left + q.width / 2 - 3, q.top + q.height / 2 - 3),
      offSheet: mk(Math.max(2, q.left - 60), q.top + q.height / 2 - 3),
    }
  })
  if (backdrop.void) check(false, 'backdrop known-negative could not run', backdrop.void)
  else {
    const rgbHex = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return '#' + p.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('') }
    check(backdrop.onSheet === rgbHex(backdrop.sheetHex),
      'an element OVER a page sheet is scored against the SHEET', JSON.stringify(backdrop))
    check(backdrop.offSheet !== backdrop.onSheet,
      '…and one beside it is NOT (the rule discriminates by position)', JSON.stringify(backdrop))
  }

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
    // A mid-palette swatch from StyleBar's HIGHLIGHT_COLORS (they are all pastels by design).
    const hl = { type: 'highlight', attrs: { color: '#bbf7d0' } }
    const doc = {
      id, title: 'Night audit', createdAt: new Date().toISOString(), schemaVersion: '1',
      // ⚠ THE PAGE IS A SURFACE TOO, and until 2026-08-30 nothing in this probe ever looked at it —
      // which is precisely where Peter found the "References" heading at 1.23:1 against its own
      // paper. The fixture therefore carries the three page states that can each be wrong on their
      // own: a plain citation, a citation inside a WRITER'S HIGHLIGHT (a light pastel in both
      // themes — the worst pair measured anywhere, body text at 1.06:1), and an UNRESOLVED key
      // (the red glyph). A highlight the fixture never contains is a rule the audit cannot see.
      contentJson: { type: 'doc', content: [
        { type: 'paragraph', content: [
          { type: 'text', text: 'As argued ' }, cite('sider2001'),
          { type: 'text', text: ' the puzzle persists, and again ' }, cite('parfit1984'),
          { type: 'text', text: ' at length.' },
        ] },
        { type: 'paragraph', content: [
          { type: 'text', marks: [hl], text: 'A highlighted passage carrying ' },
          { ...cite('sider2001'), marks: [hl] },
          { type: 'text', marks: [hl], text: ' inside the wash itself.' },
        ] },
        { type: 'paragraph', content: [
          { type: 'text', text: 'An unresolved key renders as ' }, cite('nosuchsource1999'),
          { type: 'text', text: ' until it is fixed.' },
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

    // ── 0. THE DOCUMENT PAGE ITSELF ───────────────────────────────────────────────────────────
    // Prose, in-text citations, a citation inside a writer's highlight, an unresolved key, and the
    // whole reference list (heading, "esp. pp", the ↩ back-refs, the + note button). This is the
    // surface the writer actually looks at and it was the one surface this probe never opened.
    await audit(theme, 'document page', '.ProseMirror')
    // ⚠ THE FIXTURE'S HIGHLIGHT COVERAGE IS PARTLY LUCK, and this arm removes the luck. SCAS flags
    // words STOCHASTICALLY, so whether a flagged word lands inside the highlighted passage varies
    // run to run — a mutation run that happened to flag a different word surfaced a real DAY failure
    // (#237a47 on #bbf7d0 = 4.39:1) that the clean run had sailed straight past. And the fixture can
    // only carry ONE of the eleven HIGHLIGHT_COLORS swatches. So: a deterministic probe on the
    // DARKEST swatch (#a5b4fc, Indigo — the worst case for dark ink), carrying the three things that
    // can sit on a highlight. It reproduces the real element exactly, `color: inherit` included,
    // because that inline declaration is what the night rule's `!important` exists to outrank — a
    // stand-in without it would be testing a cascade the app never has.
    const onHighlight = await page.evaluate(() => {
      const pm = document.querySelector('.ProseMirror[contenteditable="true"]')
      if (!pm) return { void: 'no editor' }
      const host = document.createElement('p')
      host.setAttribute('data-iw-probe', 'onlight')
      host.innerHTML = '<mark data-color="#a5b4fc" style="background-color: rgb(165, 180, 252); color: inherit;">' +
        'prose on the darkest swatch ' +
        '<span style="color: var(--iw-cite-color, #5c2d8a)">(Author, 2001)</span> ' +
        '<span class="scas-red">flagged</span></mark>'
      pm.appendChild(host)
      const r = window.__iwAudit('[data-iw-probe="onlight"]')
      host.remove()
      return r
    })
    if (onHighlight.void) check(false, `[${theme}] the darkest-swatch highlight probe could not run`, onHighlight.void)
    else {
      const hi = onHighlight.items || []
      const fails = hi.filter((i) => !i.ok)
      check(hi.length >= 3, `[${theme}] the highlight probe painted prose, a citation and a flag`, String(hi.length))
      check(fails.length === 0, `[${theme}] every ink on the DARKEST highlight swatch is legible`,
        fails.map((f) => `${f.fg} on ${f.bg} ${f.ratio}:1 "${f.label}"`).join(' · '))
      for (const f of fails) bad.push({ theme, label: 'darkest highlight swatch', ...f })
    }
    // THE PAGE MUST HAVE AN EDGE, and it must cost NO LAYOUT. Peter: the sheet against the near-black
    // water had no boundary at all. The ring is a box-shadow spread precisely because canonical
    // pagination measures the paper's box — so the check is BOTH: a visible ring against the surface
    // behind it, AND a border box byte-identical to the one with the shadow suppressed.
    const edge = await page.evaluate(() => {
      const s = document.querySelector('.inkwave-sheet')
      if (!s) return { void: 'no sheet' }
      const before = s.getBoundingClientRect()
      const b = { x: before.x, y: before.y, w: before.width, h: before.height }
      const prev = s.style.boxShadow
      s.style.boxShadow = 'none'
      const after = s.getBoundingClientRect()
      s.style.boxShadow = prev
      const cs = getComputedStyle(s)
      const surf = getComputedStyle(document.querySelector('.inkwave-editor-surface')).backgroundColor
      return {
        shadow: cs.boxShadow, surface: surf,
        layoutMoved: Math.abs(after.x - b.x) + Math.abs(after.y - b.y) + Math.abs(after.width - b.w) + Math.abs(after.height - b.h),
      }
    })
    if (edge.void) check(false, `[${theme}] page-edge check could not run`, edge.void)
    else if (theme === 'day') {
      // DAY IS A DIFFERENT CLAIM, not an exemption. Cream paper on aqua water with an 8px/32px drop
      // shadow already reads as a page, and Peter reported no day problem — so the day assertion is
      // that the shadow it relies on is STILL THERE. A future change that deletes it is caught here;
      // what is NOT asserted in day is a 1px ring, because day does not have one by design.
      check(/\dpx\s+\d+px/.test(edge.shadow) && edge.shadow.includes('rgba'),
        `[day] the page sheet keeps its drop shadow (day's own boundary)`, edge.shadow.slice(0, 60))
      check(edge.layoutMoved === 0, `[day] …and the shadow changes NO layout (px moved)`, String(edge.layoutMoved))
    } else {
      const ring = /(rgba?\([^)]+\))\s+0px\s+0px\s+0px\s+1px/.exec(edge.shadow)
      check(!!ring, `[${theme}] the page sheet carries a 1px edge ring`, edge.shadow.slice(0, 80))
      check(edge.layoutMoved === 0, `[${theme}] …and the ring changes NO layout (px moved)`, String(edge.layoutMoved))
      if (ring) {
        const r = await page.evaluate(([a, b2]) => {
          const host = document.createElement('div')
          host.style.cssText = `position:fixed;left:-9999px;top:0;background:${b2};padding:4px`
          host.innerHTML = `<span style="color:${a}">edge</span>`
          document.body.appendChild(host)
          const out = window.__iwAudit('div[style*="-9999px"]')
          host.remove()
          return out.items[0]
        }, [ring[1], edge.surface])
        // An edge is a non-text boundary: WCAG 1.4.11 asks 3:1 of a UI component's visual boundary.
        check(r && r.ratio >= 3, `[${theme}] the edge is visible against the surface behind it`,
          r ? `${r.fg} on ${r.bg} = ${r.ratio}:1` : 'unreadable')
      }
    }

    // ── 0b. THE PAGE SETTINGS PANEL (P) ───────────────────────────────────────────────────────
    // Peter: the unselected Low/High pills were "nearly invisible" beside a readable Mid, which
    // makes the control look BROKEN rather than dim. Measured before the fix: #6b7280 on #454e59 =
    // 1.75:1, inside a bright #d1d5db ring.
    await page.evaluate(() => { const b2 = [...document.querySelectorAll('button')].find(x => (x.getAttribute('title') || '') === 'Page settings'); b2 && b2.click() })
    await page.waitForTimeout(700)
    const pageMenu = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"][aria-label="Page settings"]')
      if (!d) return false
      d.setAttribute('data-iw-probe', 'pagemenu'); return true
    })
    check(pageMenu, `[${theme}] the page settings panel opened`)
    if (pageMenu) {
      const items = await audit(theme, 'page settings panel', '[data-iw-probe="pagemenu"]')
      check(Array.isArray(items), `[${theme}] the page settings panel was actually read`)
      // A SET of preset pills is only usable if the unselected ones are legible AS WELL as the
      // selected one — scoring the panel as a whole would let one bright pill carry the average.
      const pills = await page.evaluate(() => {
        const on = [], off = []
        for (const b2 of document.querySelectorAll('[data-iw-probe="pagemenu"] button')) {
          const t = b2.textContent.trim()
          if (!/^(Low|Mid|High|None)$/.test(t)) continue
          const cs = getComputedStyle(b2)
          const filled = !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor)
          ;(filled ? on : off).push({ t, fg: cs.color, bg: cs.backgroundColor, bd: cs.borderTopColor })
        }
        return { on, off }
      })
      check(pills.on.length > 0 && pills.off.length > 0,
        `[${theme}] the pill audit saw BOTH states (selected ${pills.on.length}, unselected ${pills.off.length})`)
    }
    await page.evaluate(() => { const d = document.querySelector('[data-iw-probe="pagemenu"]'); const c = d && [...d.querySelectorAll('button')].find(x => x.textContent.trim() === '×'); c && c.click() })
    await page.waitForTimeout(300)

    // ── 0c. THE KEYBOARD-SHORTCUTS PANEL (ⓘ Guide) ────────────────────────────────────────────
    // Peter: the section headings read as "a muddy brown/olive… a rendering fault", and the key
    // glyphs were darker than the descriptions beside them — "the column you scan is the one you
    // cannot see". Measured before the fix: headings 3.07:1, keys 1.71:1, descriptions 1.20:1.
    await page.evaluate(() => { const b2 = [...document.querySelectorAll('button')].find(x => (x.getAttribute('title') || '') === 'Guide'); b2 && b2.click() })
    await page.waitForTimeout(700)
    const guide = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"][aria-label="Guide"]')
      if (!d) return false
      d.setAttribute('data-iw-probe', 'guide'); return true
    })
    check(guide, `[${theme}] the keyboard-shortcuts panel opened`)
    if (guide) {
      const items = await audit(theme, 'shortcuts panel', '[data-iw-probe="guide"]')
      check(Array.isArray(items), `[${theme}] the shortcuts panel was actually read`)
      // THE HIERARCHY CLAIM, not merely the floor: the keys are the subject of this panel, so the
      // key column must not be QUIETER than the descriptions it labels. A contrast floor alone
      // passes the exact arrangement Peter complained about.
      const cols = await page.evaluate(() => {
        const g = document.querySelector('[data-iw-probe="guide"] div[style*="grid"]')
        if (!g) return null
        const kids = [...g.children].filter(c => c.tagName === 'SPAN')
        const key = kids.find(c => /monospace/.test(getComputedStyle(c).fontFamily))
        const desc = kids.find(c => !/monospace/.test(getComputedStyle(c).fontFamily))
        if (!key || !desc) return null
        const bg = window.__iwBgOf(key)
        return { key: getComputedStyle(key).color, keyW: getComputedStyle(key).fontWeight, desc: getComputedStyle(desc).color, bg }
      })
      check(!!cols, `[${theme}] the shortcuts panel's key/description columns were found`)
      if (cols) check(cols.key !== cols.desc && parseInt(cols.keyW, 10) >= 600,
        `[${theme}] the key column is distinct and at least as heavy as its description`,
        `key ${cols.key} @${cols.keyW} vs desc ${cols.desc}`)
    }
    await page.evaluate(() => { const d = document.querySelector('[data-iw-probe="guide"]'); const c = d && [...d.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === 'Close'); c && c.click() })
    await page.waitForTimeout(300)

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

      // ── 1b. LIVE VIEW'S OWN BAR, AND THE TWO REFUSAL CARDS (2026-08-30) ───────────────────────
      // Five controls landed in this panel today (zoom -, the % readout, zoom +, fit-to-width, and
      // refresh) plus two full-height cards (Inkwave-in-Inkwave, and the "get the extension" offer).
      // None of them is reachable from the reader-mode walk above, so without this section a night
      // bug in any of them would be invisible — which is exactly what happened the last time this
      // file was extended: "the walker ran 0 failures in BOTH themes on the build Peter complained
      // about."
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => (x.title || '').startsWith('Live page'))
        if (b) b.click()
      })
      await page.waitForTimeout(1000)
      const liveBar = await page.evaluate(() => {
        const fit = document.querySelector('[data-iw-live-fit]')
        const bar = fit && fit.closest('div.flex.items-center')
        const row = bar && bar.parentElement
        if (!row) return false
        row.setAttribute('data-iw-probe', 'livebar')
        return true
      })
      check(liveBar, `[${theme}] the live-view zoom bar rendered`)
      if (liveBar) await audit(theme, 'live-view bar', '[data-iw-probe="livebar"]')

      // THE SELF-FRAME REFUSAL. Driven through the real address bar, so the card is the one a writer
      // would actually meet rather than a fixture of it.
      await page.evaluate(() => {
        const i = [...document.querySelectorAll('input')].find((x) => x.placeholder === 'address or search')
        if (!i) return
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        set.call(i, 'https://iwzero.me/')
        i.dispatchEvent(new Event('input', { bubbles: true }))
        i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
      await page.waitForTimeout(1400)
      const selfCard = await page.evaluate(() => {
        const el = [...document.querySelectorAll('div')].find((d) => /can.t open Inkwave in its own panel/.test(d.textContent || '') && d.children.length >= 2)
        if (!el) return false
        el.setAttribute('data-iw-probe', 'selfcard')
        return true
      })
      check(selfCard, `[${theme}] the Inkwave-in-Inkwave refusal card rendered`)
      if (selfCard) await audit(theme, 'self-frame refusal card', '[data-iw-probe="selfcard"]')

      // Back to reader view on the original source for the sections below.
      await page.evaluate(() => {
        const i = [...document.querySelectorAll('input')].find((x) => x.placeholder === 'address or search')
        if (!i) return
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        set.call(i, 'https://plato.stanford.edu/entries/identity-time/')
        i.dispatchEvent(new Event('input', { bubbles: true }))
        i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
      await page.waitForTimeout(1200)
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => (x.title || '').startsWith('Reader view'))
        if (b) b.click()
      })
      await page.waitForTimeout(900)

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

      // ── DID IT ACTUALLY GO DARK? ──────────────────────────────────────────────────────────────
      // The contrast walker CANNOT ask this, and on this exact surface it proved it: the PDF
      // toolbar carried bare literals (bar #faf8fc, faces #fff, glyph #5c2d8a) from July until
      // 2026-08-30 and scored ZERO failures in both themes the whole time, because dark-on-white
      // passes beautifully — at midnight, in a strip of daylight welded under a dark app. Same
      // shape as the markup-bar bug above. So read what the pixels ARE, in both themes, and hold
      // the bar, a control face and the page-view gallery to it. (The pages themselves are pdf.js
      // canvases and are deliberately NOT asked to invert: re-toning one would reinterpret the
      // document.)
      const pdfSurf = await page.evaluate(() => {
        const bar = document.querySelector('[data-iw-probe="pdfbar"]')
        const face = bar && [...bar.querySelectorAll('button')].find((b3) => b3.textContent.trim() === '⟳')
        // The gallery is the scroller the .pdfViewer lives IN, found from the viewer upward — not by
        // matching an overflow style, which would happily return the reader view's own scroller once
        // ¶ has ever been on (it is a persisted toggle; the comment below records that trap).
        const viewer = document.querySelector('.pdfViewer')
        const gallery = viewer ? viewer.parentElement : null
        if (face) face.setAttribute('data-iw-probe', 'pdfface')
        if (gallery) gallery.setAttribute('data-iw-probe', 'pdfgallery')
        return {
          bar: window.__iwSurface('[data-iw-probe="pdfbar"]'),
          face: face ? window.__iwSurface('[data-iw-probe="pdfface"]') : null,
          gallery: gallery ? window.__iwSurface('[data-iw-probe="pdfgallery"]') : null,
        }
      })
      const pdfOk = pdfSurf.bar && pdfSurf.face && pdfSurf.gallery
      check(!!pdfOk, `[${theme}] read back the PDF toolbar, a control face and the page gallery`,
        JSON.stringify(pdfSurf))
      if (pdfOk) {
        console.log(`      · bar ${pdfSurf.bar.bg} (lum ${pdfSurf.bar.lum}) · face ${pdfSurf.face.bg} · gallery ${pdfSurf.gallery.bg} (lum ${pdfSurf.gallery.lum})`)
        if (theme === 'night') {
          check(pdfSurf.bar.lum < 0.1, '[night] the PDF TOOLBAR inverted', `${pdfSurf.bar.bg} lum ${pdfSurf.bar.lum}`)
          check(pdfSurf.face.lum < 0.1, '[night] …and so did the control faces on it', `${pdfSurf.face.bg} lum ${pdfSurf.face.lum}`)
          check(pdfSurf.gallery.lum < 0.1, '[night] …and the gallery the pages lie on', `${pdfSurf.gallery.bg} lum ${pdfSurf.gallery.lum}`)
          // A face you cannot pick out of the bar is not a control. This is the pairing that makes
          // a 28px icon button legible as a button rather than as a smudge on the strip.
          const sep = await page.evaluate(([a, b3]) => window.__iwRatio(a, b3), [pdfSurf.face.bg, pdfSurf.bar.bg])
          check(sep !== null && sep > 1.05, '[night] the control faces are distinct from the bar', `ratio ${sep}`)
        } else {
          check(pdfSurf.bar.lum > 0.5, '[day] the PDF toolbar is UNCHANGED — still light', pdfSurf.bar.bg)
          check(pdfSurf.face.lum > 0.5, '[day] …and so are its control faces', pdfSurf.face.bg)
          check(pdfSurf.gallery.lum > 0.5, '[day] …and the gallery', pdfSurf.gallery.bg)
        }
      }
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

        // ── DO THE NOTICE TOKENS RESOLVE *HERE*? ────────────────────────────────────────────────
        // The amber "N marks not placed here" band lives on this surface, and this surface has NO
        // `.iw-nightable` anywhere above it. A token declared inside that block resolves to its DAY
        // value in exactly this position — silently, rendering something, forever. That is the bug
        // --iw-countdown-fg's comment records and the one --iw-panel-bg was. The band itself only
        // appears when a mark cannot be placed, which no seeded fixture here produces, so what is
        // measured is the thing that could be conditionally wrong: whether the cascade reaches it.
        if (rv) {
          const band = await page.evaluate(() => {
            const host = document.querySelector('.iw-pdf-reader')
            if (!host) return null
            const el = document.createElement('div')
            el.style.background = 'var(--iw-notice-bg, #fff7ed)'
            el.style.color = 'var(--iw-notice-fg, #92400e)'
            host.appendChild(el)
            const cs = getComputedStyle(el)
            const out = { bg: cs.backgroundColor, fg: cs.color }
            el.remove()
            return out
          })
          check(!!band, `[${theme}] read the notice tokens as they resolve ON the reader page`, JSON.stringify(band))
          if (band) {
            const isDayValue = band.bg === 'rgb(255, 247, 237)'
            check(theme === 'day' ? isDayValue : !isDayValue,
              `[${theme}] the notice band resolves to its ${theme} value on a surface with no .iw-nightable above it`,
              `${band.bg} / ${band.fg}`)
          }
        }
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
