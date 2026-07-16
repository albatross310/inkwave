// @vitest-environment jsdom
//
// THE §B6 PROOF — "fix the master and every excerpt updates".
//
// This is the standout feature of the MusicXML path, and it has a failure mode with NO error
// message: an excerpt that COPIED the master's XML renders identically to one that REFERENCES it,
// and stays identical right up until the master is corrected — at which point the copy silently
// keeps showing the old, wrong bars. Nothing on screen would differ. This house's disease is
// exactly that: a check that cannot see its own failure (CLAUDE.md — sixteen of them).
//
// So the tests below are built to be able to FAIL:
//
//  1. They do not compare an excerpt to its master and call the match a success. Master and excerpt
//     are trivially identical under BOTH designs — that assertion passes by construction and proves
//     nothing about which design is in play.
//  2. They FIX THE MASTER and demand the excerpt change. That is the only assertion the copy design
//     cannot satisfy.
//  3. They carry a CONTROL — `CopiedExcerpt`, a deliberate copy-based implementation — through the
//     identical scenario, and require it to FAIL where the transclusion passes. A discriminating
//     negative: if the suite ever stops distinguishing the two, the control goes green and says so.
//  4. They inspect the SERIALISED record from outside the type system, where a smuggled copy would
//     actually live.

import { beforeEach, describe, expect, it } from 'vitest'
// node's spec-compliant Blob. jsdom replaces the global Blob with one that has NO arrayBuffer(),
// which real browsers and node both have — so the global here would fail the import path for a
// reason that exists only in the test environment.
import { Blob as NodeBlob } from 'node:buffer'
import { installOpfsShim, resetOpfsShim } from '../email/testOpfsShim'
import { PICKUP_SCORE, SIMPLE_SCALE, SIMPLE_SCALE_FIXED } from './scoreFixtures'

// Modules are imported DYNAMICALLY, after the shim is installed: `storage/opfsWrite.ts` decides ONCE
// AT MODULE LOAD whether writes go through createWritable or the parse worker, and node has neither.
// Import it early and every write silently becomes a no-op the test would read as "nothing saved".
type MusicMaster = typeof import('./master')
type MusicTransclusion = typeof import('./transclusion')
type MusicParse = typeof import('./parse')

let master: MusicMaster
let tx: MusicTransclusion
let parse: MusicParse

beforeEach(async () => {
  resetOpfsShim()
  installOpfsShim()
  master = await import('./master')
  tx = await import('./transclusion')
  parse = await import('./parse')
})

const blob = (s: string) => new NodeBlob([s], { type: 'application/xml' }) as unknown as Blob

/** Read the pitches an excerpt actually resolves to — what the reader would see and hear. */
function excerptMidis(resolved: import('./transclusion').ResolvedExcerpt): (number | undefined)[] {
  return resolved.score.parts[resolved.transclusion.partIndex].measures
    .filter(m => m.index >= resolved.fromIndex && m.index <= resolved.toIndex)
    .flatMap(m => m.notes.map(n => n.pitch?.midi))
}

/**
 * The pitches of ONE printed bar within a resolved excerpt.
 *
 * Also a guard: it asserts the bar is actually INSIDE the excerpt's resolved range. Reading a bar
 * the excerpt doesn't contain would otherwise return [] — and `expect([]).toEqual([])` is a test
 * that passes while measuring nothing.
 */
function barMidis(resolved: import('./transclusion').ResolvedExcerpt, printedBar: string): (number | undefined)[] {
  const measures = resolved.score.parts[resolved.transclusion.partIndex].measures
  const bar = measures.find(m => m.number === printedBar)
  if (!bar) throw new Error(`fixture has no bar ${printedBar}`)
  if (bar.index < resolved.fromIndex || bar.index > resolved.toIndex) {
    throw new Error(`bar ${printedBar} is outside the excerpt (${resolved.fromIndex}..${resolved.toIndex})`)
  }
  return bar.notes.map(n => n.pitch?.midi)
}

// ─── THE CONTROL: what §B6 forbids ───────────────────────────────────────────────────────────
// A copy-based excerpt: it snapshots the master's XML at insert time. This is the natural,
// tempting implementation ("just store the bars you need"), and the one the real design rejects.
// It exists here ONLY so the suite can demonstrate it can tell the two apart.
interface CopiedExcerpt { masterId: string; barStart: string; barEnd: string; xmlCopy: string }

async function makeCopiedExcerpt(masterId: string, barStart: string, barEnd: string): Promise<CopiedExcerpt> {
  const xml = await master.loadMasterXml(masterId)
  return { masterId, barStart, barEnd, xmlCopy: xml! }
}

function resolveCopied(excerpt: CopiedExcerpt): (number | undefined)[] {
  const score = parse.parseMusicXml(excerpt.xmlCopy)
  const from = parse.indicesOfPrintedBar(score, excerpt.barStart)[0]
  const to = parse.indicesOfPrintedBar(score, excerpt.barEnd)[0]
  return score.parts[0].measures
    .filter(m => m.index >= from && m.index <= to)
    .flatMap(m => m.notes.map(n => n.pitch?.midi))
}

// ─── the claim ───────────────────────────────────────────────────────────────────────────────

describe('§B6 — fixing the master updates every excerpt', () => {
  it('re-renders an excerpt from the CORRECTED master, and the copy control does not', async () => {
    const { meta } = await master.importMaster(blob(SIMPLE_SCALE), { fileName: 'scale.musicxml' })

    // An excerpt of bars 3-3 — the bar the student is about to discover is wrong.
    const excerpt = tx.makeTransclusion(meta.id, '3', '3')
    const copied = await makeCopiedExcerpt(meta.id, '3', '3')

    // Before the fix, BOTH designs agree. This is the assertion that proves nothing on its own —
    // it is here to demonstrate that the two are indistinguishable until the master moves.
    const before = await tx.resolveTransclusion(excerpt)
    expect(excerptMidis(before)).toEqual([71, 69, 67, 65])   // B natural
    expect(resolveCopied(copied)).toEqual([71, 69, 67, 65])  // identical — by construction

    // The student fixes the wrong note in MuseScore and re-imports (the score stays markup-only).
    await master.replaceMasterContent(meta.id, SIMPLE_SCALE_FIXED)

    // THE CLAIM: the SAME excerpt record, re-resolved, now shows the corrected bar.
    const after = await tx.resolveTransclusion(excerpt)
    expect(excerptMidis(after)).toEqual([70, 69, 67, 65])    // B FLAT — the fix propagated
    expect(excerptMidis(after)).not.toEqual(excerptMidis(before))

    // THE DISCRIMINATOR: the copy did NOT update. It still shows the wrong note, silently. If this
    // expectation ever fails, the suite has stopped being able to tell a reference from a copy and
    // every assertion above is worthless.
    expect(resolveCopied(copied)).toEqual([71, 69, 67, 65])
    expect(resolveCopied(copied)).not.toEqual(excerptMidis(after))
  })

  it('updates EVERY excerpt of a master, not just one', async () => {
    // §B6 says "every excerpt updates" — one excerpt updating could be luck of a single code path.
    // All three of these span bar 3, from different directions.
    const { meta } = await master.importMaster(blob(SIMPLE_SCALE))
    const excerpts = [
      tx.makeTransclusion(meta.id, '2', '3'),
      tx.makeTransclusion(meta.id, '3', '4'),
      tx.makeTransclusion(meta.id, '1', '4'), // the whole piece
    ]

    // Every one of them shows bar 3's original B natural first.
    for (const t of excerpts) {
      expect(barMidis(await tx.resolveTransclusion(t), '3')).toEqual([71, 69, 67, 65])
    }

    await master.replaceMasterContent(meta.id, SIMPLE_SCALE_FIXED)

    // ...and every one of them now shows the corrected B flat. Asserted on BAR 3 specifically, not
    // on the excerpt's whole pitch set: bar 2 legitimately contains a B natural of its own, so a
    // blanket "no 71 anywhere" would fail for reasons having nothing to do with the fix.
    for (const t of excerpts) {
      expect(barMidis(await tx.resolveTransclusion(t), '3')).toEqual([70, 69, 67, 65])
    }
  })

  it('keeps the master id stable across a fix — this is what excerpts hold onto', async () => {
    const { meta } = await master.importMaster(blob(SIMPLE_SCALE))
    const before = meta.contentHash
    const updated = await master.replaceMasterContent(meta.id, SIMPLE_SCALE_FIXED)

    expect(updated.id).toBe(meta.id)              // identity survives...
    expect(updated.contentHash).not.toBe(before)  // ...while content demonstrably moved
  })
})

describe('§B6 — a transclusion is a REFERENCE, not a copy', () => {
  it('stores no notation — checked on the serialised record, from outside the type system', async () => {
    const { meta } = await master.importMaster(blob(SIMPLE_SCALE))
    const excerpt = tx.makeTransclusion(meta.id, '2', '3')

    const json = JSON.stringify(excerpt)
    expect(json).not.toMatch(/<note|<pitch|score-partwise|<measure/i)
    expect(tx.isReferenceOnly(JSON.parse(json))).toBe(true)
    expect(Object.keys(excerpt).sort()).toEqual(
      ['barEnd', 'barStart', 'createdAt', 'id', 'masterId', 'partIndex'].sort(),
    )
  })

  it('PROVES the guard fires: isReferenceOnly rejects a smuggled copy', async () => {
    // A negative that cannot fail is not a negative. Feed it the exact thing it exists to catch.
    const { meta } = await master.importMaster(blob(SIMPLE_SCALE))
    const honest = tx.makeTransclusion(meta.id, '2', '3')
    expect(tx.isReferenceOnly(honest)).toBe(true)

    // The realistic regression: someone caches the XML "for speed" on the record.
    expect(tx.isReferenceOnly({ ...honest, xmlCopy: SIMPLE_SCALE })).toBe(false)
    // ...or nests the resolved measures.
    expect(tx.isReferenceOnly({ ...honest, measures: [{ notes: [] }] })).toBe(false)
    // ...or smuggles it under an allowed-looking name.
    expect(tx.isReferenceOnly({ ...honest, barStart: '<measure number="2"><note/></measure>' })).toBe(false)
    expect(tx.isReferenceOnly(null)).toBe(false)
    expect(tx.isReferenceOnly('not a record')).toBe(false)
  })

  it('fails LOUDLY when the master is gone — a copy would have rendered on regardless', async () => {
    const { meta } = await master.importMaster(blob(SIMPLE_SCALE))
    const excerpt = tx.makeTransclusion(meta.id, '2', '3')
    expect(await tx.resolveTransclusion(excerpt)).toBeTruthy() // resolves while the master exists

    await master.deleteMaster(meta.id)

    // The excerpt cannot invent the notes. That it CANNOT is the evidence it never held them.
    await expect(tx.resolveTransclusion(excerpt)).rejects.toThrow(/isn’t on this device/)
  })
})

describe('§B6 — bar addressing', () => {
  it('maps printed bars to indices and to OSMD’s 1-based range', async () => {
    const { meta } = await master.importMaster(blob(SIMPLE_SCALE))
    const resolved = await tx.resolveTransclusion(tx.makeTransclusion(meta.id, '2', '3'))

    expect(resolved.fromIndex).toBe(1)
    expect(resolved.toIndex).toBe(2)
    expect(resolved.osmdFrom).toBe(2)
    expect(resolved.osmdTo).toBe(3)
  })

  it('addresses by PRINTED bar across a pickup, where printed ≠ position', async () => {
    // The case that would silently render the wrong bars if the two were conflated: with a pickup at
    // index 0, printed bar 1 is the second measure.
    const { meta } = await master.importMaster(blob(PICKUP_SCORE))
    const resolved = await tx.resolveTransclusion(tx.makeTransclusion(meta.id, '1', '2'))

    expect(resolved.fromIndex).toBe(1)  // NOT 0 — the pickup is not bar 1
    expect(resolved.toIndex).toBe(2)
    // And the notes are the ones actually printed under those bar numbers.
    expect(excerptMidis(resolved)).toEqual([72, 74]) // C5, D5 — not the G4 pickup
  })

  it('refuses a bar the score does not have', async () => {
    const { meta } = await master.importMaster(blob(SIMPLE_SCALE))
    await expect(tx.resolveTransclusion(tx.makeTransclusion(meta.id, '1', '99')))
      .rejects.toThrow(/no bar numbered 99/)
  })

  it('refuses a backwards range', async () => {
    const { meta } = await master.importMaster(blob(SIMPLE_SCALE))
    await expect(tx.resolveTransclusion(tx.makeTransclusion(meta.id, '4', '2')))
      .rejects.toThrow(/backwards/)
  })

  it('refuses an AMBIGUOUS bar number instead of guessing the first one', async () => {
    // Repeat endings really do print '8a'/'8b'; multi-movement files restart numbering. Guessing
    // would render the wrong bars while looking entirely normal.
    const dupe = SIMPLE_SCALE.replace('<measure number="4">', '<measure number="2">')
    const { meta } = await master.importMaster(blob(dupe))
    await expect(tx.resolveTransclusion(tx.makeTransclusion(meta.id, '2', '3')))
      .rejects.toThrow(/2 bars numbered 2.*ambiguous/)
  })

  it('refuses a part the score does not have', async () => {
    const { meta } = await master.importMaster(blob(SIMPLE_SCALE))
    await expect(tx.resolveTransclusion(tx.makeTransclusion(meta.id, '1', '2', 5)))
      .rejects.toThrow(/refers to part 6/)
  })
})

describe('§B6 — the master is stored ONCE (deduplicated)', () => {
  it('returns the same master id for byte-identical content, and stores one copy', async () => {
    const a = await master.importMaster(blob(SIMPLE_SCALE), { fileName: 'scale.musicxml' })
    const b = await master.importMaster(blob(SIMPLE_SCALE), { fileName: 'scale-again.musicxml' })

    expect(b.deduped).toBe(true)
    expect(b.meta.id).toBe(a.meta.id)
    expect(await master.listMasters()).toHaveLength(1)
  })

  it('does NOT dedup genuinely different scores (the negative fires)', async () => {
    const a = await master.importMaster(blob(SIMPLE_SCALE))
    const b = await master.importMaster(blob(SIMPLE_SCALE_FIXED))

    expect(b.deduped).toBe(false)
    expect(b.meta.id).not.toBe(a.meta.id)
    expect(await master.listMasters()).toHaveLength(2)
  })

  it('reads back the exact bytes it stored', async () => {
    const { meta } = await master.importMaster(blob(SIMPLE_SCALE))
    expect(await master.loadMasterXml(meta.id)).toBe(SIMPLE_SCALE)
  })
})

describe('master import — refuses bad input at the door', () => {
  it('does not store a file it cannot parse', async () => {
    await expect(master.importMaster(blob('<html>not a score</html>'))).rejects.toThrow()
    // The important half: nothing was written. A stored-but-unparseable master would explode on
    // every excerpt render instead of at the one moment the user could act on it.
    expect(await master.listMasters()).toHaveLength(0)
  })

  it('does not overwrite a good master with a broken re-import', async () => {
    const { meta } = await master.importMaster(blob(SIMPLE_SCALE))
    await expect(master.replaceMasterContent(meta.id, '<html>oops</html>')).rejects.toThrow()

    // The original survives intact — including for every excerpt pointing at it.
    expect(await master.loadMasterXml(meta.id)).toBe(SIMPLE_SCALE)
    const resolved = await tx.resolveTransclusion(tx.makeTransclusion(meta.id, '3', '3'))
    expect(excerptMidis(resolved)).toEqual([71, 69, 67, 65])
  })

  it('refuses to replace a master that does not exist', async () => {
    await expect(master.replaceMasterContent('mx_nope', SIMPLE_SCALE)).rejects.toThrow(/No master score/)
  })
})
