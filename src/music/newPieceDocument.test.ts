// ─── One title, one definition ───────────────────────────────────────────────
//
// WHY THIS FILE EXISTS (2026-07-17). `withPieceTitle` and `isPieceDocument` had ZERO CALLERS and zero
// tests. The auditor mutated BOTH to garbage and all 1728 tests stayed green — the repo could not
// tell the difference between these functions working and these functions not existing. Untouched
// code that has never run is a plan, not a feature.
//
// Both now have live callers (`savePiece` / `loadPiece` in store.ts). These tests pin the RULES; the
// store's own tests pin that the store actually routes through them. Both halves are needed: a rule
// with no caller is decoration, and a caller whose rule is untested is a guess.

import { describe, expect, it } from 'vitest'
import { isPieceDocument, newPieceDocument, withPieceTitle } from './newPieceDocument'
import type { InkwaveDocument } from '../types/document'

describe('withPieceTitle keeps doc.title and piece.title the SAME STRING', () => {
  it('sets both from one normalised value', () => {
    const doc = newPieceDocument({ title: 'Nocturne' })
    const out = withPieceTitle(doc, 'Nocturne, revised')
    expect(out.title).toBe('Nocturne, revised')
    expect(out.piece?.title).toBe('Nocturne, revised')
    expect(out.piece?.title).toBe(out.title)   // the invariant, stated as itself
  })

  it('trims — and the trimmed value goes to BOTH', () => {
    const out = withPieceTitle(newPieceDocument({ title: 'x' }), '  Nocturne  ')
    expect(out.title).toBe('Nocturne')
    expect(out.piece?.title).toBe('Nocturne')
  })

  it('a BLANK title reads "Untitled piece" in both places — not blank in one of them', () => {
    // THE CASE THE OLD CODE GOT WRONG, and the only input where the question is interesting. It set
    // doc.title = 'Untitled piece' while leaving piece.title = '' — the one function whose job is
    // keeping them equal, making them disagree. Whitespace-only must go the same way as ''.
    for (const blank of ['', '   ', '\t\n']) {
      const out = withPieceTitle(newPieceDocument({ title: 'Had a title' }), blank)
      expect(out.title, `doc.title for ${JSON.stringify(blank)}`).toBe('Untitled piece')
      expect(out.piece?.title, `piece.title for ${JSON.stringify(blank)}`).toBe('Untitled piece')
      expect(out.piece?.title).toBe(out.title)
    }
  })

  it('agrees with newPieceDocument — one rule, not two that happen to look alike', () => {
    // These are the two places a title is normalised. If they ever drift, a blank-titled piece is
    // called one thing when it is created and another the moment it is renamed.
    for (const t of ['', '   ', 'Nocturne', '  Nocturne  ']) {
      const minted = newPieceDocument({ title: t })
      const renamed = withPieceTitle(newPieceDocument({ title: 'anything' }), t)
      expect(renamed.title, `title ${JSON.stringify(t)}`).toBe(minted.title)
      expect(renamed.piece?.title).toBe(minted.piece?.title)
    }
  })

  it('leaves a non-Piece document’s body alone', () => {
    const essay = { docType: 'essay', title: 'An essay' } as unknown as InkwaveDocument
    const out = withPieceTitle(essay, 'Renamed')
    expect(out.title).toBe('Renamed')
    expect(out.piece).toBeUndefined()   // no piece invented on a document that has none
  })
})

describe('isPieceDocument is the ONE definition of "is this a Piece?"', () => {
  it('true only for docType music WITH a piece on it', () => {
    expect(isPieceDocument(newPieceDocument({ title: 'Nocturne' }))).toBe(true)
  })

  it('ABSENCE IS NOT A MUSIC DOCUMENT — docType music with no piece is false', () => {
    // The half the name does not say and the comment does. A document that claims to be music but
    // carries no Piece is a broken document, not a Piece — reading `piece!` off it is the crash.
    expect(isPieceDocument({ docType: 'music', piece: undefined })).toBe(false)
  })

  it('false for an essay, with or without a stray piece', () => {
    expect(isPieceDocument({ docType: 'essay', piece: undefined })).toBe(false)
    const stray = newPieceDocument({ title: 'x' }).piece
    expect(isPieceDocument({ docType: 'essay', piece: stray })).toBe(false)
  })
})
