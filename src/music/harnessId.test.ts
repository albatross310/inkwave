// ─── The /music harness's piece survives a reload ────────────────────────────
//
// THE DEFECT THIS PINS (live on this branch until 2026-07-17): MusicStudio's load effect read
// `loadPiece(HARNESS_ID)` but, on a miss, minted `newPieceDocument({ title }).piece!` — a FRESH uuid.
// The read key and the written key were different by construction, so `update()` saved the student's
// marks under a random id, the next load read HARNESS_ID, missed, and minted another one. The work
// was still on disk and ORPHANED, and one whole piece LEAKED into OPFS on every page load. The
// comment directly above it claimed "it opens a fixed well-known document" — a parity nobody checked.
//
// It is the SAME bug the lane's own live probe already caught on the DEMO branch ten lines up
// ("with a per-load uuid, reloading the demo minted a NEW piece — so every mark the student had just
// drawn was still on disk but orphaned under the old id"), reintroduced on the other branch of the
// same `if`. Nothing covered it: `music.prove.mjs` loads /music?music=1 only to assert the chunk is
// fetched, which a piece minted at the wrong id satisfies perfectly.
//
// WHY IT IMPORTS `loadOrMintHarnessPiece` RATHER THAN RE-TYPING THE EFFECT: a test that transcribes
// the code under test proves the tester can copy, not that the code is right — the transcription
// stays green while the real effect rots. The branch is exported for exactly this reason.
//
// HARNESS NOTE (store.test.ts's, verbatim, and it is load-bearing): `storage/opfsWrite.ts` decides
// ONCE AT MODULE LOAD whether writes use createWritable or the parse worker, and node has neither.
// Install the shim, THEN `await import()`.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installOpfsShim, resetOpfsShim } from '../email/testOpfsShim'

const HARNESS_ID = 'music-harness'

async function freshModules() {
  vi.resetModules()
  installOpfsShim()
  return {
    studio: await import('./MusicStudio'),
    store: await import('./store'),
  }
}

beforeEach(() => { vi.resetModules(); resetOpfsShim() })

describe('the /music harness path persists across a reload', () => {
  it('mints the piece AT the id it just read — not a fresh uuid', async () => {
    const { studio } = await freshModules()
    const piece = await studio.loadOrMintHarnessPiece()
    // The whole defect in one assertion: the id must come from the same constant the read used.
    expect(piece.id).toBe(HARNESS_ID)
    expect(studio.HARNESS_ID).toBe(HARNESS_ID)
  })

  it('what the student drew is still there on load 2', async () => {
    const { studio, store } = await freshModules()

    // Load 1 — the studio opens, misses, mints.
    const piece1 = await studio.loadOrMintHarnessPiece()
    // The student draws. `update()` does exactly this: savePiece(next), keyed on next.id.
    await store.savePiece({ ...piece1, title: 'Student work' })

    // Load 2 — reload. Same code, same well-known key.
    const piece2 = await studio.loadOrMintHarnessPiece()
    expect(piece2.title).toBe('Student work')
    expect(piece2.id).toBe(HARNESS_ID)
  })

  it('LEAK: a reload does not strand a second piece in OPFS', async () => {
    // The other half of the demo-branch incident, and the half an id assertion alone would miss: a
    // per-load uuid leaks one whole piece (its page images included) into the user's storage EVERY
    // time the page loads. Three loads must touch exactly one document.
    const { studio, store } = await freshModules()
    const opfs = await import('../storage/opfs')

    for (let i = 0; i < 3; i++) {
      const p = await studio.loadOrMintHarnessPiece()
      await store.savePiece({ ...p, title: `load ${i}` })
    }

    expect(await opfs.listDocumentIds()).toEqual([HARNESS_ID])
  })
})
