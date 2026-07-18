// The photo→score creation flow's REFUSALS and title rule, pinned cheaply (no browser).
//
// The happy path (decode → detect → OPFS → savePiece) needs a canvas, OPFS and IndexedDB, so it is
// proved by the live probe (music.prove.mjs), not here. What a unit test CAN keep true — and what a
// silent regression would quietly break — is that the flow REFUSES rather than guesses: a non-photo
// must never reach the pipeline, and the title must normalise so doc.title, piece.title and the
// document-list row can never disagree. Each guard is mutation-proved in its assertion below.

import { describe, expect, it } from 'vitest'
import { canBecomeScore, createPieceFromPhoto, titleFromAsset } from './fromPhoto'
import type { MediaAsset } from '../media/types'

const asset = (over: Partial<MediaAsset> = {}): MediaAsset => ({
  id: 'a1',
  kind: 'photo',
  mime: 'image/jpeg',
  name: 'scan.jpg',
  size: 1234,
  addedAt: '2026-07-18T00:00:00.000+10:00',
  ...over,
})

describe('canBecomeScore — only a photo has geometry to detect', () => {
  it('accepts a photo and refuses audio/video', () => {
    expect(canBecomeScore(asset({ kind: 'photo' }))).toBe(true)
    expect(canBecomeScore(asset({ kind: 'audio' }))).toBe(false)
    expect(canBecomeScore(asset({ kind: 'video' }))).toBe(false)
  })
})

describe('titleFromAsset — one normalised string for both places it is read', () => {
  it('strips the extension', () => {
    expect(titleFromAsset({ name: 'Prelude in C.png' })).toBe('Prelude in C')
    expect(titleFromAsset({ name: 'IMG_1234.jpeg' })).toBe('IMG_1234')
  })
  it('falls back to Untitled piece for a blank or extension-only name', () => {
    expect(titleFromAsset({ name: '' })).toBe('Untitled piece')
    expect(titleFromAsset({ name: '.png' })).toBe('Untitled piece')
    expect(titleFromAsset({ name: '   ' })).toBe('Untitled piece')
  })
})

describe('createPieceFromPhoto — refuses a non-photo BEFORE any store touch', () => {
  it('returns ok:false for audio, with the honest reason', async () => {
    // Returns at the guard, so this needs no OPFS/canvas — and that is the point: a non-photo must
    // never reach loadMedia/capturePage. If the guard is removed, this resolves to ok:true (or throws
    // reaching the pipeline), so the assertion is load-bearing.
    const res = await createPieceFromPhoto(asset({ kind: 'audio' }))
    expect(res).toEqual({ ok: false, reason: 'Only a photo can become a score.' })
  })
})
