// EDITOR MOUNTS ONCE — the 2026-07-11 double-mount bug, re-probed for the schema round (2026-07-17).
//
// WHY. The refactor moved the extension list out of `useEditor`'s options literal into a function
// call — inside the editor's construction path, which is EXACTLY the shape of the double-mount bug
// (React.lazy retried render at transition priority; @tiptap/react's in-render editor creation + its
// 1ms scheduleDestroy raced across time slices ⇒ two ~950ms creations and a doubled reveal chain).
// CLAUDE.md: "Editor mounts ONCE per load". Probed, not assumed.
//
// THE INSTRUMENT TOUCHES NO PRODUCT CODE — installed via addInitScript before the app's first byte.
// An in-app counter would be another check derived from the same structure the bug lives in.
//
// ── THREE INSTRUMENT TRAPS, ALL HIT WHILE WRITING THIS, ALL PINNED ──────────────────────────────
// (1) THE COUNTER WAS BLIND AND ITS NEGATIVE STILL FIRED. A childList observer counting inserted
//     `.ProseMirror` nodes reported 0 on a page that plainly had one. @tiptap/react passes
//     `{mount: element}`, so PM does NOT insert a div — it REUSES React's already-attached div and
//     sets `class`/`contenteditable` on it. No node with that class is ever inserted; the counter
//     could never count an editor. Its known-negative passed anyway, because it injected a div that
//     ALREADY carried the class — a path the real editor never takes. A blind instrument with a
//     green negative: CLAUDE.md's "known-negative that scored identically BY CONSTRUCTION".
//     ⇒ Observe ATTRIBUTES, and drive the negative through the real mutation shape.
// (2) THE INIT SCRIPT SILENTLY DIED. At document_start `document.documentElement` is still null, so
//     `observe(document.documentElement)` THREW and aborted the whole script — leaving no observer
//     and no error anyone would look at. ⇒ observe `document`.
// (3) `.ProseMirror` IS NOT THE EDITOR. A load transiently carries TWO such elements: the real
//     editor (contenteditable=true) and an aria-hidden SHELL/skeleton (Edit.tsx's anti-flash shell,
//     no contenteditable) that is removed by ~3s. Counting the class alone reports 2 and would have
//     cried "double mount" on a perfectly healthy load — a false alarm that would have condemned
//     this refactor. ⇒ An editor is `.ProseMirror[contenteditable=true]`; the shell is excluded by a
//     REAL property it never has, not by a name guess.
//
// Usage: pnpm build && pnpm prove:mount   (boots its own server on an ephemeral port)
//    or: PROBE_PORT=<port> node scripts/textrender-probe/mountcount.prove.mjs

import { chromium } from '@playwright/test'
import { startProbeServer } from './serve.mjs'

const { base: BASE, stop } = await startProbeServer()
const RUNS = Number(process.env.RUNS || 5)

// Counts DISTINCT elements that ever were a real PM editor, and (separately) distinct elements that
// ever bore the class at all — the second number is what proves the counter is not blind.
const INSTALL = () => {
  window.__pmEditors = 0   // .ProseMirror[contenteditable=true] — real editors
  window.__pmAnyClass = 0  // .ProseMirror — editors AND the shell
  const seenEd = new Set(), seenAny = new Set()
  const rescan = () => {
    for (const el of document.querySelectorAll('.ProseMirror')) {
      if (!seenAny.has(el)) { seenAny.add(el); window.__pmAnyClass++ }
      if (el.getAttribute('contenteditable') === 'true' && !seenEd.has(el)) { seenEd.add(el); window.__pmEditors++ }
    }
  }
  // `document`, not documentElement — see trap (2).
  new MutationObserver(rescan).observe(document, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'contenteditable'],
  })
  window.__pmRescan = rescan
}

const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })

const runs = []
for (let i = 0; i < RUNS; i++) {
  const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
  await page.addInitScript(INSTALL)
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  // 'attached', not the default 'visible' — the shell is aria-hidden and a visibility wait makes
  // this flaky for reasons unrelated to mounts.
  await page.waitForSelector('.tiptap-editor', { state: 'attached', timeout: 30000 })
  await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
  // Generous: the bug's second creation was a full ~950ms editor.
  await page.waitForTimeout(4000)
  const r = await page.evaluate(() => { window.__pmRescan(); return { editors: window.__pmEditors, anyClass: window.__pmAnyClass } })
  runs.push(r)
  console.log(`run ${i + 1}: real editors mounted = ${r.editors}   (elements bearing .ProseMirror at all = ${r.anyClass})`)
  await page.close()
}

// ── NEGATIVE ARM A: the counter is demonstrably NOT blind ────────────────────────────────────────
// Every load legitimately produces TWO distinct .ProseMirror elements (editor + shell). The counter
// saw both — via attribute mutation on already-attached nodes, the very mechanism the first version
// missed. So `editors === 1` is a FILTERED result, not an artefact of seeing nothing.
const sawBoth = runs.every(r => r.anyClass >= 2)

// ── NEGATIVE ARM B: a second real-shaped editor is still counted ─────────────────────────────────
// Reproduce PM's exact observable signature: attach a div FIRST, then set class + contenteditable on
// the attached node (what `{mount: el}` does). If the counter can't see this, its "1" means nothing.
const page = await b.newPage({ viewport: { width: 1600, height: 1400 } })
await page.addInitScript(INSTALL)
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tiptap-editor', { state: 'attached', timeout: 30000 })
await page.waitForTimeout(4000)
const before = await page.evaluate(() => { window.__pmRescan(); return window.__pmEditors })
await page.evaluate(() => {
  const el = document.createElement('div')
  document.body.appendChild(el)          // attached first…
  el.className = 'tiptap ProseMirror'    // …then the class…
  el.setAttribute('contenteditable', 'true') // …then contenteditable — PM's mount signature.
})
await page.waitForTimeout(500)
const after = await page.evaluate(() => { window.__pmRescan(); return window.__pmEditors })
await page.close()

console.log('\n── known-negative ──')
console.log(`A: distinct .ProseMirror elements seen per load = ${JSON.stringify(runs.map(r => r.anyClass))} (>=2 ⇒ counter is not blind; editor + anti-flash shell)`)
console.log(`B: second real-shaped editor mounted: ${before} → ${after} (must be +1)`)
const negOk = sawBoth && after === before + 1
console.log('COUNTER CAN COUNT TWO:', negOk)

console.log('\n── verdict ──')
const editors = runs.map(r => r.editors)
console.log('real editors per load:', JSON.stringify(editors))
if (!negOk) {
  console.log('VOID: the counter is not proven able to detect a double mount — its "1" means nothing.')
  await b.close(); await stop(); process.exit(2)
}
const ok = editors.every(m => m === 1)
console.log('RESULT:', ok ? 'PASS — editor mounts EXACTLY ONCE per load' : `FAIL — double mount: ${JSON.stringify(editors)}`)
await b.close()
await stop()
process.exit(ok ? 0 : 1)
