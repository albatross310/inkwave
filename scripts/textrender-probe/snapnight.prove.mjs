// THE /snapshot PALETTE, MEASURED IN A REAL BROWSER — every surface, both themes.
//
// WHAT THIS IS FOR. Peter, 2026-08-30: "The entire night mode palette for snapshot view still needs
// working through." /snapshot was HALF-themed — the doc pane went dark and the header bar, the diff
// panel, the summary card and the minimap stayed at full day brightness over it. Half-lit is worse
// than unlit: there is nowhere for the eye to rest, and it is the state a partial fix returns to the
// moment someone adds a control with a literal colour in it. So this probe sweeps the WHOLE route.
//
// ⚠ WHY A BROWSER AND NOT A UNIT TEST — the reason is recorded twice in CLAUDE.md and cost real time
// both times. jsdom does NOT resolve custom properties declared in a stylesheet, so a "the night
// value applies" assertion reports the DAY value in both themes and passes while proving nothing
// (theme.test.ts's own header says so). And the ledger drop-up's `color:#fff` on `background:
// var(--iw-ink)` was "structurally perfect and visually invisible" — the class was present, the
// token resolved, and white vanished on light purple. Only a real engine resolving real cascade can
// see that, so this reads COMPUTED colours and computes WCAG contrast on them.
//
// ⚠ BLOCK THE SERVICE WORKER (`serviceWorkers: 'block'`): Inkwave registers one, it answers from its
// own cache, and `page.route` does not intercept what it serves.
//
// THREE THINGS IT CHECKS, and the second and third are the ones a contrast number cannot give you:
//   1. CONTRAST — every painted item on every surface, in BOTH themes, against its real composited
//      background. Day must pass too: a palette that only works at night is half a palette.
//   2. THE THEME ACTUALLY MOVED — each surface's own background must DIFFER between day and night.
//      This is the check that would have caught the reported bug: the old diff panel scored a
//      perfect contrast pass in both themes because it was the identical cream in both.
//   3. NO ALARM RED AT NIGHT — the productivity work settled that cutting is writing and must never
//      be painted as an error (summary.test.ts sweeps the copy for the same rule). A deletion mark
//      may be warm; it may not be a warning light. Measured as saturation + darkness, not by name.
//
// Usage: pnpm build && pnpm prove:snapnight

import { chromium } from '@playwright/test'
import { startProbeServer } from './serve.mjs'
import { CONTRAST_WALKER } from './contrastWalker.mjs'

const DOC = 'snapnight-probe'
const VERSIONS = 8

// ── The seed ─────────────────────────────────────────────────────────────────────────────────────
// An in-memory OPFS shim installed before boot (the scrub-probe / snapsweep pattern — read, not
// reinvented: Playwright's browsers here have no usable OPFS). The fixture is SYNTHETIC — Peter's
// own prose never enters this repo — but it is shaped like the thing: versions that genuinely differ
// so the diff panel has real bullets, real strikethroughs and real inserts to paint. A fixture whose
// versions were identical would render ONE 'same' op and the whole diff palette would go unmeasured.
const seed = ({ docId, versions, theme }) => {
  let s = 20260830
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  const W = ('identity persistence change over time argument thesis chapter evidence claims analysis '
    + 'method critique framework ontology epistemology reason judgment perception substance present '
    + 'initially truth predicate memory continuity').split(/\s+/)
  const words = (n) => { const o = []; for (let i = 0; i < n; i++) o.push(W[Math.floor(rnd() * W.length)]); return o.join(' ') }
  const bodyFor = (v) => {
    const c = []
    for (let i = 0; i < 40; i++) {
      if (i % 9 === 0) c.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: `Section ${i}` }] })
      const lead = v > 2 && i === 3 ? 'initially present in the record ' : 'first present in the record '
      c.push({ type: 'paragraph', content: [{ type: 'text', text: lead + words(50) + '.' }] })
    }
    return c
  }
  const t0 = Date.now() - versions * 3600 * 1000
  const snaps = []
  for (let v = 0; v < versions; v++) {
    snaps.push({
      id: `snap-${String(v).padStart(3, '0')}`, documentId: docId,
      createdAt: new Date(t0 + v * 3600 * 1000).toISOString(), trigger: 'word-nudge',
      wordCount: 2100 + v * 12, contentHash: 'h' + v, bundleHash: 'b' + v,
      ots: { status: v % 3 === 0 ? 'confirmed' : 'pending' },
      diffSummary: v % 2 ? '"first present" changed to "initially present"' : undefined,
      contentJson: { type: 'doc', content: bodyFor(v) },
    })
  }
  const doc = {
    id: docId, title: 'Palette probe', createdAt: new Date(t0).toISOString(),
    updatedAt: new Date().toISOString(), schemaVersion: '1', contentJson: bodyFor(versions - 1),
  }

  const files = new Map()
  files.set(`documents/${docId}/snapshots.json`, new TextEncoder().encode(JSON.stringify(snaps)))
  files.set(`documents/${docId}/current.json`, new TextEncoder().encode(JSON.stringify(doc)))
  const fileHandle = (path) => ({
    kind: 'file', name: path.split('/').pop(),
    getFile: async () => new File([files.get(path)], path.split('/').pop()),
    createWritable: async () => {
      const chunks = []
      return {
        write: async (d) => { chunks.push(typeof d === 'string' ? new TextEncoder().encode(d) : new Uint8Array(d instanceof Blob ? await d.arrayBuffer() : d)) },
        truncate: async () => {}, seek: async () => {},
        close: async () => {
          let n = 0; for (const c of chunks) n += c.length
          const out = new Uint8Array(n); let o = 0
          for (const c of chunks) { out.set(c, o); o += c.length }
          files.set(path, out)
        },
      }
    },
  })
  const dirHandle = (prefix) => ({
    kind: 'directory', name: prefix.split('/').filter(Boolean).pop() || '',
    getDirectoryHandle: async (name) => dirHandle(prefix + name + '/'),
    getFileHandle: async (name, opts) => {
      const path = prefix + name
      if (!files.has(path)) {
        if (opts && opts.create) files.set(path, new Uint8Array())
        else throw new DOMException('missing', 'NotFoundError')
      }
      return fileHandle(path)
    },
    removeEntry: async () => {}, values: async function* () {}, keys: async function* () {},
  })
  const shim = {
    getDirectory: async () => dirHandle(''), persist: async () => true,
    persisted: async () => true, estimate: async () => ({ quota: 1e9, usage: 0 }),
  }
  try { Object.defineProperty(navigator, 'storage', { value: shim, configurable: true }) } catch { navigator.storage = shim }
  try { localStorage.setItem('inkwave:theme', theme); localStorage.setItem('inkwave:activeDocumentId', docId) } catch { /* private */ }
}

// ── The surfaces, named once ─────────────────────────────────────────────────────────────────────
// Selected by GEOMETRY + a marker attribute stamped in-page rather than by class, because most of
// /snapshot is styled inline and its panes carry no stable class of their own. Marking is done in
// ONE in-page pass so a mis-selected surface is visible as a wrong box in the output rather than as
// a silent "0 painted items" — the nightaudit trap where `querySelectorAll('div').find(...)` picked
// a zero-sized wrapper, the visibility gate bailed, and a surface that was never read scored as a
// surface with nothing wrong.
const MARK = `
(() => {
  const out = {}
  const mark = (el, name) => { if (!el) return; el.setAttribute('data-iw-snapprobe', name); out[name] = true }
  const boxOf = (el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) } }

  // The fixed header bar: the only fixed, full-width, top-anchored element on the route.
  mark([...document.querySelectorAll('div')].find((d) => {
    const cs = getComputedStyle(d); const r = d.getBoundingClientRect()
    return cs.position === 'fixed' && r.top === 0 && r.width >= window.innerWidth - 2 && r.height > 20 && r.height < 90
  }), 'header')

  // The three panes are the grid's own children, in DOM order: diff | d1 | editor | d2 | side.
  const grid = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).display === 'grid' && d.getBoundingClientRect().height > 400)
  if (grid) {
    const kids = [...grid.children]
    mark(kids[0], 'diffPanel')
    mark(kids[4], 'sidePanel')
  }
  // Inside the side panel: the summary card (the scroll box) and the minimap (the grid below it).
  const side = document.querySelector('[data-iw-snapprobe="sidePanel"]')
  if (side) {
    mark(side.querySelector('.iw-snap-scroll'), 'summaryCard')
    mark([...side.querySelectorAll('div')].find((d) => getComputedStyle(d).display === 'grid'), 'minimap')
  }
  // The floating control stack (version pill + the two toggles) — fixed, narrow, near the top.
  mark([...document.querySelectorAll('div')].find((d) => {
    const cs = getComputedStyle(d); const r = d.getBoundingClientRect()
    return cs.position === 'fixed' && cs.flexDirection === 'column' && r.width > 40 && r.width < 220 && r.top < 200
  }), 'controls')
  // The Verify button — fixed, bottom-right.
  mark([...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Verify'), 'verify')
  // The active document pane's own diff marks live in the doc layer; mark the active layer.
  mark(document.querySelector('.iw-snap-layer-active') || document.querySelector('.scroll-paper'), 'docPane')

  for (const k of Object.keys(out)) out[k] = boxOf(document.querySelector('[data-iw-snapprobe="' + k + '"]'))
  return out
})()
`

// Reads the effective background of each marked surface + the diff marks' own colours. Used for the
// "did the theme actually move" and "no alarm red" checks, which contrast alone cannot answer.
const READ = `
(() => {
  const out = { surfaces: {}, marks: {} }
  for (const el of document.querySelectorAll('[data-iw-snapprobe]')) {
    const c = window.__iwBgOf(el)
    out.surfaces[el.getAttribute('data-iw-snapprobe')] = '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
  }
  const first = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const cs = getComputedStyle(el)
    const bg = window.__iwBgOf(el)
    return { color: cs.color, bg: '#' + [bg.r, bg.g, bg.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('') }
  }
  out.marks.add = first('span.diff-add')
  out.marks.del = first('span.diff-del')
  out.counts = { add: document.querySelectorAll('span.diff-add').length, del: document.querySelectorAll('span.diff-del').length }
  return out
})()
`

const { base: BASE, stop } = await startProbeServer()
const b = await chromium.launch({ headless: true })

let fail = 0
const bad = []
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra ? ' — ' + extra : ''}`)
  if (!ok) fail++
}
// VOID, not FAIL: a check that could not run says so. "The surface was not there" and "the surface
// is wrong" are different answers, and collapsing them is how a probe reports a working feature
// broken (or, worse, an absent feature fine).
const voids = []
const voidIt = (msg) => { console.log(`  ∅ VOID — ${msg}`); voids.push(msg) }

const hexToRgb = (h) => { h = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) }
const lum = (c) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
}
/** Perceived distance between two opaque hexes, as a WCAG ratio. 1.0 = identical. */
const ratio = (a, b) => {
  const l1 = lum(hexToRgb(a)), l2 = lum(hexToRgb(b))
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}
const parseRgb = (s) => {
  const m = /rgba?\(([^)]+)\)/.exec(s || '')
  if (!m) return null
  const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number)
  return [p[0], p[1], p[2]]
}

const readTheme = async (theme) => {
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`    PAGEERROR(${theme}):`, e.message.slice(0, 140)))
  await page.addInitScript(CONTRAST_WALKER)
  await page.addInitScript(seed, { docId: DOC, versions: VERSIONS, theme })
  await page.goto(`${BASE}/snapshot?doc=${DOC}&snap=snap-005`, { waitUntil: 'domcontentloaded' })

  // WAIT FOR THE CONTENT, NEVER THE CLOCK. `pdfposthoc.prove.mjs` records the cost of the other
  // way: a fixed sleep reported "the indicator did not render" about a panel that renders it, and
  // sent a real morning after a bug that did not exist. The diff panel's own bullets are the last
  // thing to appear, so they are what we wait on.
  const ready = await page.waitForFunction(
    () => document.querySelectorAll('span.diff-del').length > 0 && document.querySelectorAll('span.diff-add').length > 0,
    null, { timeout: 45000 },
  ).then(() => true).catch(() => false)
  if (!ready) { await ctx.close(); return { void: 'the diff panes never rendered any marks' } }
  await page.waitForTimeout(1200) // let the LoadingVeil coast off the panes before reading colours

  const applied = await page.evaluate(() => document.documentElement.dataset.theme || 'day')
  const boxes = await page.evaluate(MARK)
  const read = await page.evaluate(READ)

  const audits = {}
  for (const name of ['header', 'diffPanel', 'sidePanel', 'summaryCard', 'minimap', 'controls', 'verify']) {
    if (!boxes[name]) { audits[name] = { missing: true }; continue }
    audits[name] = await page.evaluate((s) => window.__iwAudit(s), `[data-iw-snapprobe="${name}"]`)
  }
  await page.screenshot({ path: `/tmp/iw-snapnight-${theme}.png` })
  await ctx.close()
  return { applied, boxes, read, audits }
}

try {
  // ── ARM THE INSTRUMENT ─────────────────────────────────────────────────────────────────────────
  // Before a single real number is read: plant the known bug this app has actually shipped (the
  // ledger's day-purple ink on the night chrome) beside a known-good, and assert the walker
  // SEPARATES them. A walker that reports zero failures and one that measured nothing look
  // identical in the output, and this project has shipped the second more than once.
  {
    const ctx = await b.newContext({ serviceWorkers: 'block' })
    const page = await ctx.newPage()
    await page.addInitScript(CONTRAST_WALKER)
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    const armed = await page.evaluate(() => {
      const host = document.createElement('div')
      host.id = 'iw-snapprobe-selftest'
      host.style.cssText = 'position:fixed;left:-9999px;top:0;background:#454e59;padding:8px;font-size:13px'
      host.innerHTML = '<span style="color:#5c2d8a">dark purple on dolphin grey</span>'
        + '<span style="color:#dfe3e9">light grey on dolphin grey</span>'
      document.body.appendChild(host)
      const r = window.__iwAudit('#iw-snapprobe-selftest')
      host.remove()
      return r.items.map((i) => ({ label: i.label.slice(0, 12), ratio: i.ratio, ok: i.ok }))
    })
    const k = Object.fromEntries(armed.map((a) => [a.label, a]))
    check(!!k['dark purple '] && !k['dark purple '].ok, 'the walker SEES a known bug (#5c2d8a on #454e59)', JSON.stringify(k['dark purple ']))
    check(!!k['light grey o'] && k['light grey o'].ok, 'the walker PASSES a known-good (#dfe3e9 on #454e59)', JSON.stringify(k['light grey o']))
    await ctx.close()
  }
  if (fail) throw new Error('the instrument does not discriminate — no verdict is readable')

  const R = {}
  for (const theme of ['day', 'night']) {
    console.log(`\n──────── ${theme.toUpperCase()} ────────`)
    R[theme] = await readTheme(theme)
    if (R[theme].void) { voidIt(`[${theme}] ${R[theme].void}`); continue }
    check(R[theme].applied === theme, `[${theme}] the theme is applied to <html>`, `data-theme=${R[theme].applied}`)
    console.log(`  · marks painted: ${R[theme].read.counts.add} add / ${R[theme].read.counts.del} del`)

    // ── 1. CONTRAST, every surface ──────────────────────────────────────────────────────────────
    for (const [name, a] of Object.entries(R[theme].audits)) {
      if (a.missing) { voidIt(`[${theme}] surface "${name}" was not found — nothing measured`); continue }
      const fails = (a.items || []).filter((i) => !i.ok)
      console.log(`  · [${theme}] ${name}: ${(a.items || []).length} painted items, ${fails.length} below threshold`)
      if (!a.items || a.items.length === 0) { voidIt(`[${theme}] surface "${name}" painted 0 items — a surface that was never read`); continue }
      for (const f of fails) {
        console.log(`      ✗ ${f.fg} on ${f.bg} = ${f.ratio}:1 (needs ${f.need}) ${f.size}px/${f.weight} "${f.label}"`)
        bad.push({ theme, name, ...f })
      }
    }

    // The doc pane's diff marks, scored explicitly: they are the one thing the surface sweeps above
    // cannot reach (the pane is a keep-alive layer stack, not a marked surface).
    for (const kind of ['add', 'del']) {
      const m = R[theme].read.marks[kind]
      if (!m) { voidIt(`[${theme}] no ${kind} mark to score`); continue }
      const fg = parseRgb(m.color)
      const r = fg ? ratio('#' + fg.map((v) => v.toString(16).padStart(2, '0')).join(''), m.bg) : 0
      check(r >= 4.5, `[${theme}] the ${kind} mark's text is legible on its own tint`, `${m.color} on ${m.bg} = ${r.toFixed(2)}:1`)
    }
  }

  if (voids.length === 0 && R.day && R.night && !R.day.void && !R.night.void) {
    // ── 2. THE THEME ACTUALLY MOVED ──────────────────────────────────────────────────────────────
    // THE CHECK THAT WOULD HAVE CAUGHT THE REPORTED BUG. Every surface below scored a clean contrast
    // pass in BOTH themes before this palette landed — because it was the identical cream in both.
    // Contrast is a property of one screen; theming is a property of the pair.
    console.log('\n──────── THE THEME MOVED? ────────')
    for (const name of Object.keys(R.day.audits)) {
      const d = R.day.read.surfaces[name], n = R.night.read.surfaces[name]
      if (!d || !n) { voidIt(`surface "${name}" has no background on one side (${d} / ${n})`); continue }
      const moved = d.toLowerCase() !== n.toLowerCase()
      const sep = ratio(d, n)
      check(moved && sep >= 2, `"${name}" is a different surface at night`, `${d} → ${n} (${sep.toFixed(1)}× apart)`)
    }
    // A GROUND must go DARKER at night, not merely different — a palette that swapped one cream for
    // another would pass "moved" and still fail the writer.
    //
    // ⚠ AN INK-FILLED CONTROL INVERTS, AND THAT IS THE POINT — the first cut of this check failed
    // the Verify button and the check was the thing that was wrong. Verify is a FIGURE on the
    // ground, not a ground: --iw-ink is DARK purple by day (white label) and LIGHT purple at night
    // (dark label), which is precisely what --iw-on-ink exists to encode after the ledger drop-up
    // shipped a literal white that vanished on it. So an ink fill is not EXEMPTED here — it is held
    // to the OPPOSITE assertion, which is strictly stronger than a skip: the fill must go lighter
    // AND its own label must go dark, or the token has quietly stopped working.
    const INK_FILLED = new Set(['verify'])
    for (const name of Object.keys(R.day.audits)) {
      const d = R.day.read.surfaces[name], n = R.night.read.surfaces[name]
      if (!d || !n) continue
      const ld = lum(hexToRgb(d)), ln = lum(hexToRgb(n))
      if (INK_FILLED.has(name)) {
        check(ln > ld, `"${name}" is an INK FILL and inverts — lighter at night`, `lum ${ld.toFixed(3)} → ${ln.toFixed(3)}`)
        const dayLabel = (R.day.audits[name].items || [])[0]
        const nightLabel = (R.night.audits[name].items || [])[0]
        if (!dayLabel || !nightLabel) voidIt(`"${name}" painted no label to score --iw-on-ink against`)
        else {
          check(lum(hexToRgb(nightLabel.fg)) < lum(hexToRgb(dayLabel.fg)),
            `"${name}"'s label follows --iw-on-ink — dark on the light night fill`,
            `${dayLabel.fg} → ${nightLabel.fg}`)
        }
      } else {
        check(ln < ld, `"${name}" is DARKER at night, not just different`, `lum ${ld.toFixed(3)} → ${ln.toFixed(3)}`)
      }
    }

    // ── 3. NO ALARM RED AT NIGHT ─────────────────────────────────────────────────────────────────
    // Peter's rule, inherited from the productivity work: cutting is writing, so a deletion is never
    // an error state. Measured, not asserted by name — an alarm red is SATURATED and DARK. The night
    // deletion mark is a dusty rose: still warm, still instantly separable from the addition's sage,
    // not a warning light. The pair must also stay APART, or the distinction stops carrying meaning.
    console.log('\n──────── NO ALARM RED (night) ────────')
    const del = parseRgb(R.night.read.marks.del?.color)
    const add = parseRgb(R.night.read.marks.add?.color)
    if (!del || !add) voidIt('could not read the night mark colours')
    else {
      const [r, g, bch] = del
      const maxc = Math.max(r, g, bch), minc = Math.min(r, g, bch)
      const sat = maxc === 0 ? 0 : (maxc - minc) / maxc
      const isAlarm = sat > 0.6 && maxc < 210 && r === maxc   // saturated + dark + red-dominant
      check(!isAlarm, 'the night deletion mark is not an alarm red', `rgb(${del}) sat=${sat.toFixed(2)} max=${maxc}`)
      check(lum(del) > 0.25, 'the night deletion mark is LIGHT on dark paper, not a dark red', `lum=${lum(del).toFixed(3)}`)
      // Hue separation: the two must not converge into "two greys".
      const hueGap = Math.abs((del[0] - del[2]) - (add[0] - add[2])) + Math.abs((del[1] - del[0]) - (add[1] - add[0]))
      check(hueGap > 40, 'add and delete stay clearly separable at night', `rgb(${add}) vs rgb(${del}), gap=${hueGap}`)
    }
  } else {
    voidIt('one theme did not render — the day/night comparison cannot be read')
  }

  console.log('\n──────── VERDICT ────────')
  console.log(`  day failures:   ${bad.filter((x) => x.theme === 'day').length}`)
  console.log(`  night failures: ${bad.filter((x) => x.theme === 'night').length}`)
  console.log(`  voids:          ${voids.length}`)
  check(bad.length === 0, 'every painted surface on /snapshot meets its contrast threshold in BOTH themes',
    bad.length ? bad.slice(0, 8).map((x) => `${x.theme}/${x.name}:${x.ratio}`).join(' ') : '')
  // A VOID is not a pass. If a surface never rendered, this run says nothing about it and must not
  // be read as green — that conflation is the one this file's own comments keep warning about.
  check(voids.length === 0, 'every surface was actually measured (no voids)', voids.slice(0, 4).join(' | '))
} catch (e) {
  console.log(`  ✗ ${e.message}\n${e.stack}`)
  fail++
} finally {
  await b.close()
  await stop()
}

console.log(fail ? `\nFAIL (${fail})` : '\nPASS')
process.exitCode = fail ? 1 : 0
