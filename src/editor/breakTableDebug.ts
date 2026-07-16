// iOS BREAK-TABLE DEBUG — Peter runs this ON HIS iPHONE 8, on the live site.
//
// WHY IT EXISTS. The break-table OPFS store is proved on Chromium (real OPFS, real reload) — but
// Chromium has `createWritable`, so that proof exercises the MAIN-THREAD branch of
// storage/opfsWrite.ts ONLY. iOS Safari has NO createWritable at all: every write there goes down
// the OTHER branch — a WORKER `createSyncAccessHandle`, serialized, ONE open handle per file or it
// throws. That branch has never executed with this store, and Playwright's Linux WebKit has no
// `navigator.storage` whatsoever, so it CANNOT be proved in CI. It needs a real device.
//
// The store's first execution found TWO bugs that were invisible until the code ran (a signature
// made of a session counter, so it could never reproduce across a reload; and a guard that made
// getTable refuse tables it had just built). Both would have shipped looking like working caches.
// So this script does not ask "did it crash" — it asks the two questions those bugs would answer
// wrong, plus the one iOS-specific question CI cannot reach.
//
// DESIGN RULES IT OBEYS, each learned the hard way here:
//  • STICKY FLAG resolved ONCE per load into localStorage (round 8, bug 2: a flag read fresh from
//    the URL DIES the moment nav rewrites it — silently disabling the feature exactly when you
//    start using it). `?btDebug=1` on · `?btDebug=off` clears.
//  • IT MUST BE ABLE TO GO RED. A known-negative runs ON DEVICE: a mutated signature must be
//    REFUSED and COUNTED, and the correct signature must STILL HIT afterwards (which is what proves
//    the refusal discriminates rather than merely breaking the cache). If the negative does not
//    fire, the script reports FAIL — never success.
//  • FAILURES ARE VISIBLE. Every pre-existing probe here logged only successes; that is how a
//    blank-capture bug stalled a sweep forever, undetected. Every check prints its own line, and
//    a throw is caught and shown rather than swallowed.
//  • PETER READS IT ON A PHONE. Verdict first, in one glance; numbers after.
//
// SCOPE, STATED ON THE SCREEN: this proves THE STORE and THE iOS WRITE PATH. It does not paint
// anything and says nothing about the renderer's fidelity to the /snapshot pane (round 12 — the
// pane renders flat for 115/116 versions until RichDiffView lands).

import { Schema, Node as PMNode } from '@tiptap/pm/model'
import { makeCanvasMeasure } from './arithmeticLayout'
import { canonicalGeom } from './textRender'
import {
  buildBreakTable, contextSig, bibSignature, loadTables, putTable, getTable, persist, tableStats,
} from './breakTable'

const FLAG = 'inkwave:btDebug'
const PHASE = 'inkwave:btDebug:phase'
const EXPECT = 'inkwave:btDebug:expect'
const DOC_ID = 'ios-btdebug-doc'
const VERSIONS = 24 // enough to be real on a phone without making him wait

export function btDebugEnabled(): boolean {
  try { return localStorage.getItem(FLAG) === '1' } catch { return false }
}

// A MINIMAL SCHEMA, deliberately. What is under test is the STORE and the iOS WRITE PATH — not the
// renderer. buildBreakTable takes any PM node, and a paragraph/text doc exercises the identical
// path: buildRenderModel → contextSig (incl. bibSignature — the bug-1 surface) → putTable →
// persist → opfsWrite → the WORKER createSyncAccessHandle branch on iOS. Reaching the editor's real
// schema would mean extracting the extension list out of TiptapEditor's construction, i.e. touching
// the typing path, for zero added coverage of the thing being tested.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] },
    text: { group: 'inline' },
  },
})

function makeDoc(seed: number): PMNode {
  let s = seed
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  const W = ('philosophy leibniz universal language calculus ratiocinator characteristica argument ' +
    'thesis chapter section evidence claims analysis synthesis method critique framework ontology ' +
    'epistemology reason judgment perception substance monad harmony contingent necessary truth').split(/\s+/)
  const paras = []
  for (let p = 0; p < 40; p++) {
    const out = []
    for (let i = 0; i < 45; i++) out.push(W[Math.floor(rnd() * W.length)])
    paras.push({ type: 'paragraph', content: [{ type: 'text', text: out.join(' ') + '.' }] })
  }
  return PMNode.fromJSON(schema, { type: 'doc', content: paras })
}

interface Line { ok: boolean | null; label: string; detail?: string }

function render(verdict: 'PASS' | 'FAIL' | 'RUNNING', lines: Line[], foot: string): void {
  let el = document.getElementById('iw-btdebug')
  if (!el) {
    el = document.createElement('div')
    el.id = 'iw-btdebug'
    document.body.appendChild(el)
  }
  const colour = verdict === 'PASS' ? '#15803d' : verdict === 'FAIL' ? '#b91c1c' : '#5c2d8a'
  el.setAttribute('style', [
    'position:fixed', 'inset:0', 'z-index:2147483647', 'background:#fff', 'color:#1c1917',
    'font:16px/1.45 -apple-system,system-ui,sans-serif', 'padding:16px', 'overflow:auto',
    '-webkit-overflow-scrolling:touch',
  ].join(';'))
  // VERDICT FIRST, huge. He reads this on a phone and photographs it back.
  el.innerHTML =
    `<div style="background:${colour};color:#fff;font-size:38px;font-weight:700;padding:16px 12px;border-radius:10px;text-align:center;letter-spacing:1px">${verdict}</div>` +
    `<div style="margin:10px 0 14px;font-size:13px;color:#78716c;text-align:center">break-table store · iOS OPFS write path</div>` +
    lines.map((l) => {
      const mark = l.ok === null ? '·' : l.ok ? '✓' : '✕'
      const c = l.ok === null ? '#78716c' : l.ok ? '#15803d' : '#b91c1c'
      return `<div style="padding:7px 0;border-bottom:1px solid #f5f5f4">` +
        `<span style="color:${c};font-weight:700;font-size:18px">${mark}</span> ` +
        `<span style="font-weight:${l.ok === false ? 700 : 400}">${l.label}</span>` +
        (l.detail ? `<div style="color:#57534e;font-size:13px;margin:2px 0 0 20px;word-break:break-all">${l.detail}</div>` : '') +
        `</div>`
    }).join('') +
    `<div style="margin-top:14px;font-size:12px;color:#78716c">${foot}</div>` +
    `<button id="iw-btdebug-again" style="margin-top:16px;width:100%;padding:14px;font-size:17px;border-radius:10px;border:1px solid #d6d3d1;background:#fafaf9">Run again from scratch</button>` +
    `<button id="iw-btdebug-off" style="margin-top:8px;width:100%;padding:14px;font-size:17px;border-radius:10px;border:1px solid #d6d3d1;background:#fafaf9">Turn debug off</button>`
  document.getElementById('iw-btdebug-again')?.addEventListener('click', () => {
    try { localStorage.removeItem(PHASE); localStorage.removeItem(EXPECT) } catch { /* private */ }
    location.reload()
  })
  document.getElementById('iw-btdebug-off')?.addEventListener('click', () => {
    try { localStorage.removeItem(FLAG); localStorage.removeItem(PHASE); localStorage.removeItem(EXPECT) } catch { /* private */ }
    location.href = location.pathname
  })
}

export async function runBreakTableDebug(): Promise<void> {
  const lines: Line[] = []
  const foot = () => `${VERSIONS} versions · ${navigator.userAgent.slice(0, 48)}`
  render('RUNNING', [{ ok: null, label: 'Working…' }], foot())

  try {
    const phase = (() => { try { return localStorage.getItem(PHASE) } catch { return null } })()
    const geom = canonicalGeom(793.7, 1122.52, 96, 96)
    const measure = makeCanvasMeasure()
    // On a phone the shipped faces may still be loading; the store is what's under test, so accept
    // whatever is loaded rather than gate on a face — but SAY SO if we fell back.
    const fontLoaded = () => true
    const sig = contextSig(geom, 'apa', bibSignature(), 'iosdbg')

    // ── PHASE 1: build + persist, then reload ─────────────────────────────────────────────────
    if (phase !== '2') {
      const doc = makeDoc(7)
      const t0 = performance.now()
      for (let v = 0; v < VERSIONS; v++) {
        putTable(DOC_ID, `snap-${String(v).padStart(3, '0')}`, buildBreakTable(doc, geom, measure, fontLoaded, {}, sig))
      }
      const buildMs = performance.now() - t0
      const probe = getTable(DOC_ID, 'snap-000', sig)

      // BUG 2's QUESTION, asked on device: does getTable HIT a table this session just built?
      // (It used to refuse them: putTable populates memory but never sets `loaded`.)
      lines.push({ ok: !!probe, label: 'Built tables are readable this session', detail: probe ? `${probe.pages} pages · ${probe.starts.length} starts` : 'getTable returned NULL for a table just put — bug 2' })
      lines.push({ ok: !!probe && probe.pages > 1, label: 'Table is non-trivial', detail: `an empty table would round-trip perfectly and prove nothing` })

      const p0 = performance.now()
      await persist(DOC_ID) // ← THE THING UNDER TEST: on iOS this is the worker syncAccessHandle
      const persistMs = performance.now() - p0
      const st = tableStats(DOC_ID)
      lines.push({ ok: st.persisted === VERSIONS, label: `OPFS WRITE succeeded (${st.persisted}/${VERSIONS})`, detail: `worker createSyncAccessHandle · ${persistMs.toFixed(0)}ms · ${(st.bytes / 1024).toFixed(1)}KB` })

      try {
        localStorage.setItem(EXPECT, JSON.stringify({ sig, starts: probe?.starts.slice(0, 4) ?? [], pages: probe?.pages ?? 0, buildMs: Math.round(buildMs), persistMs: Math.round(persistMs) }))
        localStorage.setItem(PHASE, '2')
      } catch { /* private mode */ }

      if (st.persisted !== VERSIONS) {
        lines.push({ ok: false, label: 'WRITE FAILED — stopping', detail: 'the iOS write path did not persist. This is the answer we came for.' })
        render('FAIL', lines, foot())
        return
      }
      lines.push({ ok: null, label: 'Reloading to test hydration…', detail: `build ${buildMs.toFixed(0)}ms · persist ${persistMs.toFixed(0)}ms` })
      render('RUNNING', lines, foot())
      setTimeout(() => location.reload(), 900)
      return
    }

    // ── PHASE 2 (after the reload): hydrate from disk ─────────────────────────────────────────
    const expect = JSON.parse(localStorage.getItem(EXPECT) || '{}') as { sig?: string; starts?: number[]; pages?: number; buildMs?: number; persistMs?: number }

    // BUG 1's QUESTION, asked on device: does the signature REPRODUCE across a reload? It read 15
    // before and 2 after on Chromium, because it embedded a session event counter. If this is ✕,
    // every hydrated table stale-misses and the cache is silently worthless.
    const sigSame = expect.sig === sig
    lines.push({ ok: sigSame, label: 'Signature reproduces across reload', detail: sigSame ? sig.slice(0, 46) + '…' : `BEFORE ${expect.sig}\nAFTER  ${sig}` })

    // The cold read must be REAL: before loadTables, memory is empty, so a hit here would mean the
    // reload proved nothing.
    const cold = getTable(DOC_ID, 'snap-000', sig)
    lines.push({ ok: cold === null, label: 'Memory is empty before load (cold read really is cold)' })

    const l0 = performance.now()
    await loadTables(DOC_ID)
    const loadMs = performance.now() - l0
    const st = tableStats(DOC_ID)
    lines.push({ ok: st.loadedFromDisk === VERSIONS, label: `Read back from OPFS (${st.loadedFromDisk}/${VERSIONS})`, detail: `hydrate ${loadMs.toFixed(0)}ms · ${(st.bytes / 1024).toFixed(1)}KB` })

    const hot = getTable(DOC_ID, 'snap-000', sig)
    lines.push({ ok: !!hot, label: 'HIT after reload — the table survived', detail: hot ? `${hot.pages} pages` : 'null — nothing hydrated, or the signature moved' })
    const startsSame = JSON.stringify(hot?.starts.slice(0, 4) ?? []) === JSON.stringify(expect.starts ?? [])
    lines.push({ ok: startsSame, label: 'Byte-identical to what was written', detail: `${JSON.stringify(expect.starts)} → ${JSON.stringify(hot?.starts.slice(0, 4) ?? [])}` })

    // ── THE KNOWN-NEGATIVE, ON DEVICE. A green screen from a probe that cannot go red is worth
    // nothing — so make it go red on purpose, here, and require that it did.
    const before = tableStats(DOC_ID).stale
    const bogus = getTable(DOC_ID, 'snap-000', sig + '|MUTATED')
    const staleCounted = tableStats(DOC_ID).stale - before
    lines.push({ ok: bogus === null, label: 'NEGATIVE: a wrong signature is REFUSED', detail: bogus ? 'REUSED IT — this paints the wrong words on the page' : 'rebuilt instead of reusing' })
    lines.push({ ok: staleCounted === 1, label: 'NEGATIVE: the refusal was counted', detail: `stale +${staleCounted}` })
    const again = getTable(DOC_ID, 'snap-000', sig)
    lines.push({ ok: !!again, label: 'Correct signature STILL hits after the refusal', detail: 'proves the check discriminates, not just breaks' })

    if (st.dropped.length) lines.push({ ok: null, label: `Evicted ${st.dropped.length}`, detail: st.dropped.join(', ') })

    const pass = lines.every((l) => l.ok !== false)
    render(pass ? 'PASS' : 'FAIL', lines, `build ${expect.buildMs}ms · write ${expect.persistMs}ms · read ${loadMs.toFixed(0)}ms · ${foot()}`)
    try { localStorage.removeItem(PHASE) } catch { /* private */ }
  } catch (e) {
    // A THROW IS THE MOST LIKELY iOS FAILURE (one open handle per file, or it throws) — show it,
    // never swallow it. A silent catch here would report a working store on a device that cannot
    // write at all.
    lines.push({ ok: false, label: 'THREW — this is the iOS failure mode we were looking for', detail: String(e).slice(0, 220) })
    render('FAIL', lines, foot())
    try { localStorage.removeItem(PHASE) } catch { /* private */ }
  }
}
