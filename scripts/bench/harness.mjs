// ─────────────────────────────────────────────────────────────────────────────
// Keystroke-latency benchmark harness (HONEST, one identical method for every editor).
//
// Metric: KEYDOWN → the paint frame that reflects the change.
//   - An in-page keydown listener stamps t0 = performance.now() (independent of Playwright
//     dispatch latency — pure browser time).
//   - A requestAnimationFrame poll reads a per-editor CONTENT SIGNATURE each frame; the first
//     frame whose signature differs from the pre-keystroke baseline is the paint frame → t1.
//   - delta = t1 - t0. Same loop for all editors; only the signature reader differs
//     (textarea.value.length | region.textContent.length | canvas pixel checksum for Docs).
//   - This adds ~≤1 frame of quantization to EVERY measurement equally (fair for comparison).
//
// Regimes: UNTHROTTLED and 4× CPU throttle (CDP Emulation.setCPUThrottlingRate).
// Sizes:   ~500 words and ~10k words of SYNTHETIC lorem; caret in the MIDDLE (worst case).
// Output:  p50 + p95 over N measured keystrokes (after warm-up), JSON to stdout + a file.
// ─────────────────────────────────────────────────────────────────────────────
import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'

const STATIC = 'http://localhost:8971'
const INKWAVE = 'http://localhost:8972'
const GDOC_URL = 'https://docs.google.com/document/d/1wBB2GW8Bxr4ajPgThaZH-XUYKBUBzKYoZ555cu5pOyo/edit'

// ── synthetic lorem ──────────────────────────────────────────────────────────
const WORDS = ('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor '
  + 'incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation '
  + 'ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure reprehenderit voluptate '
  + 'velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt '
  + 'culpa qui officia deserunt mollit anim id est laborum').split(' ')
function loremParagraphs(totalWords, wordsPerPara = 60) {
  const paras = []
  let w = 0, i = 0
  while (w < totalWords) {
    const n = Math.min(wordsPerPara, totalWords - w)
    const words = []
    for (let k = 0; k < n; k++) words.push(WORDS[(i++) % WORDS.length])
    let s = words.join(' ')
    s = s[0].toUpperCase() + s.slice(1) + '.'
    paras.push(s)
    w += n
  }
  return paras
}
const SIZES = { small: 500, large: 10000 }

// The steady keystroke stream (identical for every editor). Real prose w/ spaces.
const TYPE_STREAM = 'the quick brown fox jumps over the lazy dog and then a few more words appear here '
function keySeq(n) {
  const out = []
  for (let i = 0; i < n; i++) out.push(TYPE_STREAM[i % TYPE_STREAM.length])
  return out
}

// ── the in-page measurement primitive ────────────────────────────────────────
// Arms a one-shot detector: stamps t0 on keydown, resolves delta at the first rAF whose
// signature differs from baseline. `sigKind`: 'sig' (window.__sig()) or 'pixel'.
async function armMeasure(page, timeoutMs) {
  await page.evaluate((timeoutMs) => {
    window.__pending = new Promise((resolve) => {
      const base = window.__sig()
      let t0 = 0
      const onKey = () => { if (t0 === 0) t0 = performance.now() }
      window.addEventListener('keydown', onKey, { capture: true, once: true })
      const start = performance.now()
      const tick = () => {
        if (t0 > 0 && window.__sig() !== base) { resolve(performance.now() - t0); return }
        if (performance.now() - start > timeoutMs) { resolve(NaN); return }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  }, timeoutMs)
}
async function readMeasure(page) { return page.evaluate(() => window.__pending) }

function stats(arr) {
  const v = arr.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  const misses = arr.length - v.length
  if (!v.length) return { p50: null, p95: null, n: 0, misses }
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))]
  return { p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), n: v.length, misses,
           min: +v[0].toFixed(1), max: +v[v.length - 1].toFixed(1) }
}

// Run N warm-up + M measured keystrokes at the current throttle. `interKeyMs` lets each
// keystroke's work drain before the next (steady-state, not pipelined).
async function typeAndMeasure(page, { warm, measure, timeoutMs, interKeyMs }) {
  const keys = keySeq(warm + measure)
  const deltas = []
  for (let i = 0; i < keys.length; i++) {
    await armMeasure(page, timeoutMs)
    await page.keyboard.press(keyToPress(keys[i]))
    const d = await readMeasure(page)
    if (i >= warm) deltas.push(d)
    await page.waitForTimeout(interKeyMs)
  }
  return deltas
}
function keyToPress(ch) { return ch === ' ' ? 'Space' : ch }

// ── editor adapters ──────────────────────────────────────────────────────────
async function setupLocal(page, url, size) {
  await page.goto(url, { waitUntil: 'load' })
  const paras = loremParagraphs(SIZES[size])
  if (url.includes('textarea')) {
    await page.evaluate((paras) => window.__setDoc(paras.join('\n\n')), paras)
  } else {
    await page.evaluate((paras) => window.__setDoc(paras), paras)
  }
  await page.waitForTimeout(300)
}

async function setupInkwave(page, size /* flags seeded on the context before navigate */) {
  await page.goto(INKWAVE + '/', { waitUntil: 'load' })
  await page.waitForSelector('.ProseMirror', { state: 'attached', timeout: 30000 })
  // let the reveal/coast settle
  await page.waitForTimeout(2500)
  // inject synthetic doc via the app's own open-doc path (remounts the editor)
  const paras = loremParagraphs(SIZES[size])
  await page.evaluate((paras) => {
    const id = 'bench-' + Math.random().toString(36).slice(2)
    const content = paras.map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] }))
    const doc = {
      id, title: 'bench', contentJson: { type: 'doc', content },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      schemaVersion: '0.1.0', scasLimitN: 'infinite',
      scasSessionSeed: '00000000-0000-4000-8000-000000000000',
    }
    window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id, doc } }))
  }, paras)
  // wait for the new editor to carry the injected content
  const wantLen = paras.join(' ').length
  await page.waitForFunction((wantLen) => {
    const pm = document.querySelector('.ProseMirror')
    return pm && pm.textContent.length > wantLen * 0.8
  }, wantLen, { timeout: 30000 })
  await page.waitForTimeout(3000) // pagination + reveal settle
  // signature + caret helpers for the live editor
  await page.evaluate(() => {
    window.__region = document.querySelector('.ProseMirror')
    window.__sig = () => window.__region.textContent.length
  })
  // place caret in the MIDDLE paragraph (worst case for pagination) via a real click
  const box = await page.evaluate(() => {
    const ps = document.querySelectorAll('.ProseMirror > p, .ProseMirror p')
    const mid = ps[Math.floor(ps.length / 2)]
    mid.scrollIntoView({ block: 'center' })
    const r = mid.getBoundingClientRect()
    return { x: r.x + Math.min(60, r.width / 2), y: r.y + r.height / 2 }
  })
  await page.mouse.click(box.x, box.y)
  await page.waitForTimeout(400)
}

async function throttle(client, rate) {
  await client.send('Emulation.setCPUThrottlingRate', { rate })
}

// ── main runner ──────────────────────────────────────────────────────────────
const ONLY = process.argv.slice(2) // e.g. "textarea:small:1x" filters; empty = all
function want(tag) { return ONLY.length === 0 || ONLY.some((o) => tag.includes(o)) }

const EDITORS = [
  { key: 'textarea',        kind: 'local', url: STATIC + '/textarea.html' },
  { key: 'contenteditable', kind: 'local', url: STATIC + '/contenteditable.html' },
  { key: 'tiptap',          kind: 'local', url: STATIC + '/tiptap/index.html' },
  // Inkwave ablation rows — flags seeded into localStorage before mount (read at mount).
  { key: 'inkwave-default', kind: 'inkwave', flags: {} },
  { key: 'inkwave-arith',   kind: 'inkwave', flags: { 'inkwave:arithLayout': '1' } },
  { key: 'inkwave-pagoff',  kind: 'inkwave', flags: { 'inkwave:pagOff': '1' } },
  { key: 'inkwave-scasoff', kind: 'inkwave', flags: { 'inkwave:scasEngineOff': '1' } },
  { key: 'inkwave-bothoff', kind: 'inkwave', flags: { 'inkwave:pagOff': '1', 'inkwave:scasEngineOff': '1' } },
]
const REGIMES = [
  { key: '1x', rate: 1, timeoutMs: 3000, interKeyMs: 130 },
  { key: '4x', rate: 4, timeoutMs: 12000, interKeyMs: 300 },
]
const WARM = 8, MEASURE = 60

const results = []
const browser = await chromium.launch({ headless: true })
try {
  for (const ed of EDITORS) {
    for (const size of Object.keys(SIZES)) {
      for (const rg of REGIMES) {
        const tag = `${ed.key}:${size}:${rg.key}`
        if (!want(tag)) continue
        const context = await browser.newContext({ serviceWorkers: 'block' })
        // Seed Inkwave ablation flags into localStorage BEFORE any page script runs.
        if (ed.kind === 'inkwave') {
          await context.addInitScript((flags) => {
            try { for (const [k, v] of Object.entries(flags)) localStorage.setItem(k, v) } catch { /* private */ }
          }, ed.flags || {})
        }
        const page = await context.newPage()
        const client = await context.newCDPSession(page)
        try {
          if (ed.kind === 'local') await setupLocal(page, ed.url, size)
          else await setupInkwave(page, size)
          // sanity: one probe keystroke must move the signature (editor is focused/editable)
          await throttle(client, rg.rate)
          const deltas = await typeAndMeasure(page, {
            warm: WARM, measure: MEASURE, timeoutMs: rg.timeoutMs, interKeyMs: rg.interKeyMs,
          })
          const s = stats(deltas)
          results.push({ editor: ed.key, size, regime: rg.key, ...s })
          console.error(`${tag.padEnd(28)} p50=${s.p50}  p95=${s.p95}  n=${s.n}  miss=${s.misses}`)
        } catch (err) {
          results.push({ editor: ed.key, size, regime: rg.key, error: String(err).slice(0, 200) })
          console.error(`${tag.padEnd(28)} ERROR ${String(err).slice(0, 160)}`)
        } finally {
          await context.close()
        }
      }
    }
  }
} finally {
  await browser.close()
}
writeFileSync('/tmp/bench_results.json', JSON.stringify(results, null, 2))
console.log(JSON.stringify(results, null, 2))
