// @vitest-environment jsdom
//
// THE ANTI-OVERWRITE FREEZE — the byte-level half of the single-open "Take over here" handoff, and
// the thing that makes it safe rather than a comment. When a tab surrenders a document, nothing it
// does may persist a new body for that id; otherwise the take-over reproduces the exact blind
// overwrite (2026-07-15) that the single-open lock exists to prevent.
//
// A GREEN GATE IS NOT A GUARD (CLAUDE.md): this pins the freeze in ~20ms with no browser, so a future
// edit that quietly drops it fails HERE, not six weeks later in someone's thesis. Every assertion is
// MUTATION-PROVED — the mutation that would reintroduce the bug is named, and it kills a listed test:
//   · delete `if (frozenDocIds.has(doc.id)) throw` in saveDocument
//        ⇒ "a frozen document refuses saveDocument", "unfreeze restores writes", and
//          "the autosave beat stays quiet on a frozen document" all fail.
//   · delete the early return `if (… frozenDocIds.has(doc.id)) return` in scheduleSave
//        ⇒ "scheduleSave drops a frozen plain document" fails (a frozen body ends up pending).
//   · delete `if (err instanceof DocWriteFrozenError) return` in the autosave beat
//        ⇒ "the autosave beat stays quiet on a frozen document" fails (it fires save-failed).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  saveDocument, scheduleSave, flushPendingSave,
  freezeDocWrites, unfreezeDocWrites, isDocWriteFrozen, DocWriteFrozenError,
  emptyTiptapDoc,
} from './opfs'
import type { InkwaveDocument } from '../types/document'

function docWith(id: string): InkwaveDocument {
  const now = new Date().toISOString()
  return {
    id, title: 'T', contentJson: emptyTiptapDoc(), createdAt: now, updatedAt: now,
    schemaVersion: '0.1.0', scasLimitN: 'infinite', scasSessionSeed: 's',
  }
}

// A single-use id per test keeps the module-global frozen set from leaking between cases.
let n = 0
function freshId(): string { return `doc-freeze-${n++}` }

// Clear anything a previous test may have left pending in the module-global save state.
beforeEach(async () => { try { await flushPendingSave() } catch { /* storage absent in jsdom — fine */ } })

describe('the single-open write freeze', () => {
  it('a frozen document refuses saveDocument (loudly, with a distinct error)', async () => {
    const id = freshId()
    freezeDocWrites(id)
    expect(isDocWriteFrozen(id)).toBe(true)
    await expect(saveDocument(docWith(id))).rejects.toBeInstanceOf(DocWriteFrozenError)
  })

  it('an unfrozen document is NOT refused by the freeze (it gets past the gate)', async () => {
    const id = freshId()
    expect(isDocWriteFrozen(id)).toBe(false)
    // jsdom has no navigator.storage, so the real write fails AFTER the gate — but with a storage
    // error, never DocWriteFrozenError. That is exactly the discrimination that matters: the freeze
    // must gate ONLY frozen ids.
    await expect(saveDocument(docWith(id))).rejects.not.toBeInstanceOf(DocWriteFrozenError)
  })

  it('unfreeze restores writes (the gate is per-id and reversible)', async () => {
    const id = freshId()
    freezeDocWrites(id)
    await expect(saveDocument(docWith(id))).rejects.toBeInstanceOf(DocWriteFrozenError)
    unfreezeDocWrites(id)
    expect(isDocWriteFrozen(id)).toBe(false)
    await expect(saveDocument(docWith(id))).rejects.not.toBeInstanceOf(DocWriteFrozenError)
  })

  it('scheduleSave drops a frozen plain document (nothing is left pending to flush)', async () => {
    const id = freshId()
    freezeDocWrites(id)
    scheduleSave(docWith(id))
    // The frozen body must never become the pending save — if it did, flush would try to write it.
    await expect(flushPendingSave()).resolves.toBe(false)
  })

  it('the autosave beat stays quiet on a frozen document (a chosen read-only, not a failure)', async () => {
    vi.useFakeTimers()
    const id = freshId()
    freezeDocWrites(id)
    const failed = vi.fn()
    window.addEventListener('inkwave:save-failed', failed)
    // A THUNK is not evaluated by scheduleSave, so it slips past the plain-doc gate and reaches the
    // beat — where saveDocument throws DocWriteFrozenError and the beat must swallow it silently.
    scheduleSave(() => docWith(id))
    await vi.advanceTimersByTimeAsync(1000)
    window.removeEventListener('inkwave:save-failed', failed)
    expect(failed).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

afterEach(() => { for (let i = 0; i < n; i++) unfreezeDocWrites(`doc-freeze-${i}`) })
