// THE EDITOR'S HALF OF THE SAVE SEAM — ~5ms, no browser.
//
// WHY THIS FILE EXISTS. "Saving" is ONE mechanism in TWO files: the commit path, the lazy rebuild
// and the snapshot queue live in `useSaveOrchestration.ts`; the autosave BEAT (inside the editor's
// `onUpdate`, behind the docChanged gate), the two writers that decide WHEN to snapshot (the
// paragraph trigger and the word-nudge effect), `recoverAndPurge`, and every control that reaches
// the queue (◈ save version, check Bitcoin, the email's "Snapshot this draft", ⋮ export/save) are in
// `TiptapEditor.tsx`. A hook can be green in its own harness while the real editor quietly stops
// marking the document stale, or a paragraph snapshot stops riding the queue — and the record would
// fall behind the writing, silently, with every unit test green. This pins the editor's side: the
// wiring the hook's own tests cannot see.
//
// WRITTEN BEFORE THE MOVE (2026-09-16, docs/REFACTOR-QUEUE.md item 3, seam 3), against the unmoved
// TiptapEditor.tsx, and every assertion held there first. It stays pointed at TiptapEditor.tsx
// afterwards because none of this text moved — only the state, the functions and two effects did.
//
// ⚠ COMMENTS ARE STRIPPED BEFORE SCANNING. The comments beside these lines NAME the identifiers
// ("autosave is driven by the editor's own update handler"), so a raw-text scan would pass on prose
// alone. Judge what the code DOES.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SRC = readFileSync(resolve(__dirname, 'TiptapEditor.tsx'), 'utf8')
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

describe('the editor wires save orchestration', () => {
  // VOID GUARD. Every assertion below is about a file located by path and stripped. If the strip ate
  // the file or the path moved, "does not contain Y" would be TRUE and meaningless. Pin that the scan
  // is looking at the editor.
  it('the scan found the editor', () => {
    expect(CODE.length).toBeGreaterThan(50_000)
    expect(CODE).toContain('<ReceiptPanel')
    expect(CODE).toContain('ensureDocFresh')
  })

  // THE AUTOSAVE BEAT. Inside `onUpdate`, after the docChanged gate: the keystroke marks the document
  // STALE (no serialization on the keystroke — the console-snappy rule) and hands `scheduleSave` a
  // THUNK that rebuilds it at save time. The completion callback notifies a TITLE change only, and
  // refreshes the metadata index. Drop the stale mark and every save writes the previous keystroke.
  it('a docChanged transaction marks the document stale, then schedules a thunk that rebuilds it', () => {
    const gate = CODE.indexOf('if (!transaction.docChanged) return')
    expect(gate).toBeGreaterThan(0)
    const beat = /docStaleRef\.current = true[\s\S]*?scheduleSave\(\(\) => \{[\s\S]*?const d = ensureDocFresh\(\)[\s\S]*?\}, \(\) => \{[\s\S]*?onDocChange\(d\)[\s\S]*?void upsertMeta\(\{ id: d\.id, title: d\.title, updatedAt: d\.updatedAt \}\)/.exec(CODE)
    expect(beat, 'the autosave beat has changed shape').not.toBeNull()
    expect(beat!.index).toBeGreaterThan(gate)
  })

  // TWO THUNK SITES, unchanged by the move: the beat above and the ledger's goals write (a document
  // property persisted "through the editor's own autosave" — one writer, no race).
  it('exactly two places hand scheduleSave a thunk: the beat and the goals write', () => {
    expect([...CODE.matchAll(/scheduleSave\(\(\) =>/g)].length).toBe(2)
    expect(CODE).toContain('docRef.current = { ...ensureDocFresh(), goals: g }')
  })

  // THE PARAGRAPH TRIGGER rides the one queue: `enqueueSnapshotWork`, a 'paragraph' snapshot from
  // docRef, stamp, mirror — and it is DEFERRED to a quiet moment (Enter does no O(doc) work).
  it('the paragraph snapshot is deferred to a quiet moment and rides enqueueSnapshotWork', () => {
    expect(CODE).toMatch(/runWhenQuiet\(\(\) => \{\s*enqueueSnapshotWork\(async \(\) => \{\s*const snap = await createSnapshotIfChanged\(docRef\.current, 'paragraph'/)
    expect(CODE).toMatch(/createSnapshotIfChanged\(docRef\.current, 'paragraph'[\s\S]*?stampSnapshot\(snap\.documentId, snap\.id\)[\s\S]*?mirrorIfActive\(\)/)
  })

  // THE WORD-NUDGE WRITER reads the archive THROUGH the guard and ABORTS on null BEFORE it writes —
  // the R1 rule at the one writer that fires while the writer is not looking.
  it('the word-nudge snapshot reads through snapshotsForAction and aborts on null before it writes', () => {
    const block = /enqueueSnapshotWork\(async \(\) => \{\s*await runPeriodRef\.current\(\)[\s\S]*?\}\)\s*\}\)\s*return off/.exec(CODE)?.[0] ?? ''
    expect(block, 'word-nudge block not located').not.toBe('')
    const read = block.indexOf("const before = await snapshotsForAction('this snapshot')")
    const abort = block.indexOf('if (!before) return')
    const write = block.indexOf("createSnapshotIfChanged(docRef.current, 'word-nudge'")
    expect(read).toBeGreaterThan(-1)
    expect(abort).toBeGreaterThan(read)
    expect(write).toBeGreaterThan(abort)
  })

  // `recoverAndPurge` STAYS in TiptapEditor.tsx (Peter's rule), runs only at a quiet moment, and BAILS
  // on both of its archive reads rather than reason from a list it could not confirm.
  it('recoverAndPurge stays here, runs when quiet, and bails on either failed read', () => {
    const body = /const recoverAndPurge = async \(\) => \{[\s\S]*?\n      \}\n      runWhenQuiet\(\(\) => void recoverAndPurge\(\), 5000\)/.exec(CODE)?.[0] ?? ''
    expect(body, 'recoverAndPurge not located in TiptapEditor.tsx').not.toBe('')
    expect(body).toMatch(/const recoverRead = await readSnapshotArchive\(docId\)\s*if \(recoverRead\.kind === 'error'\) \{[^}]*return\s*\}/)
    expect(body).toMatch(/const afterRead = await readSnapshotArchive\(docId\)\s*if \(afterRead\.kind === 'error'\) \{[^}]*return\s*\}/)
    expect(body).not.toMatch(/deleteSnapshot/)
  })

  // THE CONTROLS reach the hook's actions by name — the ◈ panel, the email's snapshot, the ⋮ menu,
  // the ledger capture, and the two hooks that were handed save functions.
  it('every control is attached to the hook action of the same name', () => {
    for (const s of [
      'snapshots={snapshots}', 'onCheckBitcoin={checkBitcoin}', 'onOpened={runOtsSweep}', 'onSaveVersion={saveVersion}',
      'getCurrentDoc={ensureDocFresh}', 'onSnapshotDraft={createManualSnapshot}',
      'onExportBundle={exportBundle}', 'onSave={saveRecord}',
      'getDoc: () => ensureDocFresh()',
      'useCloudSync({ docRef, docId: doc.id, ensureDocFresh, snapshotsForAction, runWhenQuiet })',
      'useToolbarSlots({ docRef, commitDoc })',
    ]) expect(CODE, s).toContain(s)
    // The email header edit is the live instance of the commitDoc rule — it commits, nothing else.
    expect(CODE).toMatch(/onDocChange=\{\(updated\) => \{\s*commitDoc\(updated\)\s*\}\}/)
    // The pasted image's snapshot reports its failure to the writer rather than swallowing it.
    expect(CODE).toMatch(/const snapshot = await createManualSnapshot\(\)\s*if \(!snapshot\.snapshot\) \{\s*setFileOpenError/)
  })
})
