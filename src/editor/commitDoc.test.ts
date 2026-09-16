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

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
const CODE = strip(readFileSync(resolve(__dirname, 'TiptapEditor.tsx'), 'utf8'))
// THE MOVED HALF (2026-09-15). The toolbar slot customisation left TiptapEditor.tsx for
// useToolbarSlots.ts and took a caller of commitDoc with it (`updateSlots`). A guard that scans only
// the file the text LEFT is green forever — measured: with the longhand triple pasted into the hook,
// the un-re-pointed guard stayed 4/4 green — so the hook is scanned here too.
const HOOK = strip(readFileSync(resolve(__dirname, 'useToolbarSlots.ts'), 'utf8'))
  // Seam 2 (same day): the cloud-sync orchestration left for useCloudSync.ts holding `docRef` — a
  // hook with docRef in hand is exactly where the triple could be re-inlined. Measured before this
  // line existed: the triple planted in useCloudSync.ts left this guard 4/4 green.
  + '\n' + strip(readFileSync(resolve(__dirname, 'useCloudSync.ts'), 'utf8'))
// SEAM 3 (2026-09-16): `commitDoc` ITSELF moved to useSaveOrchestration.ts, so its body is located
// THERE now, and that file is scanned for a second triple like the others. Measured first: with the
// editor rewired and this file un-re-pointed, 3 of 4 went red (the body could not be located).
const SAVE = strip(readFileSync(resolve(__dirname, 'useSaveOrchestration.ts'), 'utf8'))

/** The longhand triple, at any indent: the shape `commitDoc` replaced. */
const TRIPLE = /docRef\.current = (\w+)\n\s*onDocChange\(\1\)\n\s*scheduleSave\(\1\)/g

/** `commitDoc`'s own body IS the triple — that is the point of it. Scan everything else. */
const COMMIT_DOC = /const commitDoc = \([^)]*\) => \{[\s\S]*?\n  \}/.exec(SAVE)?.[0] ?? ''
const ELSEWHERE = CODE + '\n' + HOOK + '\n' + SAVE.replace(COMMIT_DOC, '')

describe('the editor commits a document mutation through exactly one path', () => {
  // VOID GUARD. Every assertion below is about a file this test located by path and stripped. If the
  // strip ever ate the file, or the path moved, "no violations" would be true and meaningless.
  it('the scan found the file and it still contains the things it reasons about', () => {
    expect(CODE.length).toBeGreaterThan(50_000)
    expect(SAVE).toContain('const commitDoc =')
    expect(CODE).toContain('scheduleSave') // the autosave beat and the goals write still schedule from the editor
    expect(CODE).toContain('commitDoc(updated)') // ...and the editor still commits through the hook's path
    // If this regex ever stops matching, ELSEWHERE silently becomes the whole file and the triple
    // test starts failing on the definition — loud, but for the wrong reason. Pin it here instead.
    expect(COMMIT_DOC, 'commitDoc body not located — the triple scan would be mis-scoped').not.toBe('')
    // ...and the moved half is really being scanned: it is a real file that really calls the one path.
    expect(HOOK.length).toBeGreaterThan(5_000)
    expect(HOOK).toContain('commitDoc(updated)')
    expect(HOOK).toContain('function mirrorIfActive()') // ...and the cloud-sync half is really in the scan
    expect(SAVE.length).toBeGreaterThan(5_000)
    expect(SAVE).toContain('function ensureDocFresh(): InkwaveDocument {') // ...and the save half
  })

  it('the longhand triple appears NOWHERE — commitDoc is the only path', () => {
    const hits = [...ELSEWHERE.matchAll(TRIPLE)]
    expect(hits.map((h) => h[0]), `re-inlined at ${hits.length} site(s); call commitDoc instead`)
      .toEqual([])
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
    const calls = [...(CODE + '\n' + HOOK + '\n' + SAVE).matchAll(/[^.\w]onDocChange\(/g)]
    expect(calls.length, 'a third caller is either a missing scheduleSave or a new exception to document')
      .toBe(2)
  })
})
