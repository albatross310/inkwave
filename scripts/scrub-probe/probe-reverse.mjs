// THE REVERSAL ACCEPTANCE TEST (Peter's oldest complaint).
// A step consumes SW_STEP(40) of a 120-unit notch, so 80 of debt survives every notch and
// compounds; a reversal then has to pay it off before it moves. Cell A disables the fix
// (__iwWheelDebtFix=false) and MUST reproduce the bug, or cell B proves nothing.
// Reads the COMMANDED index (`want`) — `shown` is the nearest cached bitmap and is blind to this.
import { chromium } from '@playwright/test'
import { readFile } from 'node:fs/promises'
const PORT = process.env.PROBE_PORT || 4291, BASE = `http://127.0.0.1:${PORT}`
const src = await readFile(new URL('./probe.mjs', import.meta.url), 'utf8')
const buildSnapshots = new Function(src.slice(src.indexOf('function buildSnapshots'), src.indexOf('// Runs BEFORE app scripts')) + '; return buildSnapshots()')
const tsrc = await readFile(new URL('./probe-thumbs.mjs', import.meta.url), 'utf8')
const realOpfsShim = eval('(' + tsrc.slice(tsrc.indexOf('(json) => {'), tsrc.indexOf('const med =')).trim().replace(/;\s*$/, '') + ')')
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })

const run = async (fixOn, gesture) => {
  const page = await ctx.newPage()
  await page.addInitScript((on) => { if (!on) window.__iwWheelDebtFix = false }, fixOn)
  await page.addInitScript(realOpfsShim, buildSnapshots())
  await page.goto(`${BASE}/snapshot?doc=probe-doc-scrub&snap=snap-20&snapThumbs=debug`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.iw-snap-layer-active .tiptap-editor', { timeout: 30000 })
  await page.waitForTimeout(3200)
  const r = await page.evaluate(async (g) => {
    const fire = async (d, n, gap) => { for (let i = 0; i < n; i++) { window.dispatchEvent(new WheelEvent('wheel', { deltaY: d, shiftKey: true, bubbles: true, cancelable: true })); await new Promise((r) => setTimeout(r, gap)) } }
    const want = () => window.__iwScrub.record().filter((r) => r.pane === 'doc').map((r) => r.want).filter((v) => v >= 0)
    window.__iwScrub.resetRecord()
    await fire(g.d1, g.n1, 16)
    const phase1 = want()
    const turn = phase1.length ? phase1[phase1.length - 1] : null
    if (g.pauseMs) await new Promise((r) => setTimeout(r, g.pauseMs))
    // Phase 2 gets its OWN window: a non-rapid notch calls resetBurst() and clears the buffer, so
    // slicing across the pause measured a wiped ring, not the driver. The DEBT is a ref and
    // survives both the pause and the reset — which is exactly what is under test.
    window.__iwScrub.resetRecord()
    await fire(g.d2, g.n2, 16)
    await new Promise((r) => setTimeout(r, 700))
    const p2 = want()
    let fwd = 0, back = 0
    for (let i = 1; i < p2.length; i++) { if (p2[i] > p2[i - 1]) fwd++; else if (p2[i] < p2[i - 1]) back++ }
    return { p1_from: phase1[0], p1_to: turn, p2_first: p2[0], p2_last: p2[p2.length - 1], p2_n: p2.length, fwdSteps: fwd, backSteps: back,
      firstNotchMoved: turn != null && p2.length ? p2[0] - turn : null }
  }, gesture)
  await page.close()
  return r
}
const G = { d1: -120, n1: 12, d2: 120, n2: 12, pauseMs: 0 }
const A = await run(false, G), B = await run(true, G)
console.log('A OLD (fix off):', JSON.stringify(A))
console.log('B NEW (fix on) :', JSON.stringify(B))
const travelA = A.p2_last - A.p1_to, travelB = B.p2_last - B.p1_to // from the TURN POINT, not p2's own start
console.log('\nKNOWN-NEGATIVE:', (A.firstNotchMoved <= 0 || A.backSteps > 0) ? `✅ reproduces the bug (first fwd notch moved ${A.firstNotchMoved}, ${A.backSteps} backward steps; turn ${A.p1_to} -> ended ${A.p2_last}, travelled ${travelA} of +12)` : `❌ cannot reproduce — B proves nothing`)
console.log('FIXED        :', travelB > 0 && B.backSteps === 0 ? `✅ travels forward from the turn (${B.p1_to} -> ${B.p2_last} = +${travelB}, 0 backward steps)` : `❌ still wrong (travelled ${travelB}, ${B.backSteps} backward)`)
console.log('FIRST NOTCH  :', B.firstNotchMoved === 1 ? `✅ reverses on the FIRST forward notch (+1, no debt paid off)` : `❌ first notch moved ${B.firstNotchMoved}`)
// ADJACENT GESTURES — a fix that only handles the clean reverse leaves the same class elsewhere.
const P = await run(true, { d1: -120, n1: 12, d2: 120, n2: 6, pauseMs: 1500 })
console.log('PAUSE 1.5s   :', P.backSteps === 0 && P.p2_last > P.p2_first ? `✅ no debt ambush after a 1.5s pause (${P.p2_first} -> ${P.p2_last}, ${P.fwdSteps} fwd / ${P.backSteps} back)` : `❌ debt ambushed the post-pause notch (${P.p2_first} -> ${P.p2_last}, ${P.backSteps} back)`)
const T = await run(true, { d1: -12, n1: 40, d2: 12, n2: 40, pauseMs: 0 })
console.log('TRACKPAD ±12 :', T.fwdSteps > 0 && T.backSteps === 0 ? `✅ fine-delta stream still accumulates + reverses (${T.p2_first} -> ${T.p2_last}, ${T.fwdSteps} fwd / ${T.backSteps} back)` : `❌ trackpad broken (${T.fwdSteps} fwd / ${T.backSteps} back, n=${T.p2_n})`)
await browser.close()
