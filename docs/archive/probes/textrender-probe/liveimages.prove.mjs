// DO IMAGES LOAD IN THE READER'S LIVE (IFRAME) MODE?
//
// Peter: "sometimes pictures aren't displaying." I removed `referrerPolicy="no-referrer"` from the
// iframe as a plausible cause — many image CDNs use the referer for hotlink protection — and shipped
// that STATED, NOT PROVED. This is the check I owed.
//
// ⚠ THE FIRST THING TO ESTABLISH IS WHETHER OUR CSP CAN EVEN BE INVOLVED, because that is the
// intuition everyone reaches for and it is wrong: a cross-origin framed document's subresources are
// governed by ITS OWN policy, not by ours. So the probe reads BOTH — the images inside the frame
// (via the network, which we can observe even though the DOM is sealed) and any CSP violation our
// own page reports. If our page reports none and the frame's images 200, the answer is that we were
// never the cause.
//
// It does NOT claim to reproduce Peter's case. He saw it on particular pages; this measures whether
// the mechanism is present at all on image-heavy ones. A clean result narrows the search rather than
// closing it, and the probe says so rather than declaring the bug fixed.
// ⚠ THE HOST PAGE MUST HAVE NO CSP OF ITS OWN. The first cut framed from the probe server, which
// serves the built app WITHOUT middleware.ts — so it has no `frame-src` and its `default-src 'self'`
// blocked the frame outright: zero image requests, which reads exactly like "the images are broken".
// The shipped CSP does allow https framing; that is asserted separately, from the source of the
// header we actually send. Here the only thing that may block anything is the SITE.
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const PAGES = [
  'https://en.wikipedia.org/wiki/Seed',
  'https://plato.stanford.edu/entries/identity/',
]

const mw = fs.readFileSync(new URL('../../middleware.ts', import.meta.url), 'utf8')
const frameSrcOk = / https: /.test((mw.match(/"frame-src [^"]+"/) || [''])[0])
const b = await chromium.launch({ headless: true })
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' })
const page = await ctx.newPage()
await page.route('https://probe.local/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>host</title>' }))
let fail = 0
const check = (ok, msg, extra = '') => { console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra ? ' — ' + extra : ''}`); if (!ok) fail++ }

const csp = []
page.on('console', (m) => { const t = m.text(); if (/Content Security Policy/i.test(t)) csp.push(t.slice(0, 160)) })

try {
  check(frameSrcOk, 'the SHIPPED csp permits https framing (read from middleware.ts)')
  await page.goto('https://probe.local/', { waitUntil: 'domcontentloaded' })

  for (const url of PAGES) {
    const host = new URL(url).host
    const imgs = { ok: 0, bad: 0, codes: {} }
    const onResp = (r) => {
      if (r.request().resourceType() !== 'image') return
      const s = r.status()
      imgs.codes[s] = (imgs.codes[s] || 0) + 1
      if (s >= 200 && s < 400) imgs.ok++; else imgs.bad++
    }
    const onFail = (r) => { if (r.resourceType() === 'image') imgs.bad++ }
    page.on('response', onResp)
    page.on('requestfailed', onFail)

    // Frame the page exactly as the reader's live mode does — same sandbox, same allow list, and
    // NO referrerPolicy override (the change under test).
    await page.evaluate(async (u) => {
      document.getElementById('liveprobe')?.remove()
      const f = document.createElement('iframe')
      f.id = 'liveprobe'
      f.sandbox = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation'
      f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen'
      f.style.cssText = 'position:fixed;left:0;top:0;width:1200px;height:800px;z-index:9999;background:#fff'
      const done = new Promise((res) => { f.onload = () => res(1); setTimeout(() => res(0), 25000) })
      f.src = u
      document.body.appendChild(f)
      await done
    }, url)
    await page.waitForTimeout(6000)   // lazy images below the fold need a beat
    page.off('response', onResp)
    page.off('requestfailed', onFail)
    await page.evaluate(() => document.getElementById('liveprobe')?.remove())

    const total = imgs.ok + imgs.bad
    console.log(`\n${host}`)
    console.log(`  image requests: ${total}  (ok ${imgs.ok}, failed ${imgs.bad})  status codes: ${JSON.stringify(imgs.codes)}`)
    check(total > 0, `${host}: the framed page requested images at all`, `${total}`)
    check(imgs.bad === 0, `${host}: no image request failed`, imgs.bad ? `${imgs.bad} failed` : '')
  }

  console.log('')
  check(csp.length === 0, 'our own page reported NO CSP violation for the framed content',
    csp.length ? csp[0] : 'a cross-origin frame’s subresources are governed by ITS policy, not ours')
} catch (e) {
  console.log(`  ✗ ${e.message}`); fail++
} finally { await b.close() }

console.log(fail
  ? `\nFAIL (${fail}) — a real mechanism is present; investigate the failing statuses above.`
  : '\nPASS — images load in live mode on these pages. This NARROWS the search; it does not close it: Peter saw it on particular sites, and a clean result here only rules out a general mechanism.')
process.exitCode = fail ? 1 : 0
