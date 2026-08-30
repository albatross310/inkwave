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
// WHAT IS DELIBERATELY EXEMPT. The reader's ARTICLE and the PDF's PAGE are PAPER: a mark's colour is
// stored in the mark and shared with the PDF viewer, so a theme that reinterpreted it would make one
// highlight two colours on two devices (index.css, `.iw-reader-page`). Paper stays light in both
// themes; night only takes the glare off it. So paper surfaces are audited for legibility (they must
// still pass) and NOT for "did it go dark".
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
