// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE PDF ZOOM SNAP-BACK — DOES IT REPRODUCE, AND DOES THE SHIPPED FIX REMOVE IT?
//
// Peter: "there's also an unpleasant quirk when you zoom the pdf where it goes towards the cursor
// then flashes back centrally after you finish zooming. I think what we need is to just zoom to
// cursor."  (Feature: the PDF reader's Ctrl/⌘+wheel zoom. LIVE — no flag.)
//
// A fix shipped on 2026-08-28 (PdfViewer.tsx, the zoom-settle handler) marked STATED, NOT PROVED:
// it re-asserts the scroll anchor after the visible pages paint and again next frame, on the theory
// that `scrollLeft` is clamped to a STALE scroll range one layout too early. That theory has never
// been reproduced. This probe exists to decide it.
//
// WHAT IT MEASURES — the thing Peter SEES, as a TRAJECTORY, not a before/after pair.
// "Goes towards the cursor then flashes back" is a claim about motion. So: fix a content point
// under the cursor at gesture start as a FRACTION of the page box —
//     f = (cursorX - pageRect.left) / pageRect.width
// — and then, every animation frame from before the first notch to well after the settle, ask where
// that same content point is now painting:
//     err(t) = pageRect.left(t) + f * pageRect.width(t) - cursorX
// Perfect zoom-to-cursor ⇒ err ≡ 0 at every instant. The fraction rides the page's own box, so it
// is agnostic to CSS transform, scroll position, canvas size and re-render — exactly what a
// measurement of "where did the words go" has to be.
//
// It also records, per frame, whether the FREEZE OVERLAY is up. The overlay is a fixed still of the
// pre-teardown view, so what the user sees during it is the frozen value, not the live DOM. The
// "flash" is the frame the overlay lifts, which is why the sample must be continuous.
//
// AND IT INSTRUMENTS EVERY scrollLeft WRITE on the scroller (want / got / range-at-that-moment).
// That is the direct test of the shipped hypothesis: a clamp is `got < want` with `want > max`.
//
// KNOWN-NEGATIVE, in the SAME build: `window.__iwPdfZoomAnchor = 'legacy'` restores the pre-fix
// code verbatim (one anchor write, before the visible pages paint). Cell A must reproduce Peter's
// symptom or nothing may be read from cell B.
//
// TWO HARNESS TRAPS this repo has already paid for (scripts/textrender-probe/reader.prove.mjs):
//   · Inkwave registers a service worker that answers from its own cache, and page.route does not
//     intercept it → `serviceWorkers: 'block'`.
//   · `page.mouse.wheel` does NOT carry a modifier held with keyboard.down('Control'), so a
//     "ctrl+wheel" driven that way is an ordinary scroll and the zoom never moves. The WheelEvent is
//     dispatched here by hand with ctrlKey:true.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { chromium } from '@playwright/test'
import { startProbeServer } from '../textrender-probe/serve.mjs'
import { makePdf } from './fixture.mjs'

const EDITOR = '.ProseMirror[contenteditable="true"]'
const CITEKEY = 'fix2026'
const NOTCHES = 6           // ctrl+wheel notches, zooming IN
const NOTCH_MS = 55         // spacing — well inside the 170ms settle window, so it is ONE gesture
const TAIL_MS = 2600        // sample well past settle + render + unfreeze

let fail = 0
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra ? ' — ' + extra : ''}`)
  if (!ok) fail++
}

const { base, stop } = await startProbeServer()
const browser = await chromium.launch({ headless: true })
const pdfB64 = Buffer.from(makePdf({ pages: 6 })).toString('base64')

/** Seed a document + per-document library + the PDF bytes through the REAL OPFS paths. */
async function seed(page, docId, b64) {
  return page.evaluate(async ({ id, b64, key }) => {
    const item = {
      id: key, type: 'article-journal', title: 'A Generated Fixture',
      author: [{ family: 'Fixture', given: 'A' }], issued: { 'date-parts': [[2026]] },
      _iw: { pdfName: 'fixture.pdf' },
    }
    const doc = {
      id, title: 'PDF zoom probe', createdAt: new Date().toISOString(), schemaVersion: '1',
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body.' }] }] },
    }
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    try {
      const root = await navigator.storage.getDirectory()
      const docs = await root.getDirectoryHandle('documents', { create: true })
      const dir = await docs.getDirectoryHandle(id, { create: true })
      let h = await dir.getFileHandle('current.json', { create: true })
      let w = await h.createWritable(); await w.write(JSON.stringify(doc)); await w.close()
      const lib = await root.getDirectoryHandle('library', { create: true })
      const per = await lib.getDirectoryHandle(id, { create: true })
      h = await per.getFileHandle('citations.json', { create: true })
      w = await h.createWritable(); await w.write(JSON.stringify([item])); await w.close()
      const pdfs = await lib.getDirectoryHandle('pdfs', { create: true })
      h = await pdfs.getFileHandle(encodeURIComponent(key) + '.pdf', { create: true })
      w = await h.createWritable(); await w.write(bin); await w.close()
    } catch (e) { return 'opfs: ' + e.message }
    return 'ok'
  }, { id: docId, b64, key: CITEKEY })
}

/**
 * ONE CELL: open the PDF, arm the recorder, drive a real ctrl+wheel zoom, return the trajectory.
 * @param {'fixed'|'legacy'} rule
 */
async function runCell(rule) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))

  // The rule must be set BEFORE the component mounts — it is read inside the settle handler, but an
  // init script is the only way to be certain no earlier code path saw the other value.
  await page.addInitScript((r) => { window.__iwPdfZoomAnchor = r }, rule)

  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(EDITOR, { timeout: 60000 })
  await page.waitForTimeout(1500)
  const docId = 'pdfzoom-' + rule
  const seeded = await seed(page, docId, pdfB64)
  if (seeded !== 'ok') throw new Error('seed failed: ' + seeded)

  await page.goto(`${base}/?doc=${docId}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(EDITOR, { timeout: 60000 })
  await page.waitForTimeout(2000)

  await page.evaluate((key) => window.dispatchEvent(new CustomEvent('inkwave:open-pdf', { detail: { citekey: key, page: 1, label: key } })), CITEKEY)
  await page.waitForSelector('.pdfViewer .page[data-idx="0"] canvas', { timeout: 30000 })
  await page.waitForTimeout(2500) // let the open-time fit/scroll settle chain finish completely

  // Assert the SERVED bundle carries the seam we are A/B-ing — after the PDF is open, so the
  // dynamically-imported viewer chunk is in the resource list. A `script[src]` scan sees only the
  // entry chunks and reports a false "missing", which reads as the bug being absent.
  const seamPresent = await page.evaluate(async () => {
    const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.endsWith('.js'))
    for (const u of urls) {
      try { if ((await (await fetch(u)).text()).includes('__iwPdfZoomAnchor')) return true } catch { /* skip */ }
    }
    return false
  })

  // ── ARM THE RECORDER ──────────────────────────────────────────────────────────────────────────
  const armed = await page.evaluate(() => {
    const viewer = document.querySelector('.pdfViewer')
    const sc = viewer && viewer.parentElement
    const p0 = document.querySelector('.page[data-idx="0"]')
    if (!sc || !p0) return { ok: false, why: 'no scroller/page' }

    const box = sc.getBoundingClientRect()
    // WELL OFF-CENTRE, deliberately: a cursor near the middle makes "zoom to cursor" and "re-centre"
    // give nearly the same answer, so the measurement could not tell them apart.
    const cx = box.left + box.width * 0.22
    const cy = box.top + box.height * 0.5

    const r0 = p0.getBoundingClientRect()
    const f = (cx - r0.left) / r0.width
    // The vertical anchor too — the same rule now drives scrollTop, and shipping the half you did
    // not measure is the thing this whole probe exists to stop. Page 0 is tall enough at the fit
    // scale that the pane's mid-height sits inside it.
    const fV = (cy - r0.top) / r0.height

    // Every scrollLeft write, with the range that existed AT THE MOMENT OF THE WRITE. This is the
    // direct test of the shipped "silently clipped to the OLD maximum" hypothesis.
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollLeft')
    const writes = []
    Object.defineProperty(sc, 'scrollLeft', {
      configurable: true,
      get() { return desc.get.call(this) },
      set(v) {
        const max = this.scrollWidth - this.clientWidth
        desc.set.call(this, v)
        writes.push({ t: performance.now(), want: v, got: desc.get.call(this), max })
      },
    })

    const samples = []
    let running = true
    const overlayUp = () => [...document.body.children].some((el) =>
      el instanceof HTMLElement && el.style.position === 'fixed' && el.style.zIndex === '5' && el.querySelector('canvas'))
    // The transform is READ, never inferred. Inferring the origin from err/scale algebra is exactly
    // the kind of derivation that agrees with whatever model you brought to it.
    const sample = () => {
      const pg = document.querySelector('.page[data-idx="0"]')
      const r = pg && pg.getBoundingClientRect()
      const vs = getComputedStyle(viewer)
      const vr = viewer.getBoundingClientRect()
      return {
        t: performance.now(),
        err: r && r.width ? r.left + f * r.width - cx : null,
        errY: r && r.height ? r.top + fV * r.height - cy : null,
        pageW: r ? r.width : null,
        pageL: r ? r.left : null,
        viewerL: vr.left, viewerPadL: parseFloat(vs.paddingLeft) || 0,
        tf: vs.transform === 'none' ? '' : vs.transform,
        tfo: viewer.style.transformOrigin || '',
        sl: sc.scrollLeft,
        max: sc.scrollWidth - sc.clientWidth,
        frozen: overlayUp(),
        pages: document.querySelectorAll('.page').length,
      }
    }
    const tick = () => { if (!running) return; samples.push(sample()); requestAnimationFrame(tick) }
    requestAnimationFrame(tick)

    const geom = () => {
      const pg = document.querySelector('.page[data-idx="0"]')
      return { cw: sc.clientWidth, sw: sc.scrollWidth, sl: sc.scrollLeft, pageW: pg ? pg.getBoundingClientRect().width : null }
    }
    window.__zoomProbe = {
      cx, cy, f, fV, samples, writes, sample, geom,
      t0: performance.now(),
      stop() { running = false; Object.defineProperty(sc, 'scrollLeft', desc) },
    }
    return { ok: true, cx, cy, f, geom: geom() }
  })
  if (!armed.ok) throw new Error('arm failed: ' + armed.why)

  // ── THE GESTURE ───────────────────────────────────────────────────────────────────────────────
  // Hand-built WheelEvent with ctrlKey — page.mouse.wheel drops the modifier.
  const perNotch = []
  for (let i = 0; i < NOTCHES; i++) {
    perNotch.push(await page.evaluate(() => {
      const p = window.__zoomProbe
      const before = p.sample()
      const el = document.elementFromPoint(p.cx, p.cy)
      const target = document.querySelector('.pdfViewer').parentElement
      const ev = new WheelEvent('wheel', {
        bubbles: true, cancelable: true, ctrlKey: true,
        deltaY: -120, deltaMode: 0, clientX: p.cx, clientY: p.cy,
      })
      const accepted = !(el || target).dispatchEvent(ev) // preventDefault ⇒ the app claimed it
      return { before, accepted, hit: el ? el.className || el.tagName : null }
    }))
    await page.waitForTimeout(NOTCH_MS)
  }
  await page.waitForTimeout(TAIL_MS)

  const out = await page.evaluate(() => {
    const p = window.__zoomProbe
    p.stop()
    return { samples: p.samples, writes: p.writes, t0: p.t0, geomEnd: p.geom() }
  })
  await ctx.close()
  return { rule, seamPresent, armed, perNotch, ...out, pageErrors: errs }
}

// ── REPORTING ───────────────────────────────────────────────────────────────────────────────────
const fmt = (n) => (n == null ? '  null' : n.toFixed(1).padStart(7))

function analyse(cell) {
  const s = cell.samples.filter((x) => x.err != null)
  const t0 = cell.samples.length ? cell.samples[0].t : 0
  const rel = (x) => x.t - t0

  // The gesture window: while the CSS transform is live, i.e. before the first freeze frame.
  const firstFrozen = cell.samples.findIndex((x) => x.frozen)
  const lastFrozen = cell.samples.map((x) => x.frozen).lastIndexOf(true)
  const gesture = firstFrozen > 0 ? s.filter((x) => x.t < cell.samples[firstFrozen].t) : []
  const after = lastFrozen >= 0 ? s.filter((x) => x.t > cell.samples[lastFrozen].t) : s.slice(-30)

  const peakDuring = gesture.length ? gesture[gesture.length - 1].err : null   // where the gesture LEFT it
  const settled = after.length ? after[after.length - 1].err : null            // where it ENDED UP
  const maxAbsAfter = after.length ? Math.max(...after.map((x) => Math.abs(x.err))) : null
  const maxDuring = gesture.length ? Math.max(...gesture.map((x) => Math.abs(x.err))) : null
  const vAfter = after.filter((x) => x.errY != null)
  const settledY = vAfter.length ? vAfter[vAfter.length - 1].errY : null
  const peakDuringY = (() => { const g = gesture.filter((x) => x.errY != null); return g.length ? g[g.length - 1].errY : null })()
  const snapY = peakDuringY != null && settledY != null ? settledY - peakDuringY : null
  // THE SNAP itself: the discontinuity across the freeze. What the writer sees is the frozen still
  // (the gesture's last state) replaced in one frame by the settled layout.
  const snap = peakDuring != null && settled != null ? settled - peakDuring : null

  const clamped = cell.writes.filter((w) => w.want > w.max + 0.5 && w.got < w.want - 0.5)
  return { s, rel, firstFrozen, lastFrozen, gesture, after, peakDuring, settled, maxAbsAfter, maxDuring, snap, settledY, snapY, clamped }
}

function report(cell) {
  const a = analyse(cell)
  console.log(`\n── CELL "${cell.rule}" ${'─'.repeat(60)}`)
  console.log(`   seam present in served bundle: ${cell.seamPresent}`)
  console.log(`   cursor at x=${cell.armed.cx.toFixed(0)}, page fraction f=${cell.armed.f.toFixed(4)}`)
  console.log(`   scroller ${cell.armed.geom.cw}px · page ${cell.armed.geom.pageW.toFixed(0)}px → ${cell.geomEnd.pageW.toFixed(0)}px`)
  console.log(`   frames ${cell.samples.length}, freeze frames ${cell.samples.filter((x) => x.frozen).length}`)
  if (cell.pageErrors.length) console.log('   page errors:', cell.pageErrors.slice(0, 3))

  console.log('\n   PER NOTCH (state sampled synchronously BEFORE each wheel is dispatched)')
  console.log('      #  accepted     err   pageW  padL  transform-origin        transform')
  cell.perNotch.forEach((n, i) => {
    console.log(`      ${i}  ${String(n.accepted).padEnd(8)} ${fmt(n.before.err)} ${fmt(n.before.pageW)} ${String(n.before.viewerPadL).padStart(5)}  ${(n.before.tfo || '—').padEnd(22)} ${n.before.tf || '—'}`)
  })

  console.log('\n   TRAJECTORY (err = px the content under the cursor has slid away from it)')
  console.log('      t(ms)     err   pageW      sl     max  frozen')
  // Sample the trajectory readably: every frame near the transitions, thinned in the flat stretches.
  const marks = new Set()
  cell.samples.forEach((x, i) => {
    const prev = cell.samples[i - 1]
    if (i === 0 || i === cell.samples.length - 1) marks.add(i)
    if (prev && prev.frozen !== x.frozen) { marks.add(i - 1); marks.add(i) }
    if (prev && x.err != null && prev.err != null && Math.abs(x.err - prev.err) > 4) { marks.add(i - 1); marks.add(i) }
    if (prev && (x.pages !== prev.pages)) { marks.add(i - 1); marks.add(i) }
  })
  const idx = [...marks].sort((p, q) => p - q)
  let last = -99
  for (const i of idx) {
    if (i - last < 1) continue
    last = i
    const x = cell.samples[i]
    console.log(`   ${a.rel(x).toFixed(0).padStart(7)} ${fmt(x.err)} ${fmt(x.pageW)} ${fmt(x.sl)} ${fmt(x.max)}   ${x.frozen ? 'FROZEN' : ''}`)
  }

  console.log('\n   scrollLeft WRITES (want → got, against the range at that instant)')
  for (const w of cell.writes.slice(0, 14)) {
    const clip = w.want > w.max + 0.5 && w.got < w.want - 0.5
    console.log(`   ${(w.t - cell.samples[0].t).toFixed(0).padStart(7)}  want ${w.want.toFixed(1).padStart(8)}  got ${w.got.toFixed(1).padStart(8)}  max ${w.max.toFixed(1).padStart(8)}${clip ? '   ← CLAMPED' : ''}`)
  }
  if (cell.writes.length > 14) console.log(`   … ${cell.writes.length - 14} more`)

  console.log(`\n   worst |err| DURING the gesture: ${a.maxDuring == null ? 'n/a' : a.maxDuring.toFixed(1) + 'px'}`)
  console.log(`   err where the GESTURE left it : ${a.peakDuring == null ? 'n/a' : a.peakDuring.toFixed(1) + 'px'}`)
  console.log(`   err where it SETTLED          : ${a.settled == null ? 'n/a' : a.settled.toFixed(1) + 'px'}`)
  console.log(`   THE SNAP across the freeze    : ${a.snap == null ? 'n/a' : a.snap.toFixed(1) + 'px'}`)
  console.log(`   VERTICAL — settled ${a.settledY == null ? 'n/a' : a.settledY.toFixed(1) + 'px'}, snap ${a.snapY == null ? 'n/a' : a.snapY.toFixed(1) + 'px'}`)
  console.log(`   clamped scrollLeft writes     : ${a.clamped.length}`)
  return a
}

try {
  console.log('\nPDF ZOOM — "goes towards the cursor then flashes back centrally"')
  console.log('Cell A = legacy (pre-fix) · Cell B = shipped fix. A must reproduce or B proves nothing.\n')

  const legacy = await runCell('legacy')
  const fixed = await runCell('fixed')
  const A = report(legacy)
  const B = report(fixed)

  console.log(`\n${'═'.repeat(96)}\nVERDICT\n`)

  check(legacy.seamPresent && fixed.seamPresent, 'the served bundle carries the A/B seam (not a stale build)')

  // The gesture must actually zoom, or every number below is about nothing.
  const zoomedA = legacy.geomEnd.pageW > legacy.armed.geom.pageW * 1.2
  const zoomedB = fixed.geomEnd.pageW > fixed.armed.geom.pageW * 1.2
  check(zoomedA && zoomedB, 'the ctrl+wheel gesture actually zoomed both cells',
    `${legacy.armed.geom.pageW.toFixed(0)}→${legacy.geomEnd.pageW.toFixed(0)} / ${fixed.armed.geom.pageW.toFixed(0)}→${fixed.geomEnd.pageW.toFixed(0)}`)
  const readable = legacy.seamPresent && fixed.seamPresent && zoomedA && zoomedB
  if (!readable) {
    console.log('\n  ⚠ VOID — the instrument did not observe a zoom, so nothing below may be read.')
  } else {
    // ── CELL A IS THE CONTROL ────────────────────────────────────────────────────────────────────
    // ⚠ THIS CHECK WAS RE-WRITTEN AFTER THE FIRST RUN, and the reason is the finding. It originally
    // demanded that the CONTROL track the cursor DURING the gesture — reading Peter's "goes towards
    // the cursor" as a report that the preview phase was correct. It is not: the control drifts
    // 198→319px across the gesture. Scoring a control against what you assumed rather than what it
    // does is how a probe ends up certifying the wrong half.
    const aDrifts = A.maxDuring != null && A.maxDuring > 100
    const aSnaps = A.snap != null && Math.abs(A.snap) > 40
    check(aDrifts, 'CONTROL: the content drifts away from the cursor DURING the gesture',
      A.maxDuring == null ? 'n/a' : A.maxDuring.toFixed(1) + 'px')
    check(aSnaps, 'CONTROL REPRODUCES THE SNAP: a one-frame jump when the freeze lifts',
      A.snap == null ? 'n/a' : A.snap.toFixed(1) + 'px')

    if (!aSnaps) {
      console.log('\n  ⇒ THE PRE-FIX BEHAVIOUR DOES NOT REPRODUCE HERE. Cell B cannot be read as a fix.')
    } else {
      check(B.maxDuring != null && B.maxDuring < 8, 'FIXED: the content holds the cursor THROUGHOUT the gesture',
        `${B.maxDuring == null ? 'n/a' : B.maxDuring.toFixed(1)}px (control ${A.maxDuring.toFixed(1)}px)`)
      check(Math.abs(B.settled) < 8, 'FIXED: and it settles under the cursor',
        `${Math.abs(B.settled).toFixed(1)}px (control ${Math.abs(A.settled).toFixed(1)}px)`)
      check(Math.abs(B.snap) < 8, 'FIXED: no snap when the freeze lifts',
        `${B.snap.toFixed(1)}px (control ${A.snap.toFixed(1)}px)`)
      // The VERTICAL axis takes the same new rule, so it is measured, not assumed. It is not where
      // Peter's complaint lives (the gutter is horizontal) — but the page-to-page 12px margins are
      // constants of exactly the same kind, so the control drifts here too.
      check(B.settledY != null && Math.abs(B.settledY) < 8, 'FIXED: vertical settles under the cursor too',
        `${B.settledY == null ? 'n/a' : B.settledY.toFixed(1)}px (control ${A.settledY == null ? 'n/a' : A.settledY.toFixed(1)}px)`)
    }

    // ── MECHANISM 1: the SHIPPED hypothesis (2026-08-28), tested directly ───────────────────────
    console.log(`\n  MECHANISM A — the shipped claim: "scrollLeft is CLAMPED … to the OLD maximum"`)
    console.log(`    clamped writes (want > range AND got < want) — legacy ${A.clamped.length} · fixed ${B.clamped.length}`)
    check(A.clamped.length === 0,
      'REFUTED: no scrollLeft write was ever clipped by a stale range — the range was already large',
      `legacy wrote ${legacy.writes[0] ? `want ${legacy.writes[0].want.toFixed(1)} into a range of ${legacy.writes[0].max.toFixed(1)}` : 'nothing'}`)

    // ── MECHANISM 2: the measured one — a layout CONSTANT multiplied by the zoom ratio ──────────
    // The 180px overscroll gutter appears the instant zoom crosses 1.02. Prediction, in closed form:
    //   during the gesture, err = GUTTER × liveScale        (the transform scales a shifted layout)
    //   at the settle,     err = (padScroller + GUTTER) − padScroller × ratio
    const GUTTER = 180, PAD = 12
    const notchPred = legacy.perNotch.slice(1).map((n) => {
      const m = /matrix\(([\d.]+)/.exec(n.before.tf || '')
      return m ? { scale: +m[1], want: GUTTER * +m[1], got: n.before.err } : null
    }).filter(Boolean)
    console.log(`\n  MECHANISM B — a LAYOUT CONSTANT scaled by the zoom (the 180px overscroll gutter)`)
    console.log('    during the gesture, predicted err = 180 × liveScale:')
    for (const p of notchPred) console.log(`      scale ${p.scale.toFixed(4)}  predicted ${p.want.toFixed(1)}  measured ${p.got.toFixed(1)}`)
    const notchFits = notchPred.length >= 3 && notchPred.every((p) => Math.abs(p.want - p.got) < 1.5)
    check(notchFits, 'the in-gesture drift IS 180 × the live scale, to the pixel', `${notchPred.length} notches`)

    const R = legacy.geomEnd.pageW / legacy.armed.geom.pageW
    const settlePred = (PAD + GUTTER) - PAD * R
    console.log(`\n    at the settle, predicted err = (12 + 180) − 12 × ${R.toFixed(4)} = ${settlePred.toFixed(1)}`)
    check(Math.abs(settlePred - A.settled) < 1.5, 'the settled error IS that closed form, to the pixel',
      `predicted ${settlePred.toFixed(1)} · measured ${A.settled.toFixed(1)}`)

    // ── The third anchor application is load-bearing, not decoration ────────────────────────────
    // The gutter arrives with React's commit, one layout AFTER the first two applications — so the
    // rAF re-application must move the scroll by ~GUTTER, or the fix would land 180px short.
    const wants = [...new Set(fixed.writes.map((w) => Math.round(w.want)))]
    const spread = wants.length > 1 ? Math.max(...wants) - Math.min(...wants) : 0
    check(Math.abs(spread - GUTTER) < 6,
      'the post-commit re-application is load-bearing (it moves the scroll by the gutter)',
      `wanted ${wants.join(' → ')} (spread ${spread})`)
  }
} catch (e) {
  console.log('  ✗ THREW:', e.message)
  fail++
} finally {
  await browser.close()
  await stop()
}
console.log(fail ? `\nFAIL (${fail})` : '\nPASS')
process.exitCode = fail ? 1 : 0
