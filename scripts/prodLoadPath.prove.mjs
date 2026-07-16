// PROVE: the productivity/email lane costs the load path NOTHING with its flags off.
//
// Run AFTER `npx react-router build` (NOT `vite build` — that exits 0 and writes nothing, which is
// how a probe comes to read chunk numbers off an empty directory).
//
// WHAT THE DENOMINATOR IS, AND WHY IT IS NOT "STATICALLY REACHABLE FROM index.html".
// `routes/Edit.tsx` does `const tiptapEditorImport = typeof window !== 'undefined' ?
// import('../editor/TiptapEditor') : null` — a MODULE-SCOPE dynamic import that fires on every
// load, unconditionally. So the editor chunk is dynamic in FORM but EAGER in EFFECT: it is "the
// chunk every writer loads" (CLAUDE.md: "the editor chunk is eagerly imported at module scope").
// The first cut of this probe walked static edges only, excluded the editor chunk from the eager
// set, and therefore reported "not eager ✅" for markers that were sitting INSIDE it — it would
// have certified the very bug it exists to catch. A closure that cannot contain the defect is not
// a measurement. Hence ALWAYS_LOADED below.
import { readFileSync } from 'fs'
import { gzipSync } from 'zlib'

const A = 'build/client/assets/'
const html = readFileSync('build/client/index.html', 'utf8')
const named = (re) => {
  const m = readFileSync('build/client/index.html', 'utf8')
  return m
}

/** Chunks the browser fetches from the prerendered HTML. */
const htmlRoots = [...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.js)"/g)].map(m => m[1])

/** Dynamic imports that are nonetheless UNCONDITIONAL on every load. */
const ALWAYS_LOADED = [/^TiptapEditor-.*\.js$/]
const allChunks = readFileSync.length ? null : null
import { readdirSync } from 'fs'
const files = readdirSync(A)
const alwaysRoots = files.filter(f => ALWAYS_LOADED.some(re => re.test(f)))

/** Static-import closure. A dynamic `import("./X.js")` / __vite__mapDeps entry is NOT an eager edge. */
function closure(roots) {
  const seen = new Set(); const stack = [...roots]
  while (stack.length) {
    const f = stack.pop()
    if (seen.has(f) || !f.endsWith('.js')) continue
    seen.add(f)
    let src; try { src = readFileSync(A + f, 'utf8') } catch { continue }
    const stat = src.replace(/import\(\s*"[^"]+"\s*\)/g, 'import(0)')
    for (const m of stat.matchAll(/(?:from|import)\s*"\.\/([^"]+\.js)"/g)) stack.push(m[1])
  }
  return seen
}

const eager = closure([...htmlRoots, ...alwaysRoots])
const bytes = [...eager].reduce((n, f) => n + gzipSync(readFileSync(A + f)).length, 0)
console.log(`EAGER load path (flags OFF): ${eager.size} chunks, ${bytes} B gzip`)
console.log(`  (= HTML entries + the always-imported editor chunk + their static closure)`)

// Marker strings, not symbol names: the build is minified, so a name search finds nothing and
// reads as "absent" rather than "unsearchable".
const MARKERS = {
  'report prompt (report/compile.ts)': 'DATA — measured by Inkwave on this device',
  'notes section (report/compile.ts)': "THE WRITER'S OWN NOTES",
  'demo fixture prose (fixtures.ts)':  'Finally got the third step of the argument down.',
  'demo fixture label (fixtures.ts)':  'Seminar paper draft',
}
const text = new Map([...eager].map(f => [f, readFileSync(A + f, 'utf8')]))

// KNOWN-POSITIVE FIRST: if the probe cannot find a string that IS in the eager set, every "absent"
// below is meaningless and the run VOIDS rather than passing.
const anchorHits = [...text].filter(([, s]) => s.includes('Inkwave')).map(([f]) => f)
if (anchorHits.length === 0) {
  console.error('VOID: known-positive "Inkwave" not found in the eager set — the probe is blind.')
  process.exit(2)
}
console.log(`known-positive: "Inkwave" found in ${anchorHits.length} eager chunk(s) — probe can see.\n`)

let violations = 0
for (const [name, s] of Object.entries(MARKERS)) {
  const hits = [...text].filter(([, src]) => src.includes(s)).map(([f]) => f)
  if (hits.length) { violations++; console.log(`  ON THE LOAD PATH ❌  ${name} → ${hits.join(', ')}`) }
  else console.log(`  off the load path ✅  ${name}`)
}
console.log(violations === 0
  ? '\nPASS — no productivity/report code on the flags-off load path.'
  : `\nFAIL — ${violations} marker(s) ship to every writer with the flags off.`)
process.exit(violations === 0 ? 0 : 1)
