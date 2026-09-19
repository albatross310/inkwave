// ONE COMMIT PATH FOR A DOCUMENT MUTATION — ~5ms, no browser.
//
// WHY THIS FILE EXISTS. A document mutation in TiptapEditor must do three things in one order:
// update `docRef`, call `onDocChange`, call `scheduleSave`. That was written out longhand at nine
// call sites. Omitting the third line is SILENT — the edit appears on screen and the parent
// re-renders; only the DISK is stale, so the work is lost at the next reload rather than at the
// moment of the mistake. It has happened: a header edit never called `scheduleSave`, because
// autosave is driven by the editor's own update handler and a header field never fires it, and the
// headers vanished on reload. `email.prove.mjs` caught it — a browser probe, hand-run.
//
// So this is the cheap unit-level half. `commitDoc` is now the only path, and this asserts the
// longhand triple cannot come back. It cannot check behaviour (that needs the browser); it checks
// the SHAPE that made the behaviour go wrong.
//
// ⚠ COMMENTS ARE STRIPPED BEFORE SCANNING. The comment on `commitDoc` NAMES the three calls in order
// to explain why they belong together, and the call site at the EmailComposePanel explains the bug
// by describing the write shape. A guard reading raw text fires on its own documentation, and the
// tempting fix is to delete the sentence — the failure CLAUDE.md records biting three lanes in one
// round. Judge what the code DOES.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ⚠ THE SCAN FOLLOWS THE CODE OUT OF THE FILE (2026-09-19). This guard used to read TiptapEditor.tsx
//   alone, which was the whole component. Seam 1 moved the toolbar slot write-back into
//   useToolbarSlots.ts, and that hook calls `commitDoc` — so the moment it moved, a re-inlined
//   triple THERE became invisible to this guard while every assertion here stayed green. A
//   path-keyed guard does not fail when its subject moves; it silently narrows, which is the one
//   failure mode a refactor must never leave behind. Every seam split out of the component adds its
//   file here, and `strip()` is shared so a new file cannot arrive unstripped.
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
const read = (f: string) => strip(readFileSync(resolve(__dirname, f), 'utf8'))
/** The component. `commitDoc` is DEFINED here. */
const CODE = read('TiptapEditor.tsx')
/** Seams split out of the component that CALL commitDoc. Add a file when a seam lands. */
const SEAMS: Record<string, string> = { 'useToolbarSlots.ts': read('useToolbarSlots.ts') }

/** The longhand triple, at any indent: the shape `commitDoc` replaced. */
const TRIPLE = /docRef\.current = (\w+)\n\s*onDocChange\(\1\)\n\s*scheduleSave\(\1\)/g

/** `commitDoc`'s own body IS the triple — that is the point of it. Scan everything else. */
const COMMIT_DOC = /const commitDoc = \([^)]*\) => \{[\s\S]*?\n  \}/.exec(CODE)?.[0] ?? ''
const ELSEWHERE = CODE.replace(COMMIT_DOC, '')

describe('TiptapEditor commits a document mutation through exactly one path', () => {
  // VOID GUARD. Every assertion below is about a file this test located by path and stripped. If the
  // strip ever ate the file, or the path moved, "no violations" would be true and meaningless.
  it('the scan found the file and it still contains the things it reasons about', () => {
    expect(CODE.length).toBeGreaterThan(50_000)
    expect(CODE).toContain('const commitDoc =')
    expect(CODE).toContain('scheduleSave')
    // If this regex ever stops matching, ELSEWHERE silently becomes the whole file and the triple
    // test starts failing on the definition — loud, but for the wrong reason. Pin it here instead.
    expect(COMMIT_DOC, 'commitDoc body not located — the triple scan would be mis-scoped').not.toBe('')
  })

  it('the longhand triple appears NOWHERE — commitDoc is the only path', () => {
    const hits = [...ELSEWHERE.matchAll(TRIPLE)]
    expect(hits.map((h) => h[0]), `re-inlined at ${hits.length} site(s); call commitDoc instead`)
      .toEqual([])
  })

  // The same question asked of every seam split out of the component. A hook that took a document
  // mutation with it must still hand it to `commitDoc`, not rebuild the triple behind its own door.
  it.each(Object.keys(SEAMS))('the longhand triple appears nowhere in %s either', (file) => {
    const src = SEAMS[file]
    expect(src.length, `${file} scanned empty — the path moved and this guard proves nothing`)
      .toBeGreaterThan(1_000)
    const hits = [...src.matchAll(TRIPLE)]
    expect(hits.map((h) => h[0]), `${file} re-inlined the commit triple at ${hits.length} site(s)`)
      .toEqual([])
  })

  // ...and that it does hand it over at all. A seam that quietly stopped calling commitDoc would
  // pass the triple scan above by writing nothing, which is the louder half of the same bug.
  it.each(Object.keys(SEAMS))('%s reaches the disk through commitDoc', (file) => {
    expect(SEAMS[file]).toMatch(/commitDoc\(/)
  })

  it('commitDoc itself does all three, in order', () => {
    const body = COMMIT_DOC
    expect(body).toContain('docRef.current = updated')
    expect(body).toContain('onDocChange(updated)')
    expect(body).toContain('scheduleSave(updated)')
    expect(body.indexOf('onDocChange')).toBeGreaterThan(body.indexOf('docRef.current'))
    expect(body.indexOf('scheduleSave')).toBeGreaterThan(body.indexOf('onDocChange'))
  })

  // The ONE legitimate exception, pinned so it stays legitimate. The autosave completion callback
  // notifies a TITLE change after the write has already happened — calling scheduleSave there would
  // schedule a second save of what was just saved. It is not a mutation commit.
  it('only two places call onDocChange: commitDoc, and the post-save title notify', () => {
    const calls = [...CODE.matchAll(/[^.\w]onDocChange\(/g)]
    expect(calls.length, 'a third caller is either a missing scheduleSave or a new exception to document')
      .toBe(2)
  })
})
