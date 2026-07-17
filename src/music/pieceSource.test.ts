// @vitest-environment jsdom
//
// `PieceSource.xml_ref` names a MASTER, not a Piece asset (§B6: "stored ONCE ... deduplicated").
// The photo lane left the question open rather than guessing; this is the lane that owns the field
// answering it, and pinning the answer.
//
// THE BUG THIS EXISTS TO CATCH IS SILENT. Both `AssetRef` and `MasterRef` are `string` aliases, so
// `getAsset(piece.id, source.xml_ref)` COMPILES. It resolves a per-piece path, finds nothing, and
// returns `null` — which surfaces as "this score has no notation", with no error, on exactly the
// Pieces that came in through the MusicXML path. There is no type error to catch it and no
// exception to trace: the wrong store simply answers "empty" instead of "wrong question".
//
// So the guard is structural, over the real source. It cannot be a runtime test — the mistake's
// whole character is that it runs fine.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DIR = __dirname
const sources = () =>
  readdirSync(DIR).filter(f => /\.tsx?$/.test(f) && !f.includes('.test.'))

describe('xml_ref is resolved through the MASTER store, never the asset store', () => {
  it('found sources to check (the probe is real)', () => {
    // A sweep over an empty list passes while checking nothing.
    expect(sources().length).toBeGreaterThan(5)
    expect(sources()).toContain('master.ts')
  })

  it('no call site passes an xml_ref to getAsset', () => {
    for (const file of sources()) {
      const src = readFileSync(join(DIR, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      // getAsset(<anything>, <anything named *xml_ref*>) — the exact wrong-store call.
      expect(src, `${file} routes an xml_ref through the Piece asset store`)
        .not.toMatch(/getAsset\s*\([^)]*xml_ref/)
    }
  })

  it('PROVES the detector fires — it must catch the call it exists to catch', () => {
    // "no match in any file" is the easiest assertion in testing to satisfy by accident.
    const wrong = 'const xml = await getAsset(piece.id, piece.source.xml_ref)'
    expect(wrong).toMatch(/getAsset\s*\([^)]*xml_ref/)
    // ...and must NOT fire on the right call.
    const right = 'const xml = await loadMasterXml(piece.source.xml_ref)'
    expect(right).not.toMatch(/getAsset\s*\([^)]*xml_ref/)
  })

  it('documents xml_ref as a MasterRef, not an AssetRef', () => {
    // The naming IS the warning, since the compiler cannot give one (both are string aliases). If
    // someone retypes it back to AssetRef, that is the moment the wrong-store call becomes natural.
    const types = readFileSync(join(DIR, 'types.ts'), 'utf8')
    expect(types).toMatch(/xml_ref:\s*MasterRef/)
    expect(types).toMatch(/export type MasterRef/)
  })
})

describe('the two stores stay distinct', () => {
  it('the master store is cross-document, the asset store is per-piece', () => {
    // Load-bearing and easy to erode: masters are shared and content-deduplicated (two Pieces of the
    // same public-domain score share ONE master), and a master OUTLIVES any one Piece — which is what
    // makes §B6's "fix the master, every excerpt updates" possible at all. Assets are per-piece and
    // die with it.
    const master = readFileSync(join(DIR, 'master.ts'), 'utf8')
    const store = readFileSync(join(DIR, 'store.ts'), 'utf8')

    // The master store never keys a path by pieceId...
    expect(master).not.toMatch(/pieceId/)
    // ...and the asset store always does.
    expect(store).toMatch(/assetPath\(\s*pieceId/)
  })
})
