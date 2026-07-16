// `.mxl` — the COMPRESSED MusicXML container (build spec §B2). A .mxl is an ordinary ZIP holding
// the score plus a `META-INF/container.xml` that names which entry is the actual score.
//
// WHY HAND-ROLLED (no jszip / fflate): this app hard-minimises bundle size — it hand-rolls its PWA
// and its charts and self-hosts pdf.js rather than pull CDN deps. A ZIP reader for THIS job is
// small, because .mxl only ever needs two of ZIP's features: STORED (method 0) and DEFLATE
// (method 8). The platform already ships the DEFLATE decoder as `DecompressionStream('deflate-raw')`
// (Chromium/Firefox/Safari 16.4+, Node 18+), so the only real code here is the central-directory
// walk. jszip would have cost ~95 kB min for that. See the module report for the measured numbers.
//
// This reader is deliberately STRICT and LOUD: an unsupported compression method, a bad signature,
// or a missing container.xml rootfile throws with a specific message rather than returning empty.
// A silent empty parse is exactly the failure mode CLAUDE.md warns about — it would look identical
// to "the score has no notes".

const EOCD_SIG = 0x06054b50
const CEN_SIG = 0x02014b50
const LOC_SIG = 0x04034b50
const EOCD_MIN = 22          // EOCD with a zero-length comment
const MAX_COMMENT = 0xffff

export interface ZipEntry {
  name: string
  /** Compression method: 0 = stored, 8 = deflate. Others are rejected. */
  method: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

/** Locate the End Of Central Directory record, scanning back over any trailing comment. */
function findEocd(view: DataView): number {
  const max = Math.min(view.byteLength, EOCD_MIN + MAX_COMMENT)
  for (let i = EOCD_MIN; i <= max; i++) {
    const at = view.byteLength - i
    if (at < 0) break
    if (view.getUint32(at, true) === EOCD_SIG) return at
  }
  throw new Error('Not a .mxl file: no ZIP end-of-central-directory record found.')
}

/** Read the ZIP central directory — name + method + offset for every entry. */
export function readZipEntries(buf: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buf)
  const eocd = findEocd(view)
  const count = view.getUint16(eocd + 10, true)
  let at = view.getUint32(eocd + 16, true)
  const entries: ZipEntry[] = []
  const dec = new TextDecoder()
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== CEN_SIG) {
      throw new Error(`Corrupt .mxl: bad central-directory signature at entry ${i}.`)
    }
    const method = view.getUint16(at + 10, true)
    const compressedSize = view.getUint32(at + 20, true)
    const uncompressedSize = view.getUint32(at + 24, true)
    const nameLen = view.getUint16(at + 28, true)
    const extraLen = view.getUint16(at + 30, true)
    const commentLen = view.getUint16(at + 32, true)
    const localHeaderOffset = view.getUint32(at + 42, true)
    const name = dec.decode(new Uint8Array(buf, at + 46, nameLen))
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset })
    at += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** Inflate one entry's bytes. Uses the platform DEFLATE decoder — no dependency. */
export async function readZipEntry(buf: ArrayBuffer, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(buf)
  const lh = entry.localHeaderOffset
  if (view.getUint32(lh, true) !== LOC_SIG) {
    throw new Error(`Corrupt .mxl: bad local header for "${entry.name}".`)
  }
  // The local header's name/extra lengths may differ from the central directory's — always trust
  // the local header when locating the data itself.
  const nameLen = view.getUint16(lh + 26, true)
  const extraLen = view.getUint16(lh + 28, true)
  const start = lh + 30 + nameLen + extraLen
  const raw = new Uint8Array(buf, start, entry.compressedSize)

  if (entry.method === 0) return raw            // stored
  if (entry.method !== 8) {
    throw new Error(`Unsupported compression in .mxl entry "${entry.name}" (method ${entry.method}). Only stored and deflate are supported.`)
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress .mxl files. Export an uncompressed .musicxml instead.')
  }
  // Response gives us a ReadableStream over the bytes without a Blob — `new Blob([raw]).stream()`
  // would allocate a second copy of the entry, and Blob.stream() is one of the corners jsdom does
  // not implement, so this is leaner AND testable.
  const body = new Response(raw).body
  if (!body) throw new Error(`Could not read the compressed data for "${entry.name}".`)
  const stream = body.pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * Resolve which entry inside a .mxl is the score, per the MusicXML container spec:
 * `META-INF/container.xml` → `<rootfile full-path="…"/>`, first rootfile wins.
 * Falls back to the first non-META-INF .musicxml/.xml entry when container.xml is absent —
 * some exporters omit it — but never silently: the caller gets the name it chose.
 */
export function pickRootfile(containerXml: string | null, entries: ZipEntry[]): string {
  if (containerXml) {
    const doc = new DOMParser().parseFromString(containerXml, 'application/xml')
    const path = doc.querySelector('rootfile')?.getAttribute('full-path')
    if (path) return path
  }
  const fallback = entries.find(e =>
    !e.name.startsWith('META-INF/') &&
    !e.name.endsWith('/') &&
    /\.(musicxml|xml)$/i.test(e.name))
  if (!fallback) {
    throw new Error('No score found inside the .mxl (no container.xml rootfile and no .musicxml entry).')
  }
  return fallback.name
}

/** Unwrap a .mxl container to the MusicXML text it holds. */
export async function unwrapMxl(buf: ArrayBuffer): Promise<string> {
  const entries = readZipEntries(buf)
  const containerEntry = entries.find(e => e.name === 'META-INF/container.xml')
  const dec = new TextDecoder()
  const containerXml = containerEntry
    ? dec.decode(await readZipEntry(buf, containerEntry))
    : null
  const rootName = pickRootfile(containerXml, entries)
  const root = entries.find(e => e.name === rootName)
  if (!root) throw new Error(`The .mxl names "${rootName}" as its score, but no such entry exists.`)
  return dec.decode(await readZipEntry(buf, root))
}

/** A .mxl is a ZIP: it starts with a local file header ("PK\x03\x04"). Plain MusicXML starts "<". */
export function looksLikeMxl(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 4) return false
  return new DataView(buf).getUint32(0, true) === LOC_SIG
}

/**
 * Accept either form (§B2: "`.musicxml` and `.mxl` (compressed)") and return MusicXML text.
 * Sniffs the CONTENT, not the filename — a .mxl saved as .musicxml still works, and a mislabelled
 * file fails with a real message instead of a mystery parse error.
 */
export async function readScoreFile(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer()
  if (looksLikeMxl(buf)) return unwrapMxl(buf)
  return new TextDecoder().decode(new Uint8Array(buf))
}
