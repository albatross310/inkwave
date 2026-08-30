// THE PHONE AUDIT — every new reader surface, at Peter's own iPhone-8 width, with touch.
//
// ⚠ WHY THIS EXISTS. Three days of UI (the in-app source reader, the PDF reflow view, the PDF
// toolbar's hold-palettes and text notes) shipped without ONE of it being opened at phone width or
// touched. Every item this probe checks is a rule CLAUDE.md already records as a live bug that cost
// real debugging:
//   • iOS auto-zooms — and STAYS zoomed — on focusing any control whose computed font is < 16px.
//   • `touch-action` does NOT inherit; an element that owns a drag needs its own rule.
//   • A portalled panel needs `iw-touch-guard`, but a READING surface inside one needs
//     `data-iw-selectable` or its text cannot be selected — which is the reader's whole point.
//   • The phone dock is a TOP dock (components/dockLayout.ts).
//
// IT MEASURES, IT DOES NOT REASON. Computed styles and real geometry off the live DOM: nothing here
// asserts that a class is present, because a class being present is not the same as the rule
// applying (the night-mode `:root[data-theme] .iw-nightable` trap, recorded in CLAUDE.md, is
// exactly a correct-and-wrong class).
//
// ⚠ TWO HARNESS RULES, both of which cost hours in the reader probe and are repeated verbatim here:
//   • serviceWorkers: 'block' — Inkwave registers one that answers from its own cache, and
//     `page.route` does not intercept service-worker-originated requests. Without it /api/reader
//     comes back as the app's own index.html and the reader shows its error, which is a probe
//     artefact indistinguishable from the feature being broken.
//   • `.ProseMirror` alone matches a hidden anti-flash SHELL. An editor is
//     `.ProseMirror[contenteditable="true"]`.
import { chromium } from '@playwright/test'
import { startProbeServer } from './serve.mjs'
import { extractBlocks } from '../../src/reader/extract.mjs'

const EDITOR = '.ProseMirror[contenteditable="true"]'
// iPhone 8: 375×667 CSS px at DPR 2. Peter's device.
const PHONE = { width: 375, height: 667 }
// Apple's own HIG floor is 44pt. CLAUDE.md's brief asks about ~40px; we report at 40 and note 44.
const TAP_MIN = 40
const FONT_MIN = 16

const PAGE_HTML = `<!doctype html><html><head><title>Identity Over Time</title></head><body><main>
  <h1>Identity Over Time</h1>
  <p>An opening paragraph that is long enough to select a real sentence out of, which is what the
     citation actions operate on. It mentions <a href="/entries/change/">change</a> in passing.</p>
  <h2 id="Intr">1. Introduction</h2>
  <p>The first section says something quotable about persistence and the puzzle of change over time.</p>
  <h2 id="Chng">2.1 Identity and Change</h2>
  <p>Consider the property version of Leibniz's Law. \\[\\tag{LL} \\forall x\\forall y[x=y]\\] The relation
     of identity mentioned in the antecedent is the one at issue.</p>
  <h2 id="Bib">Bibliography</h2>
  <p>Geach, P., 1967.</p>
</main></body></html>`

const { base, stop } = await startProbeServer()
const b = await chromium.launch({ headless: true })
const ctx = await b.newContext({
  viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  serviceWorkers: 'block',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
})
const page = await ctx.newPage()
let fail = 0
const check = (ok, msg, extra = '') => { console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra ? ' — ' + extra : ''}`); if (!ok) fail++ }
const note = (msg) => console.log(`  · ${msg}`)

// ── the measurement primitive ────────────────────────────────────────────────────────────────────
// Runs IN the page: every visible interactive descendant of `root`, with its computed font-size,
// its real box, its touch-action and its user-select. One pass, so a control cannot be measured
// under one layout and reported under another.
const AUDIT = `(rootSel) => {
  const root = document.querySelector(rootSel)
  if (!root) return { error: 'no root: ' + rootSel }
  const vv = { w: window.innerWidth, h: window.innerHeight }
  const rb = root.getBoundingClientRect()
  const focusable = [...root.querySelectorAll('input, select, textarea, button, [role="button"], a[href]')]
  const seen = focusable.map((el) => {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    const vis = cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0
    // THE HIT AREA, NOT THE PAINT. Small chrome controls keep their painted size and grow a ::after
    // that is part of their own hit region (index.css .iw-tap). Reading only the box would score a
    // control as unreachable when a thumb reaches it perfectly well — and reading only the ::after
    // would miss a control that has none. Take the union, and report BOTH.
    const af = getComputedStyle(el, '::after')
    const hasAfter = af.content !== 'none' && af.content !== 'normal'
    const aw = hasAfter ? parseFloat(af.width) : NaN
    const ah = hasAfter ? parseFloat(af.height) : NaN
    return {
      hitW: Number.isFinite(aw) ? Math.max(r.width, aw) : r.width,
      hitH: Number.isFinite(ah) ? Math.max(r.height, ah) : r.height,
      tag: el.tagName.toLowerCase(),
      label: (el.getAttribute('title') || el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 44),
      font: parseFloat(cs.fontSize),
      w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
      x: Math.round(r.left), right: Math.round(r.right),
      // The hit RECT, for the collision check below. An expanded region is centred on the control.
      hit: Number.isFinite(aw) && Number.isFinite(ah)
        ? { l: r.left + r.width / 2 - Math.max(r.width, aw) / 2, t: r.top + r.height / 2 - Math.max(r.height, ah) / 2,
            rr: r.left + r.width / 2 + Math.max(r.width, aw) / 2, b: r.top + r.height / 2 + Math.max(r.height, ah) / 2 }
        : { l: r.left, t: r.top, rr: r.right, b: r.bottom },
      topY: r.top, bottomY: r.bottom,
      touchAction: cs.touchAction, userSelect: cs.userSelect || cs.webkitUserSelect,
      typing: el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA',
      // A link INSIDE the article is the author's prose, not our chrome: it is as big as the type
      // around it and always will be. Reported, never failed on — otherwise every source with an
      // inline link fails a control-size rule that was never about it.
      prose: el.tagName === 'A' && !!el.closest('[data-iw-selectable]'),
      vis,
    }
  }).filter((s) => s.vis)
  // Horizontal overflow: does anything inside the panel PAINT past the viewport?
  // ⚠ CLIP-AWARE, and the first cut was not — it reported a confident 24px overflow caused by
  // KaTeX's accessibility MathML (.katex-mathml, a 1px box with overflow:hidden holding a
  // full-width 'semantics' subtree). getBoundingClientRect answers where a box WOULD be, not where
  // the browser paints it, so the naive walk accused the reader of an overflow the engine clips.
  // An element only paints past the edge if its rect SURVIVES every clipping ancestor.
  let widest = 0, widestSel = ''
  for (const el of root.querySelectorAll('*')) {
    let r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    let right = r.right, clipped = false
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const pcs = getComputedStyle(p)
      if (pcs.overflowX === 'visible' && pcs.clipPath === 'none' && pcs.clip === 'auto') continue
      const pr = p.getBoundingClientRect()
      right = Math.min(right, pr.right)
      if (right <= r.left) { clipped = true; break }
    }
    if (clipped) continue
    if (right > widest) { widest = right; widestSel = el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0] }
  }
  return {
    vv,
    panel: { x: Math.round(rb.left), y: Math.round(rb.top), w: Math.round(rb.width), h: Math.round(rb.height), right: Math.round(rb.right), bottom: Math.round(rb.bottom) },
    scrollW: root.scrollWidth, clientW: root.clientWidth,
    widest: Math.round(widest), widestSel,
    controls: seen,
  }
}`

const report = (name, a) => {
  if (a.error) { check(false, `${name}: measurable`, a.error); return }
  note(`${name}: panel ${a.panel.w}×${a.panel.h} at (${a.panel.x},${a.panel.y}) · viewport ${a.vv.w}×${a.vv.h} · ${a.controls.length} visible controls`)
  // 1. horizontal overflow
  check(a.panel.right <= a.vv.w + 1 && a.panel.x >= -1, `${name}: the panel is inside the viewport horizontally`,
    `left=${a.panel.x} right=${a.panel.right} vw=${a.vv.w}`)
  check(a.widest <= a.vv.w + 1, `${name}: nothing inside paints past the right edge`,
    `widest=${a.widest} (${a.widestSel}) vw=${a.vv.w}`)
  check(a.scrollW <= a.clientW + 1, `${name}: no sideways scroll range`, `scrollW=${a.scrollW} clientW=${a.clientW}`)
  // 2. the iOS 16px focus-zoom floor — TYPING controls only (buttons don't zoom the page)
  const small = a.controls.filter((c) => c.typing && c.font < FONT_MIN)
  check(small.length === 0, `${name}: every focusable text control is ≥ ${FONT_MIN}px (iOS focus-zoom)`,
    small.map((c) => `${c.tag}[${c.label}] ${c.font}px`).join(' | ') || 'all ok')
  // 3. a control whose BOX is shorter than its own text is clipped — the other half of the floor
  const clipped = a.controls.filter((c) => c.typing && c.h < c.font * 1.25)
  check(clipped.length === 0, `${name}: no text control is shorter than its own line`,
    clipped.map((c) => `${c.tag}[${c.label}] h=${c.h} font=${c.font}`).join(' | ') || 'all ok')
  // 4. tap targets — CHROME only (see `prose` above), scored on the HIT AREA.
  //    ⚠ THE VERTICAL AND HORIZONTAL BARS DIFFER, AND SAYING SO IS THE POINT. A dense icon row
  //    cannot give every icon 44px WIDE without reflowing (see the .iw-tap header in index.css), so
  //    the honest claim is: 44px tall, and horizontally everything up to the midpoint between
  //    neighbours. Scoring both against 40 would fail on a limit we deliberately chose; scoring
  //    neither would be decoration.
  const chrome = a.controls.filter((c) => !c.prose)
  const shortV = chrome.filter((c) => c.hitH < TAP_MIN)
  check(shortV.length === 0, `${name}: every chrome control's hit area is ≥ ${TAP_MIN}px TALL`,
    shortV.map((c) => `${c.label || c.tag} ${c.hitW}×${c.hitH} (painted ${c.w}×${c.h})`).join(' | ') || `all ${chrome.length} ok`)
  const noGain = chrome.filter((c) => Math.min(c.w, c.h) < TAP_MIN && c.hitH <= c.h + 0.5 && c.hitW <= c.w + 0.5)
  check(noGain.length === 0, `${name}: every SMALL control actually gained hit area (the rule is applying)`,
    noGain.map((c) => `${c.label || c.tag} ${c.w}×${c.h}`).join(' | ') || 'all ok')
  // 4b. ⚠ THE EXPANSION MUST NOT REACH ANOTHER CONTROL. An enlarged hit region is only a fix if it
  //     stops short of the next control; where two overlap, the later sibling paints last and WINS,
  //     so a "bigger target" quietly takes pixels OFF its neighbour's own painted button — a fix
  //     that removes a tap target. The condition is therefore overlap with a neighbour's PAINTED
  //     BOX, not with its centre: by the time a region reaches a centre it has already eaten half
  //     the control, and the damage started long before. It catches a WRAPPED row (two rows 32px
  //     apart carrying 44px-tall regions) exactly as readily as a tight one.
  //     KNOWN-NEGATIVE, run before this was trusted: replacing the shipped
  //     `width: calc(100% + var(--iw-tap-x))` with a flat `max(100%, 80px)` fires it on 26 pairs.
  const overlap = (h, r) => h.l < r.right && h.rr > r.x && h.t < r.bottomY && h.b > r.topY
  const stolen = []
  for (const a2 of chrome) for (const b2 of chrome) {
    if (a2 === b2) continue
    if (overlap(a2.hit, b2)) stolen.push(`${a2.label || a2.tag} reaches into ${b2.label || b2.tag}`)
  }
  check(stolen.length === 0, `${name}: no control's hit area reaches into a NEIGHBOUR's own button`,
    `${stolen.length} pair(s)` + (stolen.length ? ': ' + stolen.slice(0, 3).join(' | ') : ''))
  const narrow = chrome.filter((c) => c.hitW < TAP_MIN)
  note(`${name}: ${narrow.length} control(s) still under ${TAP_MIN}px WIDE — the documented residual of a one-row bar` +
    (narrow.length ? ': ' + narrow.map((c) => `${c.label || c.tag} ${c.hitW}`).join(', ') : ''))
  const proseLinks = a.controls.filter((c) => c.prose)
  if (proseLinks.length) note(`${name}: ${proseLinks.length} link(s) in the article itself — sized by the author's type, not ours (not failed on)`)
  return a
}

try {
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [page err]', m.text().slice(0, 160)) })
  await page.route((u) => u.pathname === '/api/reader', (route) => {
    const u = new URL(route.request().url())
    if (u.searchParams.get('probe') === '1') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ framable: true }) })
    }
    const target = u.searchParams.get('url') || ''
    try {
      const { title, blocks } = extractBlocks(PAGE_HTML, target)
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: target, title, blocks }) })
    } catch (e) {
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: String(e.message) }) })
    }
  })

  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(EDITOR, { timeout: 60000 })
  await page.waitForTimeout(2500)

  // ⚠ PROVE THE HARNESS SEES A PHONE BEFORE READING ANY PHONE VERDICT. `isTouchDevice()` gates a
  // great deal of this app's behaviour; a context that is not recognised as touch would take every
  // desktop branch and this whole probe would certify the wrong build.
  const env = await page.evaluate(() => ({
    coarse: matchMedia('(pointer: coarse)').matches,
    noHover: matchMedia('(hover: none)').matches,
    maxTouch: navigator.maxTouchPoints,
    isPhoneSurface: !!document.querySelector('.inkwave-editor-surface.is-phone'),
    starTouchAction: getComputedStyle(document.body).touchAction,
  }))
  check(env.coarse && env.noHover, 'the context is recognised as a touch device', JSON.stringify(env))
  check(env.isPhoneSurface, 'the editor rendered its PHONE surface', `is-phone=${env.isPhoneSurface}`)
  check(env.starTouchAction === 'pan-x pan-y', 'the universal phone touch-action rule applies', env.starTouchAction)

  // ── SEED + OPEN THE READER (same path as reader.prove.mjs) ─────────────────────────────────────
  const docId = 'phone-probe-' + Math.random().toString(36).slice(2, 8)
  const seeded = await page.evaluate(async (id) => {
    const item = { id: 'sider2001', type: 'article-journal', title: 'Identity Over Time',
      author: [{ family: 'Sider', given: 'T' }], issued: { 'date-parts': [[2001]] },
      URL: 'https://plato.stanford.edu/entries/identity-time/' }
    const doc = { id, title: 'Phone probe', createdAt: new Date().toISOString(), schemaVersion: '1',
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'As argued ' },
        { type: 'citation', attrs: { citekeys: ['sider2001'], prefix: '', suffix: '', locator: '', suppressAuthor: false } },
        { type: 'text', text: ' the puzzle persists.' }] }] } }
    try {
      const root = await navigator.storage.getDirectory()
      const docs = await root.getDirectoryHandle('documents', { create: true })
      const dir = await docs.getDirectoryHandle(id, { create: true })
      const dh = await dir.getFileHandle('current.json', { create: true })
      const dw = await dh.createWritable(); await dw.write(JSON.stringify(doc)); await dw.close()
      const lib = await root.getDirectoryHandle('library', { create: true })
      const per = await lib.getDirectoryHandle(id, { create: true })
      const fh = await per.getFileHandle('citations.json', { create: true })
      const w = await fh.createWritable(); await w.write(JSON.stringify([item])); await w.close()
    } catch (e) { return 'opfs: ' + e.message }
    return 'ok'
  }, docId)
  check(seeded === 'ok', 'seeded a citation with a web source', String(seeded))
  await page.goto(`${base}/?doc=${docId}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(EDITOR, { timeout: 60000 })
  await page.waitForTimeout(1500)

  await page.evaluate(() => {
    const link = document.querySelector('.iw-cite-link')
    if (!link) return 'no citation'
    link.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    link.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    link.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return 'clicked'
  })
  await page.waitForFunction(() => /Identity Over Time/.test(document.body.innerText), null, { timeout: 20000 })
  await page.waitForTimeout(1200)

  console.log('\n── THE SOURCE READER, at 375px with touch ──────────────────────────────────────')
  const READER = '.iw-touch-guard[class*="flex-col"]'
  const readerSel = await page.evaluate(() => {
    // The reader panel is the fixed portal that CONTAINS the article body.
    const body = document.querySelector('[data-iw-selectable]')
    let p = body
    while (p && !(p.classList?.contains('iw-touch-guard'))) p = p.parentElement
    if (!p) return null
    p.setAttribute('data-probe-reader', '')
    return true
  })
  check(!!readerSel, 'found the reader panel')

  const rd = await page.evaluate(new Function('return ' + AUDIT)(), '[data-probe-reader]')
  report('reader', rd)

  // THE PHONE DOCK IS A TOP DOCK (dockLayout.ts): the panel takes the top half, editor keeps the bottom.
  check(rd.panel && rd.panel.y <= 2 && rd.panel.x <= 1 && rd.panel.w >= rd.vv.w - 2,
    'reader: the phone dock is the TOP dock, full width', JSON.stringify(rd.panel))
  check(rd.panel && rd.panel.h < rd.vv.h - 40, 'reader: the editor keeps the bottom half',
    `panel h=${rd.panel?.h} of ${rd.vv.h}`)

  // SELECTABILITY — both halves. The CSS half is measured here; the JS half (TiptapEditor's
  // touchmove preventDefault) is measured by the exemption below.
  const selCss = await page.evaluate(() => {
    const el = document.querySelector('[data-iw-selectable] p')
    const cs = getComputedStyle(el)
    return { us: cs.userSelect, wus: cs.webkitUserSelect, callout: cs.webkitTouchCallout }
  })
  check(selCss.us === 'text' || selCss.wus === 'text', 'reader: the article text is user-selectable (CSS half)', JSON.stringify(selCss))
  const guardExempt = await page.evaluate(() => {
    const p = document.querySelector('[data-iw-selectable] p')
    return { guarded: !!p.closest('.iw-touch-guard'), exempt: !!p.closest('[data-iw-selectable]') }
  })
  check(guardExempt.guarded && guardExempt.exempt,
    'reader: the article is inside the guard AND carries the selectable exemption (JS half)', JSON.stringify(guardExempt))

  // A DRAG-OWNING ELEMENT NEEDS ITS OWN touch-action. The reader's resize handle is not rendered in
  // the top dock; the article body must stay pannable.
  const bodyTA = await page.evaluate(() => getComputedStyle(document.querySelector('[data-iw-selectable]')).touchAction)
  check(bodyTA === 'pan-x pan-y' || bodyTA === 'auto' || bodyTA === 'pan-y',
    'reader: the article body still pans', bodyTA)

  // THE MARKUP BAR'S HOLD GESTURE. A hold that opens a palette must not also start the browser's
  // own long-press. Measured: does the tool button suppress selection + callout?
  const holdBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-probe-reader] button')].find((x) => /^Highlight —/.test(x.title || ''))
    if (!b) return null
    const cs = getComputedStyle(b)
    const r = b.getBoundingClientRect()
    return { us: cs.userSelect, wus: cs.webkitUserSelect, callout: cs.webkitTouchCallout, ta: cs.touchAction, w: r.width, h: r.height }
  })
  check(!!holdBtn, 'reader: the markup bar renders its hold-to-open tools')
  if (holdBtn) {
    check(holdBtn.us === 'none' || holdBtn.wus === 'none',
      'reader: a hold on a tool button cannot start a text selection', JSON.stringify(holdBtn))
    check(holdBtn.ta === 'none' || holdBtn.ta === 'manipulation',
      'reader: a hold on a tool button does not fight a native pan/zoom gesture', `touch-action=${holdBtn.ta}`)
  }

  // DOES THE HOLD ACTUALLY OPEN THE PALETTE UNDER TOUCH, and does a tap outside close it?
  const paletteBox = await page.locator('[data-probe-reader] button[title^="Highlight —"]').boundingBox()
  if (paletteBox) {
    const cx = paletteBox.x + paletteBox.width / 2, cy = paletteBox.y + paletteBox.height / 2
    await page.touchscreen.tap(cx, cy) // clear any armed state first
    await page.waitForTimeout(150)
    await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y)
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: x, clientY: y }))
    }, [cx, cy])
    await page.waitForTimeout(600)
    const opened = await page.evaluate(() => document.querySelectorAll('[data-probe-reader] button[style*="border-radius: 50%"]').length)
    await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y)
      el?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', clientX: x, clientY: y }))
    }, [cx, cy])
    check(opened > 0, 'reader: HOLDING a tool opens its colour palette under touch', `${opened} swatch(es)`)
    // Tap-outside dismissal: the scrim listens for a gesture the finger actually produces.
    const scrimHandler = await page.evaluate(() => {
      const scrim = [...document.querySelectorAll('[data-probe-reader] div')].find((d) => {
        const s = d.getAttribute('style') || ''
        return /position: fixed/.test(s) && /inset: 0/.test(s)
      })
      return scrim ? 'present' : 'absent'
    })
    note(`reader: palette dismiss scrim ${scrimHandler}`)
    // ⚠ NOT Escape — Escape CLOSES THE READER, and the selection tests below then measured a panel
    // that was not there and reported the popover missing. Dismiss the palette by its own scrim.
    await page.evaluate(() => {
      const scrim = [...document.querySelectorAll('[data-probe-reader] div')].find((d) => {
        const s = d.getAttribute('style') || ''
        return /position: fixed/.test(s) && /inset: 0/.test(s)
      })
      // POINTERDOWN ONLY. A finger produces this; whether it ALSO produces a synthetic mousedown
      // is iOS's call, and it withholds one whenever the gesture is treated as a scroll or a
      // touchmove was preventDefaulted — which the panel's own `.iw-touch-guard` handler does.
      scrim?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
    })
    await page.waitForTimeout(300)
    const stillOpen = await page.evaluate(() => {
      const scrim = [...document.querySelectorAll('[data-probe-reader] div')].find((d) => {
        const s = d.getAttribute('style') || ''
        return /position: fixed/.test(s) && /inset: 0/.test(s)
      })
      return !!scrim
    })
    check(!stillOpen, 'reader: a TOUCH outside dismisses the palette (pointerdown, not mousedown-only)')
  }

  // ── THE SECTION LIST, WHICH ON A PHONE IS THE ONLY ROUTE BETWEEN SECTIONS ──────────────────────
  // The 220px column is `navRoom`-gated, so at 375px it cannot render — and the ☰ that re-opens it
  // used to live INSIDE it, which meant a reader with the column open had no control either. The
  // header ☰ replaces both. This drives it rather than trusting it: a menu whose rows are not
  // thumb-sized, or which hangs off a 375px screen, is the same class of gap wearing a fix's
  // clothes.
  {
    const opened = await page.evaluate(() => {
      const b = [...document.querySelectorAll('[data-probe-reader] button')].find((x) => (x.title || '') === 'Sections')
      if (!b) return { trigger: false }
      b.click()
      return { trigger: true }
    })
    check(opened.trigger, 'reader: the ☰ Sections trigger exists at 375px (the column cannot)')
    await page.waitForTimeout(250)
    const menu = await page.evaluate(() => {
      const m = document.querySelector('[data-probe-reader] [role="menu"][aria-label="Sections"]')
      if (!m) return null
      const r = m.getBoundingClientRect()
      const items = [...m.querySelectorAll('[role="menuitem"]')].map((i) => {
        const ir = i.getBoundingClientRect()
        return { h: Math.round(ir.height * 10) / 10, w: Math.round(ir.width * 10) / 10, text: (i.textContent || '').trim().slice(0, 24) }
      })
      return { x: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height), items, vw: innerWidth }
    })
    // VOID rather than pass: every assertion below is "for each row", vacuously true of no menu.
    if (!menu) { note('reader ☰: VOID — the menu did not open, nothing below is readable') }
    else {
      note(`reader ☰: menu ${menu.right - menu.x}×${menu.h} at x=${menu.x} · ${menu.items.length} section(s)`)
      check(menu.items.length > 1, 'reader ☰: the menu lists the sections', `${menu.items.length} row(s)`)
      check(menu.x >= 0 && menu.right <= menu.vw,
        'reader ☰: the menu fits the phone width', `x=${menu.x} right=${menu.right} vw=${menu.vw}`)
      // Its rows must be tall FOR REAL: `[role="menu"] button::after` is exempt from the hit-region
      // pseudo (in a column those regions eat their neighbours), so nothing widens these for us.
      const short = menu.items.filter((i) => i.h < TAP_MIN)
      check(short.length === 0, `reader ☰: every section row is ≥ ${TAP_MIN}px tall (no pseudo can help a menu)`,
        short.map((i) => `${i.text} ${i.w}×${i.h}`).join(' | ') || `all ${menu.items.length} ok`)
      // And it dismisses on a TOUCH, not on a mouse event a finger may never produce.
      await page.evaluate(() => {
        const scrim = [...document.querySelectorAll('[data-probe-reader] div')].find((d) => {
          const s = d.getAttribute('style') || ''
          return /position: fixed/.test(s) && /inset: 0/.test(s)
        })
        scrim?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
      })
      await page.waitForTimeout(250)
      const gone = await page.evaluate(() => !document.querySelector('[data-probe-reader] [role="menu"][aria-label="Sections"]'))
      check(gone, 'reader ☰: a TOUCH outside dismisses it (pointerdown, not mousedown-only)')
    }
  }

  // ── THE SELECTION POPOVER, at phone width ──────────────────────────────────────────────────────
  // ⚠ DISARM FIRST. The palette test above TAPPED the highlight tool, which ARMS it — and an armed
  // highlight/note tool deliberately MARKS a selection instead of raising the popover
  // (SourceBrowser's selection effect). The first cut of this probe skipped that and reported "a
  // selection raises no popover", which is a probe artefact that reads exactly like the feature
  // being broken.
  // ⚠ TWO CLICKS, and the first one is not wasted. The hold above set `heldRef`, which the tool's
  // own onClick consumes and RETURNS on — in real use that consumption is the browser's own click
  // after a long-press release, but a SYNTHETIC pointerdown/pointerup produces no click, so the
  // flag is still standing. Click once to spend it, once to disarm. (The first cut clicked once,
  // spent the flag, left the tool armed, and reported "no popover" about working code.)
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('[data-probe-reader] button')].find((x) => /^Highlight —/.test(x.title || ''))
      b?.click()
    })
    await page.waitForTimeout(150)
  }
  const stillArmed = await page.evaluate(() => !!document.querySelector('[data-iw-selectable][data-iw-tool]'))
  check(!stillArmed, 'reader: the highlight tool disarms (probe precondition for the popover below)')
  await page.evaluate(() => {
    const p = document.querySelectorAll('[data-iw-selectable] p')[1]
    const r = document.createRange(); r.selectNodeContents(p)
    const s = getSelection(); s.removeAllRanges(); s.addRange(r)
    p.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
  })
  await page.waitForTimeout(500)
  const pop = await page.evaluate(() => {
    const q = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'quote this')
    if (!q) return null
    const box = q.parentElement
    const r = box.getBoundingClientRect()
    const btns = [...box.querySelectorAll('button')].map((b) => {
      const bb = b.getBoundingClientRect()
      const af = getComputedStyle(b, '::after')
      const ah = af.content !== 'none' && af.content !== 'normal' ? parseFloat(af.height) : NaN
      return { t: (b.textContent || b.title || '').trim().slice(0, 18), w: Math.round(bb.width), h: Math.round(bb.height),
               hitH: Number.isFinite(ah) ? Math.max(bb.height, ah) : bb.height }
    })
    return { x: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height), vw: window.innerWidth, btns }
  })
  check(!!pop, 'reader: a selection raises the citation popover')
  if (pop) {
    note(`reader popover: ${pop.w}×${pop.h} spanning x=${pop.x}..${pop.right} of ${pop.vw}px`)
    check(pop.x >= -1 && pop.right <= pop.vw + 1, 'reader: the selection popover fits the phone width',
      `x=${pop.x} right=${pop.right} vw=${pop.vw}`)
    const tinyPop = pop.btns.filter((x) => x.hitH < TAP_MIN)
    check(tinyPop.length === 0, `reader: every popover action's hit area is ≥ ${TAP_MIN}px tall`,
      tinyPop.map((x) => `${x.t} ${x.w}×${x.h} hit ${x.hitH}`).join(' | ') || 'all ok')
  }

  // THE EDGE CASE THAT ONLY EXISTS AT 375px: the popover is centred on the point you touched, so a
  // selection near a margin used to hang half of it off the screen. Select the LAST words of a
  // paragraph — the rect's centre sits far right — and check it is still fully on screen.
  const edgePop = await page.evaluate(() => {
    const p = document.querySelectorAll('[data-iw-selectable] p')[1]
    // The reader renders a block as marked RUNS, so `firstChild` is often an element, not a text
    // node — the first cut read that as "no text here" and reported VOID about a paragraph full of
    // it. Walk to the last text node instead.
    const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
    let t = null
    while (w.nextNode()) if ((w.currentNode.textContent || '').trim().length > 6) t = w.currentNode
    if (!t) return null
    const r = document.createRange()
    r.setStart(t, Math.max(0, t.textContent.length - 6)); r.setEnd(t, t.textContent.length)
    const s = getSelection(); s.removeAllRanges(); s.addRange(r)
    p.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    return new Promise((res) => setTimeout(() => {
      const q = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'quote this')
      if (!q) return res(null)
      const bb = q.parentElement.getBoundingClientRect()
      res({ left: Math.round(bb.left), right: Math.round(bb.right), vw: window.innerWidth })
    }, 400))
  })
  if (edgePop) {
    check(edgePop.left >= -1 && edgePop.right <= edgePop.vw + 1,
      'reader: a selection at a MARGIN still puts the whole popover on screen',
      `left=${edgePop.left} right=${edgePop.right} vw=${edgePop.vw}`)
  } else note('reader: edge-selection popover VOID (no popover raised) — not scored')

  // ── LIVE VIEW AT 375px (2026-08-30) ────────────────────────────────────────────────────────────
  // Peter asked for zoom + two-finger pan in the live browser, and for the PDF's zoom controls to be
  // ported into it. That adds FIVE controls to a panel whose every control was broken at this width
  // until it was audited — so they are measured here as they land, not after he finds them.
  console.log('\n── THE READER IN LIVE VIEW, at 375px with touch ─────────────────────────────────')
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.title || '').startsWith('Live page'))
    if (b) b.click()
  })
  await page.waitForTimeout(1200)
  const live = await page.evaluate(new Function('return ' + AUDIT)(), '[data-probe-reader]')
  if (live.error) {
    check(false, 'VOID: the reader panel vanished when switching to live view', live.error)
  } else {
    report('reader (live)', live)
    // THE BAR'S OWN CONTROLS. Named, so a missing one is a failure rather than a smaller list.
    const wanted = ['Zoom out', 'Zoom in', 'Fit the page to the panel width', 'Reload this page']
    for (const w of wanted) {
      const hit = live.controls.find((c) => c.label.startsWith(w))
      check(!!hit, `live: the "${w}" control renders at 375px`, hit ? `${hit.w}x${hit.h} hit ${Math.round(hit.hitW)}x${Math.round(hit.hitH)}` : 'ABSENT')
      if (hit) {
        check(hit.hitH >= TAP_MIN, `live: "${w}" has a >= ${TAP_MIN}px tall hit area`,
          `painted ${hit.h}px, hit ${Math.round(hit.hitH)}px`)
      }
    }
    // A <select> can borrow no pseudo-element, so its own box is the only target it has.
    const sel = live.controls.find((c) => c.tag === 'select')
    check(!!sel && sel.h >= 40, 'live: the page-width select gets a real >= 40px box', sel ? `${sel.w}x${sel.h}` : 'ABSENT')
    // AND NOTHING PAINTS PAST THE EDGE. The live bar carries a label, a select and four controls;
    // at 375px they cannot fit on one line, which is why it wraps rather than overflowing.
    check(live.widest <= live.vv.w + 1, 'live: the bar wraps rather than pushing its own controls off screen',
      `widest=${live.widest} (${live.widestSel}) vw=${live.vv.w}`)
  }
  // Back to reader view so the sections below are unaffected.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.title || '').startsWith('Reader view'))
    if (b) b.click()
  })
  await page.waitForTimeout(900)

  // ── THE PDF TOOLBAR + READER VIEW ──────────────────────────────────────────────────────────────
  console.log('\n── THE PDF READER, at 375px with touch ─────────────────────────────────────────')
  // ⚠ THE PANEL RESOLVES THE BYTES ITSELF. `openPdf({data})` is not a thing: PdfSidePanel reads
  // `hasPdf(bibProvider.get(key))` (which asks for `_iw.pdfName`) and then `getPdfData(key)`, which
  // reads OPFS at library/pdfs/<key>.pdf. So the fixture is seeded where the SHIPPED code looks —
  // handing the event a data URL would open "No attachment" and read as the viewer being broken.
  const pdfSeeded = await page.evaluate(async () => {
    // A one-page PDF, built by hand: enough for pdf.js to lay out, render and be marked up.
    const mk = () => {
      const objs = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
        null,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      ]
      const stream = 'BT /F1 18 Tf 72 740 Td (Persistence and change over time.) Tj 0 -28 Td (A second line of the fixture page.) Tj ET'
      objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
      let out = '%PDF-1.4\n'
      const offs = []
      objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
      const xref = out.length
      out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
        offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')
      out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
      const bytes = new Uint8Array(out.length)
      for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff
      return bytes
    }
    const bytes = mk()
    try {
      const root = await navigator.storage.getDirectory()
      const lib = await root.getDirectoryHandle('library', { create: true })
      const pdfs = await lib.getDirectoryHandle('pdfs', { create: true })
      const fh = await pdfs.getFileHandle('sider2001.pdf', { create: true })
      const w = await fh.createWritable(); await w.write(bytes); await w.close()
      // …and tell the library the source HAS one, which is what hasPdf() asks.
      const per = await (await root.getDirectoryHandle('library')).getDirectoryHandle(
        new URLSearchParams(location.search).get('doc'), { create: true })
      const ch = await per.getFileHandle('citations.json', { create: true })
      const cur = JSON.parse(await (await ch.getFile()).text())
      // …and a TEXT NOTE already on page 1. Seeding the STORED mark rather than driving the
      // placement gesture is deliberate: the fix under test is in the RENDER path (the note element
      // the viewer builds), and a synthetic placement tap is a harness detail that can fail for
      // reasons that have nothing to do with it — which is exactly what happened on the first run,
      // and it reported the drag "NOT MEASURED" about a note the viewer draws perfectly well.
      cur[0]._iw = {
        ...(cur[0]._iw || {}), pdfName: 'fixture.pdf',
        highlights: [{
          id: 'probe-note-1', page: 1, rects: [{ x: 0.2, y: 0.2, w: 0.3, h: 0.06 }],
          color: '#ffe066', kind: 'text', text: 'probe note', note: 'probe note', size: 12,
          createdAt: new Date().toISOString(),
        }],
      }
      const cw = await ch.createWritable(); await cw.write(JSON.stringify(cur)); await cw.close()
    } catch (e) { return 'seed failed: ' + e.message }
    return 'seeded'
  })
  note(`pdf: ${pdfSeeded}`)
  // Reload so the library is re-read with the PDF attached, then open it the way Peter does.
  await page.goto(`${base}/?doc=${docId}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(EDITOR, { timeout: 60000 })
  await page.waitForTimeout(2000)
  await page.evaluate(() => {
    const link = document.querySelector('.iw-cite-link')
    link?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    link?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    link?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  let pdfUp = false
  try {
    await page.waitForSelector('canvas', { timeout: 20000 })
    pdfUp = true
  } catch { /* reported below */ }
  if (!pdfUp) {
    note('pdf: the viewer did not come up from a synthetic open — PDF surfaces AUDITED STATICALLY below, not measured live')
  } else {
    await page.waitForTimeout(2500)
    const pdfRoot = await page.evaluate(() => {
      const c = document.querySelector('canvas')
      let p = c
      while (p && !(getComputedStyle(p).position === 'fixed' && p.getBoundingClientRect().width > 200)) p = p.parentElement
      if (!p) return false
      p.setAttribute('data-probe-pdf', '')
      return true
    })
    if (pdfRoot) {
      const pd = await page.evaluate(new Function('return ' + AUDIT)(), '[data-probe-pdf]')
      report('pdf', pd)
      check(pd.panel && pd.panel.y <= 2, 'pdf: the phone dock is the TOP dock', JSON.stringify(pd.panel))

      // ── THE PDF READER VIEW (pdfReflow), the third surface on the list ───────────────────────
      // Its own header carries two selects and two range sliders, none of which had been opened at
      // phone width. A <select> cannot borrow the hit region (replaced element, no pseudo-element),
      // so its own box is the only target it has.
      const reflowOpened = await page.evaluate(() => {
        const b = [...document.querySelectorAll('[data-probe-pdf] button')].find((x) => /^Reader view/.test(x.title || ''))
        if (!b) return 'no reader-view button'
        b.click()
        return 'clicked'
      })
      if (reflowOpened !== 'clicked') {
        check(false, 'pdf reader view: the toolbar offers it', reflowOpened)
      } else {
        await page.waitForTimeout(2500)
        const found = await page.evaluate(() => {
          // Its header is the one carrying a "Reading font" select and a "Text size" range.
          const s = document.querySelector('[data-probe-pdf] select[title="Reading font"]')
          if (!s) return false
          s.closest('div').setAttribute('data-probe-reflow', '')
          return true
        })
        if (!found) {
          check(false, 'pdf reader view: it rendered its controls', 'no "Reading font" select on screen')
        } else {
          const rv = await page.evaluate(new Function('return ' + AUDIT)(), '[data-probe-reflow]')
          report('pdf reader view', rv)
          // The two sliders are <input type=range>: they are not buttons and carry no ::after, so
          // they are scored on their real box like every other typing control.
          const ranges = await page.evaluate(() => [...document.querySelectorAll('[data-probe-reflow] input[type=range]')]
            .map((r) => { const b = r.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) } }))
          note(`pdf reader view: ${ranges.length} slider(s) ${ranges.map((r) => `${r.w}×${r.h}`).join(', ')} — a native range's thumb is the OS's own target, not ours`)
        }
        // Back to the page view so the note checks below run against the surface they mean.
        //
        // ⚠ ANCHOR ON THE HOOK, NOT THE TITLE. This matched `/^Reader view|^Page view/` against the
        // button's title — but in READER mode the title is 'Back to the page view', which matches
        // neither. `b` was undefined, `b?.click()` was a silent no-op, and the probe never left the
        // reader. The note checks below then ran against `PdfReaderView`, which emits
        // `data-note-id`, while they look for `data-hl-id` — an attribute only the page-view overlay
        // renders. So it reported "the seeded text note did not render" about a note the viewer
        // draws correctly. `data-iw-reader-toggle` (PdfViewer.tsx) is the stable hook.
        await page.evaluate(() => {
          document.querySelector('[data-probe-pdf] [data-iw-reader-toggle]')?.click()
        })
        // ASSERT WE ACTUALLY LEFT, rather than assuming the click worked — the whole bug above was a
        // no-op click nobody checked. `.iw-pdf-reader` is the reader's own root.
        await page.waitForFunction(() => !document.querySelector('[data-probe-pdf] .iw-pdf-reader'),
          null, { timeout: 5000 }).catch(() => {})
        await page.waitForTimeout(500)
      }

      // ── THE ⋮ EXPORT MENU, OPEN. A vertical menu is the one place the hit-region expansion must
      //    NOT apply: 2px apart, a 44px-tall region on each item reaches into both neighbours and
      //    the later one wins, so "Print" would take a bite out of "Export". Open it and re-run the
      //    same two checks on what is actually on screen.
      const menuOpened = await page.evaluate(() => {
        const b = document.querySelector('[data-probe-pdf] [data-iw-pdf-more]')
        if (!b) return 'no ⋮ button'
        b.click()
        return 'clicked'
      })
      await page.waitForTimeout(400)
      const menu = await page.evaluate(new Function('return ' + AUDIT)(), '[data-probe-pdf] [role="menu"]')
      if (menu.error) {
        check(false, 'pdf: the ⋮ export menu opens', `${menuOpened} — ${menu.error}`)
      } else {
        report('pdf ⋮ menu', menu)
      }
      await page.evaluate(() => {
        const b = document.querySelector('[data-probe-pdf] [data-iw-pdf-more]')
        b?.click()
      })
      await page.waitForTimeout(300)

      // ── A TEXT NOTE MUST BE DRAGGABLE BY A FINGER ────────────────────────────────────────────
      // Place one through the real tool, then read the element's OWN touch-action. The app-wide
      // phone rule is `pan-x pan-y` and touch-action does NOT inherit, so a note that does not
      // declare `none` loses its drag to the browser's scroll — silently, with pointercancel.
      const noteTA = await page.evaluate(() => {
        const n = document.querySelector('[data-probe-pdf] [data-hl-id]')
        if (!n) return { err: 'the seeded note did not render' }
        const cs = getComputedStyle(n)
        const r = n.getBoundingClientRect()
        // The ✕ badge is a SIBLING (a child of a contenteditable would pollute its textContent).
        const del = [...n.parentElement.querySelectorAll('button')].find((b) => /Remove note/.test(b.title || ''))
        const dr = del ? del.getBoundingClientRect() : null
        return { ta: cs.touchAction, w: Math.round(r.width), h: Math.round(r.height),
                 del: dr ? { w: Math.round(dr.width), h: Math.round(dr.height) } : null }
      })
      if (noteTA.err) {
        check(false, 'pdf: the seeded text note renders', noteTA.err)
      } else {
        check(noteTA.ta === 'none', 'pdf: a text note owns its own drag gesture (touch-action)',
          `touch-action=${noteTA.ta} on a ${noteTA.w}×${noteTA.h} note`)
        // The ✕ is display:none until the note is selected, so it has no box to read yet — select it.
        const delSize = await page.evaluate(() => {
          const n = document.querySelector('[data-probe-pdf] [data-hl-id]')
          n.dispatchEvent(new MouseEvent('click', { bubbles: true }))
          const del = [...n.parentElement.querySelectorAll('button')].find((b) => /Remove note/.test(b.title || ''))
          if (!del) return null
          const r = del.getBoundingClientRect()
          return { w: Math.round(r.width), h: Math.round(r.height), shown: getComputedStyle(del).display }
        })
        if (delSize && delSize.shown !== 'none') {
          check(Math.min(delSize.w, delSize.h) >= 24, 'pdf: a selected note’s ✕ handle is thumb-sized',
            `${delSize.w}×${delSize.h}`)
        } else note(`pdf: the note’s ✕ handle did not become visible on a synthetic click — NOT scored (${JSON.stringify(delSize)})`)
      }
    } else check(false, 'pdf: found the viewer panel')
  }
  // ── THE DESKTOP CONTROL — the fix must be INVISIBLE to a mouse ────────────────────────────────
  // An expanded hit region is right for a thumb and wrong for a pointer: an invisible 44px halo on
  // a 24px button would swallow clicks aimed at its neighbour, on the device where precision is
  // free. The rule is inside `@media (pointer: coarse) and (hover: none)`, and this is the arm that
  // proves that scoping rather than trusting it — a cell that only ever runs on touch cannot tell a
  // correctly-scoped rule from an unscoped one.
  console.log('\n── THE DESKTOP CONTROL (mouse, 1500px) — the rule must NOT apply ───────────────')
  const dctx = await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' })
  const dpage = await dctx.newPage()
  await dpage.route((u) => u.pathname === '/api/reader', (route) => {
    const u = new URL(route.request().url())
    if (u.searchParams.get('probe') === '1') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"framable":true}' })
    const { title, blocks } = extractBlocks(PAGE_HTML, u.searchParams.get('url') || '')
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: u.searchParams.get('url'), title, blocks }) })
  })
  // ⚠ OPFS IS PER CONTEXT. A fresh browser context starts with EMPTY storage, so the document and
  // library seeded above do not exist here — the first cut of this arm found no citation, opened
  // nothing, and VOIDed. (It voided rather than passing, which is the only reason that was five
  // minutes instead of an hour.) Seed again, WITHOUT the PDF, so a plain click opens the READER.
  await dpage.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
  await dpage.waitForSelector(EDITOR, { timeout: 60000 })
  await dpage.evaluate(async (id) => {
    const item = { id: 'sider2001', type: 'article-journal', title: 'Identity Over Time',
      author: [{ family: 'Sider', given: 'T' }], issued: { 'date-parts': [[2001]] },
      URL: 'https://plato.stanford.edu/entries/identity-time/' }
    const doc = { id, title: 'Desktop control', createdAt: new Date().toISOString(), schemaVersion: '1',
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'As argued ' },
        { type: 'citation', attrs: { citekeys: ['sider2001'], prefix: '', suffix: '', locator: '', suppressAuthor: false } },
        { type: 'text', text: ' the puzzle persists.' }] }] } }
    const root = await navigator.storage.getDirectory()
    const docs = await root.getDirectoryHandle('documents', { create: true })
    const dir = await docs.getDirectoryHandle(id, { create: true })
    const dh = await dir.getFileHandle('current.json', { create: true })
    const dw = await dh.createWritable(); await dw.write(JSON.stringify(doc)); await dw.close()
    const lib = await root.getDirectoryHandle('library', { create: true })
    const per = await lib.getDirectoryHandle(id, { create: true })
    const fh = await per.getFileHandle('citations.json', { create: true })
    const w = await fh.createWritable(); await w.write(JSON.stringify([item])); await w.close()
  }, docId + '-desk')
  await dpage.goto(`${base}/?doc=${docId}-desk`, { waitUntil: 'domcontentloaded' })
  await dpage.waitForSelector(EDITOR, { timeout: 60000 })
  await dpage.waitForTimeout(2500)
  await dpage.evaluate(() => {
    const link = document.querySelector('.iw-cite-link')
    link?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  let deskReady = false
  try { await dpage.waitForSelector('.iw-tap', { timeout: 25000 }); deskReady = true } catch { /* below */ }
  if (!deskReady) {
    // VOID rather than pass: "no expanded region" on a page with no toolbar is not an observation.
    const why = await dpage.evaluate(() => ({
      cite: document.querySelectorAll('.iw-cite-link').length,
      canvases: document.querySelectorAll('canvas').length,
      selectable: document.querySelectorAll('[data-iw-selectable]').length,
      body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 160),
    }))
    check(false, 'desktop: a panel with tap-row chrome opened (VOID guard — nothing to measure otherwise)',
      JSON.stringify(why))
  } else {
    await dpage.waitForTimeout(1200)
    const desk = await dpage.evaluate(() => {
      const btns = [...document.querySelectorAll('.iw-tap-row button, .iw-tap')]
      const grown = btns.filter((el) => {
        const af = getComputedStyle(el, '::after')
        return af.content !== 'none' && af.content !== 'normal'
      })
      return { total: btns.length, grown: grown.length }
    })
    check(desk.total > 5, 'desktop: the chrome rendered (so "none grew" means something)',
      `${desk.total} controls carrying the class`)
    check(desk.grown === 0, 'desktop: NOT ONE control grew a hit region — the rule is coarse-pointer only',
      `${desk.grown} of ${desk.total}`)
  }
  await dctx.close()
} catch (e) {
  console.log(`  ✗ ${e.message}\n${(e.stack || '').split('\n').slice(1, 4).join('\n')}`)
  fail++
} finally { await b.close(); await stop() }
console.log(fail ? `\nFAIL (${fail})` : '\nPASS')
process.exitCode = fail ? 1 : 0
