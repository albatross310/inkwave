// REGISTRATION at FULL SAMPLE — does the doc pane land the SAME CONTENT at the centre across
// versions? The burst recorder can only carry a centre signature for frames it captured this
// session (a hydrated thumb has none), so its `registered` rate runs on 0-7 steps of a 12-step
// burst — too few to accept or reject an anchoring rule. This reads the property directly, on
// every version the sweep primes, at the scrollTop each version's bitmap is captured at.
//
// PROVE THE INSTRUMENT FIRST: cell A runs the OLD rule (__iwAnchorRule='scrolltop') in the REAL
// app. If the probe cannot see the KNOWN misregistration there, its verdict on the fix is worthless.
import { chromium } from '@playwright/test'
import { readFile } from 'node:fs/promises'
const PORT = process.env.PROBE_PORT || 4291, BASE = `http://127.0.0.1:${PORT}`
const IDLE_S = Number(process.env.PROBE_IDLE_S || 60)
const src = await readFile(new URL('./probe.mjs', import.meta.url), 'utf8')
const buildSnapshots = new Function(src.slice(src.indexOf('function buildSnapshots'), src.indexOf('// Runs BEFORE app scripts')) + '; return buildSnapshots()')
const tsrc = await readFile(new URL('./probe-thumbs.mjs', import.meta.url), 'utf8')
const realOpfsShim = eval('(' + tsrc.slice(tsrc.indexOf('(json) => {'), tsrc.indexOf('const med =')).trim().replace(/;\s*$/, '') + ')')

const cell = async (label, { rule, lineMode }) => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))
  await page.addInitScript(realOpfsShim, buildSnapshots())
  await page.addInitScript(([r, m]) => {
    window.__iwAnchorTrace = []; window.__iwPerf = []
    if (r) window.__iwAnchorRule = r
    try { localStorage.setItem('inkwave:snapLineMode', m) } catch {}
  }, [rule, lineMode])
  await page.goto(`${BASE}/snapshot?doc=probe-doc-scrub&snap=snap-26&snapThumbs=1`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.iw-snap-layer-active .tiptap-editor', { timeout: 30000 })
  await page.waitForTimeout(IDLE_S * 1000) // let the sweep prime + bake the library
  const out = await page.evaluate(() => {
    const tr = window.__iwAnchorTrace
    const modes = {}
    const cost = []
    for (const [l, ms] of window.__iwPerf) {
      if (!l.startsWith('scrub.anchor.')) continue
      const k = l.replace('scrub.anchor.', '')
      modes[k] = (modes[k] || 0) + 1
      cost.push(ms)
    }
    cost.sort((a, b) => a - b)
    // FAILURES ARE REPORTED, not just successes: an empty/blank signature is a probe failure, not a hold.
    const blank = tr.filter((e) => !e.sig || e.sig.length < 8).length
    const good = tr.filter((e) => e.sig && e.sig.length >= 8)
    let same = 0, steps = 0
    for (let i = 1; i < good.length; i++) { if (good[i].id === good[i - 1].id) continue; steps++; if (good[i].sig === good[i - 1].sig) same++ }
    // Did the anchor LAND? want = the text the rule tried to put at the centre; sig = what is there.
    const withWant = good.filter((e) => e.want && e.want.length >= 8)
    const landed = withWant.filter((e) => e.sig.slice(0, 24) === e.want.slice(0, 24)).length
    // ROBUST measure. paneCentreSig returns the centre LINE'S OPENING 60 chars (all chars on a line
    // share a rect top, so its binary search converges on the line's first char). When the anchor
    // word sits MID-line — which wrapping alone decides, and wrapping differs between versions of
    // different length — the anchor IS under the reading line but the line OPENS on other words, and
    // strict equality scores it a miss. So also ask the question the reader actually cares about:
    // is the anchor text present on the centre line at all?
    const tok = (s) => s.slice(0, 16)
    const anchored = withWant.filter((e) => e.sig.includes(tok(e.want))).length
    return { versionsPrimed: tr.length, blankSigs: blank, steps, held: same,
      holdRate: steps ? +(same / steps).toFixed(2) : -1, modes,
      landRate: withWant.length ? +(landed / withWant.length).toFixed(2) : -1, landN: withWant.length,
      anchorOnCentreLine: withWant.length ? +(anchored / withWant.length).toFixed(2) : -1,
      // Did our priming SURVIVE? lateMoved = the centre content changed after we primed it.
      // DRIFT — px between the anchor text and the reading line, per version. The real measure.
      driftAbs: (() => {
        const d = good.filter((e) => e.driftPx != null).map((e) => Math.abs(e.driftPx)).sort((a, b) => a - b)
        if (!d.length) return null
        return { n: d.length, p50: d[Math.floor(d.length / 2)], max: d[d.length - 1], within8px: +(d.filter((x) => x <= 8).length / d.length).toFixed(2) }
      })(),
      noCounterpart: good.filter((e) => e.driftPx == null).length,
      // The rule runs in the warm layer's own deferred pagination task (idle, beside a 130-270ms
      // paginate and a 300ms+ raster) — never on the input path. Cost it anyway.
      anchorCostMs: cost.length ? { p50: +cost[Math.floor(cost.length / 2)].toFixed(1), max: +cost[cost.length - 1].toFixed(1) } : null,
      rows: good.slice(0, 4).map((e) => ({ id: e.id, m: e.mode, top: e.top, drift: e.driftPx, want: e.want.slice(0, 24), got: e.sig.slice(0, 24) })) }
  })
  await browser.close()
  return { label, rule: rule || 'content(new)', lineMode, ...out, pageerrors: errs.length }
}

const rows = []
rows.push(await cell('A KNOWN-NEGATIVE (old raw-scrollTop rule)', { rule: 'scrolltop', lineMode: 'center' }))
rows.push(await cell('B FIX — center mode', { rule: null, lineMode: 'center' }))
rows.push(await cell('C FIX — longest mode (production default)', { rule: null, lineMode: 'longest' }))
for (const r of rows) console.log(JSON.stringify(r))
const A = rows[0], B = rows[1]
console.log('\nINSTRUMENT:', A.holdRate >= 0 && A.holdRate < 0.6
  ? `✅ sees the known-negative (old rule holds ${A.holdRate} over ${A.steps} steps)`
  : `❌ CANNOT see the known-negative (${A.holdRate}) — B/C are worthless`)
console.log('VERDICT  :', `strict line-open hold: old ${A.holdRate} → fixed ${B.holdRate} (center, ${B.steps} steps, ${B.blankSigs} blank)`)
console.log('ROBUST   :', `anchor under the reading line: old ${A.anchorOnCentreLine} → fixed ${B.anchorOnCentreLine} (n=${B.landN})`)
const d = (r) => r.driftAbs ? `p50 ${r.driftAbs.p50}px / max ${r.driftAbs.max}px / within8px ${r.driftAbs.within8px} (n=${r.driftAbs.n})` : 'n/a'
console.log('DRIFT    :', `old  ${d(A)}`)
console.log('DRIFT    :', `fix  ${d(B)}`)
