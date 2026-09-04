// EVERY `→ docs/archive/…#anchor` POINTER MUST RESOLVE.
//
// The narrative→archive pass (docs/RULES.md) leaves a one-line rule beside the code and moves its
// reasoning to `docs/archive/`. That split is only safe while the pointer works: a rule whose reason
// cannot be found is a rule the next person deletes as unexplained, and this repo's own record is
// that six data-loss incidents were re-introductions of a rule someone had stopped believing.
//
// R1 in docs/RULES.md, applied to documentation: a pointer that resolves to nothing is not "no
// story", it is a story that has gone missing — and nothing else in the build would notice, because
// a broken markdown link neither typechecks nor renders anywhere.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const ARCHIVE = join(ROOT, 'docs', 'archive')

/** Every `docs/archive/<file>.md#<anchor>` mentioned anywhere under src/. */
function pointers(): { file: string; anchor: string; from: string }[] {
  const out: { file: string; anchor: string; from: string }[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!/\.(ts|tsx)$/.test(e.name)) continue
      const src = readFileSync(p, 'utf8')
      for (const m of src.matchAll(/docs\/archive\/([\w.-]+)\.md#([\w-]+)/g)) {
        out.push({ file: m[1], anchor: m[2], from: p.slice(ROOT.length + 1) })
      }
    }
  }
  walk(join(ROOT, 'src'))
  return out
}

/** Every `<a id="…">` anchor the archive actually defines. */
function anchors(): Set<string> {
  const found = new Set<string>()
  if (!existsSync(ARCHIVE)) return found
  for (const f of readdirSync(ARCHIVE)) {
    if (!f.endsWith('.md')) continue
    for (const m of readFileSync(join(ARCHIVE, f), 'utf8').matchAll(/<a id="([\w-]+)"/g)) {
      found.add(`${f.slice(0, -3)}#${m[1]}`)
    }
  }
  return found
}

describe('archive pointers resolve', () => {
  it('VOID GUARD: there are pointers to check and anchors to check them against', () => {
    // An empty sweep would satisfy the assertion below while proving nothing — the trap this repo
    // keeps writing down (R3: a guard must be proved to fire).
    expect(pointers().length).toBeGreaterThan(50)
    expect(anchors().size).toBeGreaterThan(50)
  })

  it('every pointer in src/ names an anchor that exists', () => {
    const have = anchors()
    const missing = pointers()
      .filter((p) => !have.has(`${p.file}#${p.anchor}`))
      .map((p) => `${p.from} → docs/archive/${p.file}.md#${p.anchor}`)
    expect(missing).toEqual([])
  })

  it('KNOWN-NEGATIVE: the check can see a pointer that does not resolve', () => {
    // Proves the matcher discriminates rather than passing on whatever it is handed.
    expect(anchors().has('editor-surface#definitely-not-an-anchor')).toBe(false)
  })
})
