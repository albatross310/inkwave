// THE REPORT LANE MUST STAY OFF THE EDITOR'S EAGER GRAPH. ~40ms, no build, no browser.
//
// A static import once put the whole productivity REPORT lane — the modal, report/compile.ts and its
// prompt strings, the demo fixtures, the charts — inside the chunk every writer loads, with the flag
// off and no chunk of its own to show for it. `{open && <Modal/>}` is a RENDER guard and `if (flag)` a
// RUNTIME guard; neither can stop the bundler (→ docs/archive/editor-surface.md, "LAZY, AND IT MUST
// STAY LAZY"). `prodLoadPath.prove.mjs` (retired to docs/archive/probes/) checked the BUILT chunk graph
// for marker strings after `react-router build`. The property is decidable one level up, without a
// build: no file statically reachable from the eager roots may import the report lane.
//
// WHAT THE ROOTS ARE, AND WHY THE EDITOR IS ONE. `routes/Edit.tsx` does a MODULE-SCOPE
// `import('../editor/TiptapEditor')` that fires on every load — dynamic in FORM, eager in EFFECT. A scan
// that followed only static edges from Edit.tsx would exclude the editor and certify the very bug it
// exists to catch; the probe's first cut did exactly that. So TiptapEditor.tsx is a root by name.
//
// WHAT IS ALLOWED TO BE EAGER. The clock drop-up, session capture, the ledger and the pomodoro ARE on
// the load path by design (the clock is default-on and capture rides onTransaction). The rule is about
// the REPORT lane specifically: compile/claims/csv/excerpts, fixtures, charts, the two panels.
// `prodLedger` being default-ON moved the probe's "flags off" premise; it did not move this rule.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'

const ROOT = new URL('../..', import.meta.url).pathname
const rel = (p: string) => relative(ROOT, p).split('\\').join('/')

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
// `import x from '…'`, `import '…'`, `export … from '…'` — STATIC edges. `import('…')` is not matched
// because it never starts a statement with the keyword followed by a specifier/brace/string.
const STATIC_RE = /^\s*(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]*?\s+from\s+)?['"]([^'"]+)['"]/gm
const DYNAMIC_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g

function resolveSpec(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null // packages are not this rule's subject
  const base = normalize(join(dirname(from), spec))
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(c) && statSync(c).isFile()) return c
  }
  return null
}

function closure(roots: string[], edges: RegExp[]): Set<string> {
  const seen = new Set<string>()
  const stack = roots.map((r) => join(ROOT, r))
  while (stack.length) {
    const f = stack.pop()!
    if (seen.has(f)) continue
    seen.add(f)
    const src = strip(readFileSync(f, 'utf8'))
    for (const re of edges) {
      for (const m of src.matchAll(re)) {
        const r = resolveSpec(f, m[1])
        if (r && !seen.has(r)) stack.push(r)
      }
    }
  }
  return new Set([...seen].map(rel))
}

const ROOTS = ['src/routes/Edit.tsx', 'src/editor/TiptapEditor.tsx']
const REPORT_LANE = [
  /^src\/productivity\/report\//,
  /^src\/productivity\/fixtures\.ts$/,
  /^src\/productivity\/charts\//,
  /^src\/components\/ProductivityReportModal\.tsx$/,
  /^src\/components\/ProductivityGraphsPanel\.tsx$/,
  /^src\/components\/ProductivityPanel\.tsx$/,
]

describe('the productivity REPORT lane is not on the editor\'s eager static graph', () => {
  const eager = closure(ROOTS, [STATIC_RE])

  // VOID guard: an empty or tiny closure would satisfy every "absent" below.
  it('the scan can see: the closure is the real editor graph (hundreds of files, the clock trigger inside it)', () => {
    expect(eager.size).toBeGreaterThan(150)
    expect(eager.has('src/editor/TiptapEditor.tsx')).toBe(true)
    expect(eager.has('src/components/ClockMenu.tsx')).toBe(true)   // the eager TRIGGER — allowed
    expect(eager.has('src/productivity/capture.ts')).toBe(true)    // capture rides onTransaction — allowed
  })

  it('the report-lane files exist (a rule about files that were renamed away guards nothing)', () => {
    for (const p of ['src/productivity/report/compile.ts', 'src/productivity/fixtures.ts', 'src/productivity/charts/Charts.tsx',
      'src/components/ProductivityReportModal.tsx', 'src/components/ProductivityGraphsPanel.tsx']) {
      expect(existsSync(join(ROOT, p)), p).toBe(true)
    }
  })

  it('NO report-lane file is statically reachable from Edit.tsx or TiptapEditor.tsx', () => {
    const leaks = [...eager].filter((f) => REPORT_LANE.some((re) => re.test(f))).sort()
    expect(leaks, 'these ship to every writer on every load — make the import lazy (React.lazy / import())').toEqual([])
  })

  it('KNOWN-NEGATIVE for the scanner: following DYNAMIC edges too DOES reach the report lane (so its absence above is a finding, not blindness)', () => {
    const withDynamic = closure(ROOTS, [STATIC_RE, DYNAMIC_RE])
    const reached = [...withDynamic].filter((f) => REPORT_LANE.some((re) => re.test(f)))
    expect(reached).toEqual(expect.arrayContaining(['src/components/ProductivityReportModal.tsx', 'src/components/ProductivityGraphsPanel.tsx']))
    expect(withDynamic.size).toBeGreaterThan(eager.size)
  })

  it('the report lane is reached ONLY through a lazy edge from the editor (the wiring the fix installed)', () => {
    const editor = strip(readFileSync(join(ROOT, 'src/editor/TiptapEditor.tsx'), 'utf8'))
    const dyn = [...editor.matchAll(DYNAMIC_RE)].map((m) => m[1])
    expect(dyn).toEqual(expect.arrayContaining(['../components/ProductivityReportModal', '../components/ProductivityGraphsPanel']))
  })
})
