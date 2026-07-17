// DOES THIS PLATFORM ACTUALLY HAVE WEB LOCKS? — and specifically, does it do the ONE thing
// storage/tabDoc.ts depends on: refuse a second `request(name, {ifAvailable:true})` while a
// live page holds `name`. That refusal is what stops two tabs opening one document and
// blind-autosaving over each other.
//
// WHY IT EXISTS: the no-locks fallback (`if (!locks) return true`) was carried as a STATED
// caveat — "older WebKit may lack Web Locks" — which is exactly the kind of unmeasured claim
// that turns into a feature nobody has ever seen work. Measured instead. All three engines:
// locks=true, refusesSecondTab=true, query()=true.
//
// Usage: node scripts/tabdoc-probe/locks.mjs   (needs a server on :5219)

import { webkit, chromium, firefox } from '@playwright/test'
for (const [name, eng] of [['webkit(≈Safari/iOS)', webkit], ['chromium', chromium], ['firefox', firefox]]) {
  const b = await eng.launch(); const p = await b.newPage()
  await p.goto('http://localhost:5219', { waitUntil: 'domcontentloaded' })
  const r = await p.evaluate(async () => {
    const has = !!(navigator.locks && typeof navigator.locks.request === 'function')
    let works = false, queryable = false
    if (has) {
      try {
        // Can we actually HOLD a lock and see a second request refused? That is what the fix needs.
        await new Promise((res) => {
          navigator.locks.request('probe:x', () => new Promise((release) => {
            navigator.locks.request('probe:x', { ifAvailable: true }, (l) => { works = (l === null); release(); res() })
          }))
        })
        const q = await navigator.locks.query()
        queryable = Array.isArray(q.held)
      } catch (e) { return { has, err: String(e) } }
    }
    return { has, works, queryable, storage: !!navigator.storage?.getDirectory, ua: navigator.userAgent.slice(0, 60) }
  })
  console.log(`${name.padEnd(20)} locks=${r.has}  refusesSecondTab=${r.works}  query()=${r.queryable}  OPFS=${r.storage}`)
  await b.close()
}
