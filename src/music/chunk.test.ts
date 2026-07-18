// "OFF COSTS NOTHING" — asserted, not assumed.
//
// The music module's dependency is heavy: OpenSheetMusicDisplay is 338 kB gzipped in the built
// chunk. The entire justification for taking that dependency is that it costs ZERO for everyone who
// hasn't switched the flag on — nothing fetched, nothing parsed, the editor bundle untouched
// (CLAUDE.md: load performance is sacred).
//
// That claim is one careless `import` away from being false, and the failure is SILENT: an
// unconditional import at the top of a route would put 338 kB into a shared chunk, every writer
// would pay it on first load, and absolutely nothing would look wrong. (An agent on this codebase
// caught itself writing exactly that import today.) So it is a build-gate assertion.
//
// ─── Two guards, deliberately of different kinds ─────────────────────────────────────────────
//  1. STATIC IMPORT GRAPH (always runs). Walks the real `import` statements from the editor's entry
//     and proves no music module is statically reachable. This is the guard that catches the actual
//     regression, and it needs no build — so it can never be quietly skipped.
//  2. BUILT CHUNKS (runs only when build/ exists). Confirms against the REAL build output that OSMD
//     landed in one lazy chunk and not in the entry. This is the one that would catch a bundler
//     change the source alone can't predict.
//
// Guard 2 is conditional, which is a hazard in itself — a check that skips is a check that cannot
// fail, and this codebase has been burned by exactly that. That is precisely why guard 1 exists and
// is unconditional: the conditional check is a bonus, never the load-bearing one.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '../..')
const APP = join(ROOT, 'app')
const SRC = join(ROOT, 'src')

// ─── a small import-graph walker ─────────────────────────────────────────────────────────────

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/** Static import/export specifiers (NOT `import(...)`, which is a lazy boundary). */
export function staticSpecifiers(code: string): string[] {
  const src = stripComments(code)
  const out: string[] = []
  // `import ... from 'x'`, `import 'x'`, `export ... from 'x'`
  const re = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/g
  for (const m of src.matchAll(re)) {
    // ⚠️ SKIP `import type` / `export type` — THEY ARE ERASED AT COMPILE TIME AND SHIP NO BYTES.
    //
    // This walker is a cheap PROXY for the real claim ("the editor downloads no music bytes"), and
    // on a type-only import the proxy was WRONG: it reported a dependency that cannot exist at
    // runtime. It fired when `types/document.ts` type-imported the §1 `Piece` — the same shape the
    // file already uses for `ToolbarConfig`, which the walker never saw only because
    // `editor/toolbarContract` is not under `src/music/`.
    //
    // GROUND TRUTH, MEASURED BEFORE LOOSENING THIS: no built chunk outside MusicStudio/demo carries
    // any music string, and `music.prove.mjs` asserts what the browser ACTUALLY DOWNLOADS to open
    // `/` — no music chunk, with a void-guard so a blind listener cannot pass it. The bytes were
    // never there; the proxy was.
    //
    // ONLY the STATEMENT form is skipped. `import { type X, y }` is left flagged deliberately: it
    // can still emit a runtime import, so a walker that skipped it would be guessing. Conservative
    // in the direction that keeps the guard honest.
    //
    // MUTATION-PROVED AFTER LOOSENING, and the first mutant was a DUD worth recording: adding
    // `import { newPiece }` to `types/document.ts` did NOT fail this guard, which looked exactly
    // like the walker having gone blind. It had not — that file is reached from the editor ONLY
    // through type imports, so it is not in the runtime graph at all and a value import inside it
    // is dead code that ships nothing. The guard was right and the mutant was not a bug. The honest
    // negative puts the value import in a file the editor actually RUNS (`routes/Edit.tsx`), and
    // that one FAILS this guard: ['src/music/types.ts'] vs []. A mutation that does not reproduce
    // a real bug tests nothing — check the mutant misbehaves before concluding the guard is weak.
    const stmt = m[0]
    if (/(?:^|\n)\s*(?:import|export)\s+type\s/.test(stmt)) continue
    out.push(m[1])
  }
  return out
}

/** Dynamic `import('x')` specifiers — where a chunk boundary is created. */
function dynamicSpecifiers(code: string): string[] {
  const src = stripComments(code)
  return [...src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1])
}

/** Resolve a relative specifier to a real file, trying the usual extensions. */
function resolveFile(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null // bare package
  const base = resolve(dirname(fromFile), spec)
  const candidates = [
    base,
    `${base}.ts`, `${base}.tsx`,
    join(base, 'index.ts'), join(base, 'index.tsx'),
  ]
  return candidates.find(c => existsSync(c) && !c.endsWith('/')) ?? null
}

/** Every file statically reachable from `entry`, plus every bare package statically imported. */
function staticGraph(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>()
  const packages = new Set<string>()
  const queue = [entry]
  while (queue.length) {
    const file = queue.pop()!
    if (files.has(file) || !existsSync(file)) continue
    files.add(file)
    const code = readFileSync(file, 'utf8')
    for (const spec of staticSpecifiers(code)) {
      const target = resolveFile(file, spec)
      if (target) queue.push(target)
      else if (!spec.startsWith('.')) packages.add(spec)
    }
  }
  return { files, packages }
}

const rel = (f: string) => f.replace(`${ROOT}/`, '')
const musicFiles = (files: Set<string>) =>
  [...files].filter(f => f.startsWith(join(SRC, 'music'))).map(rel).sort()

// ─── guard 0: the WALKER ITSELF ──────────────────────────────────────────────────────────────
//
// The walker was loosened to skip `import type` (erased at compile time, ships no bytes — see
// staticSpecifiers). A loosened guard has to prove it did not go blind: every assertion below this
// point is worthless if the walker stopped seeing real imports. So the walker is tested directly,
// which needs no fixture file and no build.

describe('the import walker sees what it must and skips what is erased', () => {
  it('SEES a value import — the thing every guard below depends on', () => {
    expect(staticSpecifiers(`import { newPiece } from './music/types'`)).toEqual(['./music/types'])
    expect(staticSpecifiers(`import './music/side-effect'`)).toEqual(['./music/side-effect'])
    expect(staticSpecifiers(`export { x } from './music/types'`)).toEqual(['./music/types'])
    expect(staticSpecifiers(`import Default from './music/types'`)).toEqual(['./music/types'])
    expect(staticSpecifiers(`import * as m from './music/types'`)).toEqual(['./music/types'])
  })

  it('SKIPS a type-only import — it is erased and cannot put a byte in a bundle', () => {
    expect(staticSpecifiers(`import type { Piece } from './music/types'`)).toEqual([])
    expect(staticSpecifiers(`export type { Piece } from './music/types'`)).toEqual([])
  })

  it('still flags the INLINE type form — it can emit a runtime import, so do not guess', () => {
    // `import { type X, y }` keeps a real import for `y`; and even all-type inline specifiers are
    // config-dependent. The conservative direction is the one that keeps the guard honest.
    expect(staticSpecifiers(`import { type Piece, newPiece } from './music/types'`))
      .toEqual(['./music/types'])
    expect(staticSpecifiers(`import { type Piece } from './music/types'`)).toEqual(['./music/types'])
  })

  it('is not fooled by the word "type" in a binding name', () => {
    expect(staticSpecifiers(`import { typeOf } from './music/types'`)).toEqual(['./music/types'])
    expect(staticSpecifiers(`import type_ from './music/types'`)).toEqual(['./music/types'])
  })
})

// ─── guard 1: the static import graph (ALWAYS runs) ──────────────────────────────────────────

describe('the editor bundle is untouched by the music module', () => {
  const EDITOR_ENTRY = join(APP, 'routes/home.tsx')

  it('has an editor entry to check (the walker is pointed at something real)', () => {
    // A walker aimed at a missing file would return an empty graph, and every assertion below would
    // pass while checking nothing at all.
    expect(existsSync(EDITOR_ENTRY)).toBe(true)
    const { files } = staticGraph(EDITOR_ENTRY)
    expect(files.size).toBeGreaterThan(20)                       // it really did traverse
    expect([...files].some(f => f.includes('/editor/'))).toBe(true) // and reached the editor
  })

  it('reaches ONLY the cheap flag from the editor — never the panel, studio or OSMD', () => {
    // THE TOOLBAR'S MUSIC SLOT reads `musicEnabled()` (via editor/toolbarContract) to decide whether
    // the ♪ slot is live, exactly as it reads `prodLedgerEnabled()` for the clock. That flag lives
    // under src/music/, so the editor statically reaches `src/music/flag.ts` — and ONLY it. flag.ts is
    // a leaf with zero imports and a few hundred bytes.
    //
    // NB the MUSIC BAR itself (components/MusicBar.tsx, feat/music-layer 2026-07-18 — the `/music`
    // route was retired) reads the two demo flags + the type ramp AND `lazy(() => import(...))`s the
    // two heavy panels, but it sits BEHIND the dynamic TiptapEditor import (routes/Edit.tsx loads the
    // editor with `import()`), so NONE of MusicBar's imports enter the editor's static graph. That
    // laziness is instead guarded directly on MusicBar below ("the music BAR defers its panels") and
    // by the real built chunks (guard 2). Here the exact allow-list stays a single leaf: any heavier
    // music file reached from the editor's STATIC path lengthens this array and FAILS.
    const { files } = staticGraph(EDITOR_ENTRY)
    expect(musicFiles(files)).toEqual(['src/music/flag.ts'])
  })

  it('never pulls opensheetmusicdisplay into the editor', () => {
    const { packages } = staticGraph(EDITOR_ENTRY)
    expect([...packages]).not.toContain('opensheetmusicdisplay')
  })

  it('PROVES the walker can SEE a music import (the negative fires)', () => {
    // Without this, "no music in the editor" might be true because the walker cannot find music
    // imports at all — the check would be structurally incapable of failing. Point it at the music
    // route, which certainly does import them, and require it to notice.
    const { files, packages } = staticGraph(join(SRC, 'music/MusicPanel.tsx'))
    expect(musicFiles(files).length).toBeGreaterThan(3)
    expect([...packages]).toContain('opensheetmusicdisplay')
  })
})

describe('the music BAR defers its panels — the surface is a panel over the editor, not a route', () => {
  // `/music` was retired 2026-07-18 (feat/music-layer): the music module opens from the toolbar's ♪
  // BAR LAYER as a panel over the editor. `components/MusicBar.tsx` is the new lazy boundary — it is
  // statically imported by TiptapEditor, so if it statically imported a heavy panel, the whole music
  // chunk would land in the editor's load. It must `lazy(() => import(...))` both panels.
  const BAR = join(SRC, 'components/MusicBar.tsx')

  it('has a music bar to check (pointed at something real)', () => {
    expect(existsSync(BAR)).toBe(true)
  })

  it('DEFERS the import — a separate chunk is not evidence of laziness', () => {
    // THE TRAP, and it is live in this repo: `routes/Edit.tsx` line ~25 does
    //     const tiptapEditorImport = typeof window !== 'undefined' ? import('../editor/TiptapEditor') : null
    // — an `import()` INVOKED at module scope. That still produces its own chunk, and the chunk is
    // still fetched on every load, because evaluating the module fires the promise. A lane shipped
    // 16 kB gzip onto every writer's load path this way while truthfully reporting "it has its own
    // chunk". Chunk-existence and laziness are different claims.
    //
    // `lazy(() => import(...))` is different in kind: the import lives inside a THUNK React does not
    // call until the component renders. So the test is not "is there an import()?" but "is every
    // import() inside an arrow".
    const code = readFileSync(BAR, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    for (const m of code.matchAll(/import\s*\(\s*['"]\.\.\/music\/[^'"]+['"]\s*\)/g)) {
      const before = code.slice(0, m.index)
      // The nearest thing to the left must be a thunk arrow, not `=` / `?` / `:` at statement level.
      expect(before, `import() at ${m[0]} must sit inside a lazy(() => …) thunk`).toMatch(/\(\s*\)\s*=>\s*$/)
    }
  })

  it('keeps the two paths in SEPARATE chunks — neither pays for the other', () => {
    // The photo path must not ship OSMD (338 kB gzip) and the MusicXML path must not ship the
    // reflow detector. One bar, two lazy imports.
    const code = readFileSync(BAR, 'utf8')
    const dyn = dynamicSpecifiers(code)
    expect(dyn).toContain('../music/MusicStudio')
    expect(dyn).toContain('../music/MusicPanel')
    expect(staticSpecifiers(code)).not.toContain('../music/MusicPanel')
    expect(staticSpecifiers(code)).not.toContain('../music/MusicStudio')
  })

  it('loads the panel through a dynamic import', () => {
    const code = readFileSync(BAR, 'utf8')
    expect(dynamicSpecifiers(code)).toContain('../music/MusicPanel')
    // ...and NOT statically, which is the one-character mistake this whole file exists to catch.
    expect(staticSpecifiers(code)).not.toContain('../music/MusicPanel')
  })
})

describe('opensheetmusicdisplay has exactly one importer', () => {
  it('is imported by exactly one SHIPPING module — ScoreView', () => {
    // One importer = one place that can accidentally get pulled into a shared chunk, and one place
    // to change if the engine is ever swapped (Verovio was the live alternative).
    //
    // Test files are excluded because they do not ship — `ScoreView.test.tsx` imports the package to
    // read its own vi.mock back, which cannot affect any bundle. The exclusion is narrow (a `.test.`
    // segment) rather than a blanket ignore, so a real module named e.g. `scoreLoader.ts` could
    // never hide behind it.
    const importers: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) { walk(full); continue }
        if (!/\.tsx?$/.test(entry.name)) continue
        if (/\.test\.tsx?$/.test(entry.name)) continue
        const code = readFileSync(full, 'utf8')
        if ([...staticSpecifiers(code), ...dynamicSpecifiers(code)].includes('opensheetmusicdisplay')) {
          importers.push(rel(full))
        }
      }
    }
    walk(SRC)
    expect(importers).toEqual(['src/music/ScoreView.tsx'])
  })
})

// ─── guard 2: the real built chunks (only when a build is present) ───────────────────────────

const ASSETS = join(ROOT, 'build/client/assets')
const built = existsSync(ASSETS)

describe.skipIf(!built)('the built chunks (verified against real build output)', () => {
  const chunks = () => readdirSync(ASSETS).filter(f => f.endsWith('.js'))
  const containsOsmd = (f: string) =>
    readFileSync(join(ASSETS, f), 'utf8').includes('OpenSheetMusicDisplay')

  it('puts OSMD in exactly ONE chunk', () => {
    const carrying = chunks().filter(containsOsmd)
    expect(carrying).toHaveLength(1)
    expect(carrying[0]).toMatch(/^MusicPanel-/)
  })

  it('keeps OSMD out of the entry chunk', () => {
    // The entry is the file every visitor loads. OSMD in here = 338 kB on every first paint. This is
    // the load-bearing guard now that the music surface opens from the editor's own toolbar (there is
    // no separate `/music` route chunk any more — MusicBar is small and rides the editor graph, its
    // heavy panels sit in their own lazy chunks).
    const entries = chunks().filter(f => /^(index|entry|root)-/.test(f))
    expect(entries.length).toBeGreaterThan(0)
    for (const e of entries) expect(containsOsmd(e)).toBe(false)
  })
})
