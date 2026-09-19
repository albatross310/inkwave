// THE .iw-nightable RESCUE ARMS, COUNTED — which of them still catches anything.
//
// ─── WHAT THESE ARMS ARE ─────────────────────────────────────────────────────────────────────────
// `.iw-nightable` carries a set of blanket overrides that repaint UNAUDITED chrome at night —
// `[class*="text-stone"]`, `[class*="5c2d8a"]`, `[style*="background:#fff"]` and so on. They are a
// safety net under panels nobody has tokenised, and every one of them is a substring match on
// markup, which means each can silently stop matching (a class renamed, a value reserialised) while
// still reading like protection. CLAUDE.md's rule for this whole family: judge what the code DOES.
//
// ─── WHY A BROWSER, AND WHY THIS ONE IS NOT REASONABLE FROM SOURCE ───────────────────────────────
// The `[style*=…]` arms match the style ATTRIBUTE as a string, and almost nothing in this app writes
// that string. React sets inline styles through the CSSOM, which SERIALISES — `#fff` becomes
// `rgb(255, 255, 255)` — so `style={{ background: '#fff' }}` has never matched either arm. That much
// was already measured (see the note in index.css). What was NOT measured, and is the finding here,
// is that the CSSOM re-serialises an attribute a *hand-written* `setAttribute` put there, the first
// time anything touches `el.style.anything`. So an arm can have a real consumer, in source, that it
// stops catching one frame later. No amount of grepping shows that; only an engine does.
//
// ─── THE INSTRUMENT IS ARMED BEFORE ANY VERDICT IS READ ──────────────────────────────────────────
// "Nothing matches this selector" is the empty-list trap in its purest form: a typo'd selector, a
// page that never loaded, a panel that never opened, all report a serene zero. So each arm gets a
// PLANTED KNOWN-POSITIVE first — an element written exactly the way the arm expects — and the sweep
// refuses to report on any arm whose planted case did not both match AND repaint.
//
// ⚠ AND THE ARMS ARE INJECTED BY THE PROBE, not read off the shipped stylesheet. The first cut armed
// itself on index.css's own declarations, so the moment they were (correctly) removed its
// known-positives could no longer fire and it FAILED — a probe that had proved its own finding and
// then died of it. Injecting the rule turns the question into one that stays worth asking in both
// states: IF these arms were here, what would they catch? Today, and this is the whole verdict:
// nothing.
import { chromium } from '@playwright/test'
import { startProbeServer } from './serve.mjs'

const EDITOR = '.ProseMirror[contenteditable="true"]'
const NIGHT_FILL = 'rgb(60, 68, 78)'   // what the [style*=…] arms repaint to (#3c444e)

const ARMS = [
  { name: 'style*="background: #fff"  (with a space)', attr: 'background: #fff' },
  { name: 'style*="background:#fff"   (no space)', attr: 'background:#fff' },
]

// Every OTHER arm in the same block, counted but not planted: these are class matches and cannot
// stop matching the way a serialised style attribute can. They are here because "retiring the
// rescue arms" is one job in the plan and NOBODY HAD A NUMBER FOR IT — index.css warns that adding
// an rgb() arm "would silently re-tone every unaudited panel in the app at once", and removing one
// has exactly the same property in the other direction. This prints the blast radius per arm so the
// per-surface work can be scheduled against a measurement instead of a guess.
const CLASS_ARMS = [
  '[class*="5c2d8a"]', '[class*="9b5ccc"]',
  '.bg-white', '[class*="text-stone"]', '[class*="text-gray"]', '[class*="text-neutral"]',
  '[class*="border-stone"]', '[class*="border-gray"]',
  'input', 'select', 'textarea',
]

const { base, stop } = await startProbeServer()
const b = await chromium.launch({ headless: true })
// serviceWorkers: 'block' — Inkwave registers one that answers from its own cache, and page.route
// cannot intercept a service-worker-originated request. Four wrong theories are recorded in
// reader.prove.mjs from the one time this was left on.
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' })
const page = await ctx.newPage()

let fail = 0
let voided = 0   // preconditions that did not hold — see the verdict block
const check = (ok, msg, extra = '') => { console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra ? ' — ' + extra : ''}`); if (!ok) fail++ }

try {
  await page.evaluate(() => {}).catch(() => {})
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => { try { localStorage.setItem('inkwave:theme', 'night') } catch {} })
  await page.reload({ waitUntil: 'domcontentloaded' })
  // The one precondition everything below rests on. Without the editor there are no panels to
  // scan, and "0 matches" would mean "nothing was looked at" while reading as "the arms are dead".
  try {
    await page.waitForSelector(EDITOR, { timeout: 60000 })
  } catch {
    console.log('  ⚠ the editor never mounted — nothing to scan')
    voided++
    throw new Error('__void__')
  }
  await page.waitForTimeout(2000)
  const theme = await page.evaluate(() => document.documentElement.dataset.theme)
  check(theme === 'night', 'night theme is applied to <html>', `data-theme=${theme}`)

  // ⚠ THE ARMS ARE INJECTED, NOT READ OFF THE SHIPPED STYLESHEET, and that is what lets this probe
  // survive its own verdict. Its first cut armed itself on the arms as index.css declared them —
  // so the moment they were (correctly) removed the known-positives could no longer fire and the
  // probe FAILED, having proved its own finding. A control that only exists while the bug does is
  // the round-12 trap ("any cell whose PASS condition is satisfiable by the mechanism that disables
  // the feature is not a control"). Injecting the rule asks the question that stays useful in both
  // states: IF these arms were here, what would they catch?
  await page.addStyleTag({ content: ARMS.map((a) =>
    `:root[data-theme="night"] .iw-nightable [style*="${a.attr}"] { background-color: ${NIGHT_FILL} !important; }`).join('\n') })

  console.log('\n── KNOWN-POSITIVES: can each arm be seen to fire at all? ───────────────────────')
  const planted = await page.evaluate((arms) => {
    const host = document.createElement('div')
    host.className = 'iw-nightable'
    host.id = 'iw-arm-host'
    document.body.appendChild(host)
    return arms.map((a) => {
      const el = document.createElement('div')
      el.setAttribute('style', a.attr + ';width:10px;height:10px')
      host.appendChild(el)
      return { name: a.name, attr: el.getAttribute('style'), bg: getComputedStyle(el).backgroundColor }
    })
  }, ARMS)
  for (const p of planted) {
    check(p.bg === NIGHT_FILL, `arm fires on markup written exactly its way: ${p.name}`, `${p.attr} → ${p.bg}`)
  }
  const armed = planted.every((p) => p.bg === NIGHT_FILL)
  check(armed, 'INSTRUMENT ARMED — a zero below means "nothing matches", not "the probe is blind"')

  console.log('\n── THE ONE REAL CONSUMER: citationNav\'s back chip ─────────────────────────────')
  // It is the only element in the app that hand-writes a style ATTRIBUTE carrying `background:#fff`
  // on a `.iw-nightable` element, and index.css names it as the reason the arms are kept. So its
  // behaviour, not the grep, decides whether keeping them is doing anything.
  const chip = await page.evaluate(async () => {
    const el = document.createElement('button')
    el.id = 'iw-chip-replica'
    el.className = 'iw-nightable'
    // Byte-for-byte the string citationNav.ts builds (join(';')), so this measures that code path
    // and not a paraphrase of it.
    el.setAttribute('style', [
      'position:fixed', 'left:50%', 'transform:translateX(-50%)', 'bottom:6.5rem', 'z-index:250',
      'font-family:system-ui,sans-serif', 'font-size:12px', 'padding:6px 12px', 'border-radius:9999px',
      'border:1px solid rgba(92,45,138,0.45)', 'background:#fff', 'color:#5c2d8a', 'cursor:pointer',
      'box-shadow:0 3px 12px rgba(0,0,0,0.14)', 'opacity:0', 'transition:opacity 160ms ease',
    ].join(';'))
    document.body.appendChild(el)
    const before = { attr: el.getAttribute('style'), bg: getComputedStyle(el).backgroundColor }
    // …and then the very next thing citationNav does: a CSSOM write, inside a rAF.
    await new Promise((r) => requestAnimationFrame(() => { el.style.opacity = '1'; r() }))
    const after = { attr: el.getAttribute('style'), bg: getComputedStyle(el).backgroundColor }
    return { before, after }
  })
  console.log(`      · before the rAF: ${chip.before.bg}`)
  console.log(`        attr: ${chip.before.attr.slice(0, 120)}…`)
  console.log(`      · after  the rAF: ${chip.after.bg}`)
  console.log(`        attr: ${chip.after.attr.slice(0, 120)}…`)
  // With the arms INJECTED above, an arm would repaint the chip to NIGHT_FILL if it reached it.
  // It does not, for two independent reasons and either alone is sufficient: these are DESCENDANT
  // selectors and the chip IS the `.iw-nightable` (nothing above it carries the class), and the
  // attribute is reserialised out of the arm's reach by the very next CSSOM write.
  const held = chip.after.attr.includes('background:#fff') || chip.after.attr.includes('background: #fff')
  const dependsOnArm = chip.after.bg === NIGHT_FILL
  check(!dependsOnArm, 'the back chip is NOT rescued by an arm — index.css named it as the reason to keep them',
    `bg ${chip.after.bg} (that is .iw-nightable's own fill, not the arm's ${NIGHT_FILL})`)
  check(!held, '…and its attribute no longer even carries the substring after one CSSOM write',
    held ? 'still literal' : 'reserialised')

  console.log('\n── THE LIVE SWEEP: what matches each arm in the running app ────────────────────')
  // Open every panel a click can reach, so "nothing matches" is a statement about the app rather
  // than about the one screen that happened to be mounted.
  await page.evaluate(() => {
    document.getElementById('iw-arm-host')?.remove()
    document.getElementById('iw-chip-replica')?.remove()
    for (const b2 of document.querySelectorAll('button[title], button[aria-label]')) {
      try { b2.click() } catch { /* a control that refuses a synthetic click is not the subject */ }
    }
  })
  await page.waitForTimeout(1200)
  const swept = await page.evaluate((arms) => {
    const out = {}
    for (const a of arms) {
      const sel = `.iw-nightable [style*="${a.attr}"]`
      out[a.name] = [...document.querySelectorAll(sel)].map((el) => ({
        tag: el.tagName.toLowerCase(), id: el.id || null, cls: (el.className || '').toString().slice(0, 40),
      }))
    }
    out._panels = document.querySelectorAll('.iw-nightable').length
    return out
  }, ARMS)
  check(swept._panels > 0, 'the sweep saw real .iw-nightable surfaces mounted', `${swept._panels} of them`)
  for (const a of ARMS) {
    const hits = swept[a.name]
    console.log(`  · ${a.name}: ${hits.length} element(s) ${hits.length ? JSON.stringify(hits.slice(0, 4)) : ''}`)
  }

  console.log('\n── BLAST RADIUS OF THE ARMS THIS LANE IS NOT TOUCHING ──────────────────────────')
  // Counted on ONE screen (the editor with everything a click can open). It is a FLOOR, not a
  // census: /snapshot, /verify, /about and the panels behind a flag are not mounted here. Read it
  // as "at least this many elements are currently being rescued", never as "only these".
  const radius = await page.evaluate((sels) => sels.map((s) => ({
    s, n: document.querySelectorAll(`:root[data-theme="night"] .iw-nightable ${s}`).length,
  })), CLASS_ARMS)
  for (const r of radius) console.log(`  · .iw-nightable ${r.s}: ${r.n}`)
  const anyRadius = radius.some((r) => r.n > 0)
  check(anyRadius, 'the class arms ARE catching live elements — retiring one is a per-surface job')

  console.log('\n──────── VERDICT ────────')
  for (const a of ARMS) console.log(`  ${a.name}: ${swept[a.name].length} live match(es)`)
  check(armed && swept._panels > 0, 'the counts above are readable (instrument armed, panels mounted)')
  // The claim index.css now rests on. Stated as a question about the RUNNING APP — "would these
  // arms rescue anything" — so it keeps its meaning whether or not the stylesheet declares them.
  check(ARMS.every((a) => swept[a.name].length === 0),
    'no element in the running app needs a [style*=…] arm — removing them from index.css costs nothing')
  // COVERAGE, STATED: one screen (the editor with every reachable menu open), not a census. The
  // structural half is what covers the rest — only a hand-written setAttribute('style', …) can put
  // this substring in an attribute at all, `.style.cssText` reserialises like every other CSSOM
  // write, and the repo has exactly three such call sites (citationNav's chip, breakTableDebug's
  // overlay, scrubRaster's clone wrapper), of which only the chip is on a themed element.
  console.log('\n  coverage: the editor screen with every reachable menu open. /snapshot, /verify and')
  console.log('  the flagged panels are not mounted here — see the note above for the static half.')
} catch (e) {
  // A voided precondition already reported itself; only real faults count as failures.
  if (e?.message !== '__void__') { console.log(`  ✗ ${e.message}\n${e.stack}`); fail++ }
} finally { await b.close(); await stop() }

// ⚠ A THIRD ANSWER: "I CANNOT TELL". This probe's whole question is whether a rescue arm still
// SELECTS anything, and it can only ask that of surfaces it managed to mount. If the editor never
// came up — a build that did not serve, a panel that moved — then "0 matches" is not evidence the
// arms are dead; it is evidence nothing was scanned. Reporting that as PASS would be the strongest
// possible false negative for exactly the claim this probe exists to support.
//
// The repo's audit ratchet (src/audit/probesRunnable.test.ts) requires this, and it required it of
// me: the first cut of this file had only pass/fail and the ratchet said so.
if (!fail && voided) {
  // ⚠ THE NEWLINE IS ITS OWN CALL, and that is not style. The audit ratchet greps the SOURCE for
  // /\bVOID\b/, and in source a template literal's `\n` is the two characters backslash-n — so
  // `\nVOID` reads as `nVOID` with no word boundary and the guard cannot see it. A probe that
  // HAS a void path but is counted as mute is the guard failing quietly in the direction of
  // more debt, which is the shape this file exists to catch.
  console.log('')
  console.log(`VOID (${voided}) — a precondition moved; this run proves nothing about the arms.`)
  process.exitCode = 2
} else {
  console.log(fail ? `\nFAIL (${fail})` : '\nPASS')
  process.exitCode = fail ? 1 : 0
}
