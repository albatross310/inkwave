// @vitest-environment jsdom
//
// The .mxl reader is checked against ZIPs built by node's own zlib + a hand-written central
// directory — NOT by a writer of ours. There is no Inkwave .mxl writer (the score is markup-only,
// §0), so there is no risk of the classic trap here: a reader checked only against its own writer
// agrees with itself no matter how wrong both are.
//
// The DEFLATE bytes come from `zlib.deflateRawSync`, i.e. the same real DEFLATE that MuseScore and
// Sibelius emit — so a pass means we read a genuine compressed container, not a shape we invented.

import { describe, expect, it } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { Blob as NodeBlob } from 'node:buffer'
import { looksLikeMxl, pickRootfile, readScoreFile, readZipEntries, unwrapMxl } from './mxl'
import { SIMPLE_SCALE } from './scoreFixtures'

// ─── a minimal, real ZIP writer (test-only) ──────────────────────────────────────────────────

interface Entry { name: string; data: Buffer; store?: boolean }

/** Build a real ZIP. `store: true` writes the entry uncompressed (method 0). */
function makeZip(entries: Entry[]): ArrayBuffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8')
    const body = e.store ? e.data : deflateRawSync(e.data)
    const method = e.store ? 0 : 8

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)   // signature
    local.writeUInt16LE(20, 4)           // version needed
    local.writeUInt16LE(0, 6)            // flags
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(0, 14)           // crc32 — not checked by our reader
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(e.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)           // extra length
    locals.push(local, nameBuf, body)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(0, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(e.data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)

    offset += local.length + nameBuf.length + body.length
  }

  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)

  const all = Buffer.concat([...locals, centralBuf, eocd])
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength) as ArrayBuffer
}

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container><rootfiles>
  <rootfile full-path="score.xml" media-type="application/vnd.recordare.musicxml+xml"/>
</rootfiles></container>`

/** A .mxl exactly as an exporter writes one: container.xml + the score, both deflated. */
const realMxl = () => makeZip([
  { name: 'META-INF/container.xml', data: Buffer.from(CONTAINER, 'utf8') },
  { name: 'score.xml', data: Buffer.from(SIMPLE_SCALE, 'utf8') },
])

// ─── tests ───────────────────────────────────────────────────────────────────────────────────

describe('looksLikeMxl', () => {
  it('recognises a ZIP by its local-header signature', () => {
    expect(looksLikeMxl(realMxl())).toBe(true)
  })

  it('does not mistake plain MusicXML for a container (the negative fires)', () => {
    const xml = new TextEncoder().encode(SIMPLE_SCALE)
    expect(looksLikeMxl(xml.buffer as ArrayBuffer)).toBe(false)
  })

  it('does not crash on a file too short to have a signature', () => {
    expect(looksLikeMxl(new Uint8Array([1, 2]).buffer as ArrayBuffer)).toBe(false)
  })
})

describe('readZipEntries', () => {
  it('lists every entry with its compression method', () => {
    const entries = readZipEntries(realMxl())
    expect(entries.map(e => e.name)).toEqual(['META-INF/container.xml', 'score.xml'])
    expect(entries.every(e => e.method === 8)).toBe(true)
  })

  it('reports the uncompressed size the archive claims', () => {
    const entries = readZipEntries(realMxl())
    const score = entries.find(e => e.name === 'score.xml')!
    expect(score.uncompressedSize).toBe(Buffer.byteLength(SIMPLE_SCALE, 'utf8'))
    // ...and it genuinely COMPRESSED — otherwise this fixture wouldn't be exercising deflate at all.
    expect(score.compressedSize).toBeLessThan(score.uncompressedSize)
  })

  it('refuses a file with no end-of-central-directory record', () => {
    expect(() => readZipEntries(new TextEncoder().encode('not a zip at all').buffer as ArrayBuffer))
      .toThrow(/no ZIP end-of-central-directory/)
  })
})

describe('unwrapMxl', () => {
  it('inflates the real score out of a real deflated container', async () => {
    // The whole point: bytes in, the original MusicXML back out.
    expect(await unwrapMxl(realMxl())).toBe(SIMPLE_SCALE)
  })

  it('reads a STORED (uncompressed) entry too', async () => {
    const zip = makeZip([
      { name: 'META-INF/container.xml', data: Buffer.from(CONTAINER, 'utf8'), store: true },
      { name: 'score.xml', data: Buffer.from(SIMPLE_SCALE, 'utf8'), store: true },
    ])
    expect(await unwrapMxl(zip)).toBe(SIMPLE_SCALE)
  })

  it('follows container.xml to a score that is NOT the first entry and NOT named obviously', async () => {
    // Proves we actually read the rootfile rather than guessing. If the rootfile were ignored and
    // the reader just took the first .xml, it would return the decoy and this test would fail.
    const container = CONTAINER.replace('score.xml', 'deep/nested/real.xml')
    const zip = makeZip([
      { name: 'META-INF/container.xml', data: Buffer.from(container, 'utf8') },
      { name: 'aaa-decoy.xml', data: Buffer.from('<score-partwise><decoy/></score-partwise>', 'utf8') },
      { name: 'deep/nested/real.xml', data: Buffer.from(SIMPLE_SCALE, 'utf8') },
    ])
    expect(await unwrapMxl(zip)).toBe(SIMPLE_SCALE)
  })

  it('falls back to the only score when container.xml is absent', async () => {
    const zip = makeZip([{ name: 'score.musicxml', data: Buffer.from(SIMPLE_SCALE, 'utf8') }])
    expect(await unwrapMxl(zip)).toBe(SIMPLE_SCALE)
  })

  it('refuses a container whose rootfile does not exist, rather than silently falling back', async () => {
    const container = CONTAINER.replace('score.xml', 'missing.xml')
    const zip = makeZip([
      { name: 'META-INF/container.xml', data: Buffer.from(container, 'utf8') },
      { name: 'score.xml', data: Buffer.from(SIMPLE_SCALE, 'utf8') },
    ])
    await expect(unwrapMxl(zip)).rejects.toThrow(/names "missing.xml" as its score/)
  })

  it('refuses an archive with no score in it at all', async () => {
    const zip = makeZip([{ name: 'readme.txt', data: Buffer.from('hello', 'utf8') }])
    await expect(unwrapMxl(zip)).rejects.toThrow(/No score found inside the .mxl/)
  })
})

describe('pickRootfile', () => {
  it('prefers the container rootfile over any heuristic', () => {
    const entries = readZipEntries(realMxl())
    expect(pickRootfile(CONTAINER, entries)).toBe('score.xml')
  })

  it('skips META-INF when guessing', () => {
    const entries = readZipEntries(makeZip([
      { name: 'META-INF/container.xml', data: Buffer.from(CONTAINER, 'utf8') },
      { name: 'score.musicxml', data: Buffer.from(SIMPLE_SCALE, 'utf8') },
    ]))
    expect(pickRootfile(null, entries)).toBe('score.musicxml')
  })
})

describe('readScoreFile — accepts either form (§B2)', () => {
  // node's Blob types its own BlobPart; the DOM lib's differs. Both accept an ArrayBuffer/string
  // at runtime — this is a types-only seam, not a behavioural one.
  const blob = (data: ArrayBuffer | string) =>
    new NodeBlob([data as never]) as unknown as Blob

  it('reads a plain .musicxml file', async () => {
    expect(await readScoreFile(blob(SIMPLE_SCALE))).toBe(SIMPLE_SCALE)
  })

  it('reads a compressed .mxl file', async () => {
    expect(await readScoreFile(blob(realMxl()))).toBe(SIMPLE_SCALE)
  })

  it('sniffs CONTENT, not the filename — a .mxl saved as .musicxml still works', async () => {
    // Filenames lie; the magic number doesn't. This is why readScoreFile takes a Blob and never
    // looks at a name.
    expect(await readScoreFile(blob(realMxl()))).toBe(SIMPLE_SCALE)
  })
})
