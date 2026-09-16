// PETER-SCALE REPRO — 742 words / 116 snapshots (his recorded burst), not the 20k/36 fixture.
// His device reported doc centre-held 0% of 33 while the harness measured drift p50 0px. Either
// the fix does not engage at this scale, or the centre-held metric is worthless. Settle it with
// the SAME discipline: the OLD rule (__iwAnchorRule='scrolltop') must reproduce its drift before
// any verdict on the fix is read.
import { chromium } from '@playwright/test'
import { readFile } from 'node:fs/promises'
const PORT = process.env.PROBE_PORT || 4291, BASE = `http://127.0.0.1:${PORT}`
const IDLE_S = Number(process.env.PROBE_IDLE_S || 60)
const WORDS = Number(process.env.DOC_WORDS || 742)
const NSNAPS = Number(process.env.DOC_SNAPS || 116)

function buildSnapshots(totalWords, nSnaps) {
  let s = 42
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  const BASE_W = ('philosophy leibniz universal language calculus ratiocinator characteristica argument thesis ' +
    'chapter section evidence claims analysis synthesis method critique framework ontology epistemology ' +
    'reason judgment perception substance monad harmony preestablished contingent necessary truth predicate').split(/\s+/)
  const VOCAB = []
  for (let i = 0; i < 600; i++) VOCAB.push(BASE_W[i % BASE_W.length] + (i >= BASE_W.length ? i.toString(36) : ''))
  const para = (n) => { const o = []; for (let i = 0; i < n; i++) o.push(VOCAB[Math.floor(rnd() * VOCAB.length)]); return o.join(' ') + '.' }
  const paras = []
  for (let i = 0; i < Math.max(1, Math.round(totalWords / 30)); i++) paras.push(para(30))
  const docId = 'probe-doc-scrub'
  const snaps = []
  const t0 = Date.now() - nSnaps * 3600 * 1000
  for (let v = 0; v < nSnaps; v++) {
    // One resolved kick per snapshot: ~4 words, local — on a 742w doc every edit is near the anchor.
    const pi = Math.floor(rnd() * paras.length)
    const ws = paras[pi].split(' ')
    const at = Math.floor(rnd() * Math.max(1, ws.length - 4))
    for (let e = 0; e < 4; e++) ws[Math.min(ws.length - 1, at + e)] = VOCAB[Math.floor(rnd() * VOCAB.length)]
    paras[pi] = ws.join(' ')
    snaps.push({
      id: `snap-${String(v).padStart(3, '0')}`, documentId: docId,
      createdAt: new Date(t0 + v * 3600 * 1000).toISOString(),
      trigger: v % 12 === 0 ? 'manual' : 'word-nudge',
      wordCount: paras.join(' ').split(/\s+/).length,
      contentHash: 'probe-' + v, bundleHash: 'probe-' + v, ots: { status: 'unstamped' },
      contentJson: { type: 'doc', content: paras.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) },
    })
  }
  return JSON.stringify(snaps)
}
const tsrc = await readFile(new URL('./probe-thumbs.mjs', import.meta.url), 'utf8')
const realOpfsShim = eval('(' + tsrc.slice(tsrc.indexOf('(json) => {'), tsrc.indexOf('const med =')).trim().replace(/;\s*$/, '') + ')')
const SEED = buildSnapshots(WORDS, NSNAPS)
const MID = `snap-${String(Math.floor(NSNAPS / 2)).padStart(3, '0')}`

const cell = async (label, { rule }) => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))
  await page.addInitScript(realOpfsShim, SEED)
  await page.addInitScript((r) => { window.__iwAnchorTrace = []; window.__iwPerf = []; if (r) window.__iwAnchorRule = r }, rule)
  await page.goto(`${BASE}/snapshot?doc=probe-doc-scrub&snap=${MID}&snapThumbs=debug`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.iw-snap-layer-active .tiptap-editor', { timeout: 30000 })
  await page.waitForTimeout(3000)
  const geom = await page.evaluate(() => {
    const L = document.querySelector('.iw-snap-layer-active .iw-snap-scroll')
    return { scrollHeight: L.scrollHeight, clientHeight: L.clientHeight, scrollTop: L.scrollTop, maxScroll: L.scrollHeight - L.clientHeight }
  })
  await page.waitForTimeout(IDLE_S * 1000)
  const out = await page.evaluate(() => {
    const tr = window.__iwAnchorTrace
    const modes = {}
    for (const [l] of window.__iwPerf) if (l.startsWith('scrub.anchor.')) { const k = l.replace('scrub.anchor.', ''); modes[k] = (modes[k] || 0) + 1 }
    const good = tr.filter((e) => e.sig && e.sig.length >= 8)
    let same = 0, steps = 0
    for (let i = 1; i < good.length; i++) { if (good[i].id === good[i - 1].id) continue; steps++; if (good[i].sig === good[i - 1].sig) same++ }
    const d = good.filter((e) => e.driftPx != null).map((e) => Math.abs(e.driftPx)).sort((a, b) => a - b)
    return {
      versionsPrimed: tr.length, blankSigs: tr.length - good.length, modes,
      centreHeld: steps ? +(same / steps).toFixed(2) : -1, centreSteps: steps,
      drift: d.length ? { n: d.length, p50: d[Math.floor(d.length / 2)], max: d[d.length - 1], within8px: +(d.filter((x) => x <= 8).length / d.length).toFixed(2) } : null,
      noCounterpart: good.filter((e) => e.driftPx == null).length,
      rows: good.slice(0, 3).map((e) => ({ id: e.id, m: e.mode, top: e.top, drift: e.driftPx, want: e.want.slice(0, 22), got: e.sig.slice(0, 22) })),
    }
  })
  await browser.close()
  return { label, ...out, geom, pageerrors: errs.length }
}
const A = await cell('A KNOWN-NEGATIVE (old raw-scrollTop rule)', { rule: 'scrolltop' })
const B = await cell('B FIX (content anchor)', { rule: null })
for (const r of [A, B]) console.log(JSON.stringify(r))
const dd = (r) => r.drift ? `p50 ${r.drift.p50}px / max ${r.drift.max}px / within8px ${r.drift.within8px} (n=${r.drift.n})` : 'n/a'
console.log(`\nFIXTURE  : ${WORDS}w / ${NSNAPS} snaps — doc ${A.geom.scrollHeight}px, viewport ${A.geom.clientHeight}px, maxScroll ${A.geom.maxScroll}px`)
console.log('INSTRUMENT:', A.drift && A.drift.p50 > 8 ? `✅ sees the known-negative (old rule drift p50 ${A.drift.p50}px)` : `❌ CANNOT see the known-negative (drift ${A.drift && A.drift.p50}px) — B is worthless`)
console.log('DRIFT    :', `old ${dd(A)}`)
console.log('DRIFT    :', `fix ${dd(B)}`)
console.log('CENTRE-HELD (the on-device headline):', `old ${A.centreHeld} (${A.centreSteps} steps) → fix ${B.centreHeld} (${B.centreSteps} steps)`)
