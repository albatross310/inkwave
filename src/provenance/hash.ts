// Canonical hashing for the provenance spine (v4 spec §8).
//
// Everything hashed or signed must be byte-reproducible by an independent verifier years later, so
// we canonicalise with RFC 8785 (JCS) and hash with SHA-256 (lowercase hex). This module is pure
// and dependency-light on purpose: it runs in the app, on the /verify page, and standalone.

// ─── RFC 8785 (JCS) canonicalisation ──────────────────────────────────────────
// JCS: object members sorted by key (UTF-16 code-unit order), no insignificant whitespace, arrays
// in document order, strings escaped per JSON. Numbers use the ECMAScript Number→String form —
// which `JSON.stringify` already produces — so for our data (integers, strings, booleans, null,
// nested objects/arrays: TipTap JSON + receipt cores) JSON.stringify with recursively sorted keys
// IS valid JCS. (Full RFC 8785 number formatting matters only for non-integer floats, which never
// appear in what we hash; if that changes, swap in a spec-complete number serialiser here.)

export function canonicalize(value: unknown): string {
  return serialize(value)
}

function serialize(value: unknown): string {
  if (value === null) return 'null'
  const t = typeof value
  if (t === 'number') {
    if (!Number.isFinite(value as number)) throw new Error('JCS: non-finite number')
    return JSON.stringify(value) // integers + ordinary numbers match JCS via ECMAScript Number→String
  }
  if (t === 'boolean' || t === 'string') return JSON.stringify(value)
  if (t === 'bigint') throw new Error('JCS: bigint not supported')
  if (Array.isArray(value)) {
    return '[' + value.map((v) => serialize(v === undefined ? null : v)).join(',') + ']'
  }
  if (t === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined) // JSON/JCS omit undefined members
      .sort() // default sort = UTF-16 code-unit order, which JCS specifies
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + serialize(obj[k])).join(',') + '}'
  }
  throw new Error(`JCS: unsupported type ${t}`)
}

// ─── SHA-256 ───────────────────────────────────────────────────────────────────

const encoder = new TextEncoder()

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let hex = ''
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0')
  return hex
}

/** Lowercase-hex SHA-256 of a UTF-8 string (WebCrypto; available in browsers and Node ≥ 20). */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input))
  return toHex(digest)
}

/** sha256Hex(JCS(value)) — the canonical hash of any structured value. */
export async function hashCanonical(value: unknown): Promise<string> {
  return sha256Hex(canonicalize(value))
}

// ─── Domain hashes ───────────────────────────────────────────────────────────

/** Content hash binding a snapshot to its exact ProseMirror/TipTap JSON. */
export function contentHash(contentJson: unknown): Promise<string> {
  return hashCanonical(contentJson)
}

/**
 * The Bitcoin-anchored bundle hash. Commits to the content AND the receipt chain, so a single OTS
 * proof over this attests the whole signed record. `receipts` is `[]` until M3 wires the signing
 * service; the shape is fixed now so hashes computed today verify forever.
 *
 * When `bibHash` is supplied (the document has ≥1 DISPLAYED citation) the bundle takes the v:2 form
 * `{ v:2, contentHash, bibHash, receipts }`, folding the displayed bibliography into the anchored
 * hash. With no citations `bibHash` is omitted and the v:1 form is preserved byte-identically — so
 * pre-citation documents and all already-anchored snapshots verify unchanged. See citations spec §12.
 */
export function bundleHash(
  content: string,
  receipts: readonly unknown[] = [],
  bibHash?: string,
  emailHash?: string,
  musicHash?: string,
): Promise<string> {
  // v:4 — a document carrying attached music (music spec §B5). Commits to the ANALYSIS
  // (contentHash) and the SCORE it is about (musicHash) in one anchored hash, which is the whole
  // §B5 claim: this analysis, of exactly these bars of exactly this notation, existed by time T.
  // bibHash and emailHash are carried explicitly as null when absent so a v:4 bundle has ONE shape
  // regardless — a music essay usually cites, and could in principle be an email. Same rule as v:3.
  if (musicHash) {
    return hashCanonical({
      v: 4,
      contentHash: content,
      bibHash: bibHash ?? null,
      emailHash: emailHash ?? null,
      musicHash,
      receipts,
    })
  }
  // v:3 — an email document. Commits to the BODY (contentHash) and the HEADERS (emailHash) in one
  // anchored hash, which is what §B2.2's draft-provenance claim is over. `bibHash` is carried
  // explicitly as null when absent so a v:3 bundle has ONE shape regardless (an email may cite).
  if (emailHash) {
    return hashCanonical({ v: 3, contentHash: content, bibHash: bibHash ?? null, emailHash, receipts })
  }
  return bibHash
    ? hashCanonical({ v: 2, contentHash: content, bibHash, receipts })
    : hashCanonical({ v: 1, contentHash: content, receipts })
}

/**
 * Deterministic hash of a document's ATTACHED MUSIC (music spec §B5: "MusicXML source +
 * annotations + the written analysis are hashed and OTS-anchored, same as everything else").
 *
 * WHAT IT COMMITS TO, and why that is the honest claim:
 *  - `masters` — each attached score's stable id AND the sha256 of its MusicXML. The BYTES are not
 *    here (a score lives in OPFS, like a PDF sidecar) but the hash pins them exactly: swap the
 *    notation under an anchored analysis and this stops matching. That is the §B5 claim, and it is
 *    strictly stronger than the PDF precedent, where only the citation metadata is anchored.
 *  - `excerpts` — the (master_id, bar_start, bar_end) references (§B6). Anchoring these is what
 *    makes "bars 12-16 of THIS score" a timestamped claim rather than a rendering detail.
 *  - `annotations` — EMPTY today (§B4 is not built). The field is hashed NOW, exactly as `receipts`
 *    was fixed at `[]` before M3 wired the signing service: an empty array canonicalises to `[]`
 *    whatever its element type turns out to be, so §B4 can land — and settle its contested anchor
 *    shape — WITHOUT a new bundle version and without changing any hash computed today.
 *
 * Deliberately NOT included: the rendered SVG (a function of the XML + engine version — anchoring a
 * rendering would make an OSMD upgrade look like tampering), and any per-master `addedAt` (a local
 * clock, not evidence).
 */
export function musicAttachmentsHash(music: {
  masters: readonly { id: string; contentHash: string }[]
  excerpts: readonly unknown[]
  annotations?: readonly unknown[]
}): Promise<string> {
  return hashCanonical({
    v: 1,
    // Only the two fields that carry the claim — a master's title/attribution are display metadata
    // and must not make an anchored hash depend on how a corpus happens to name a piece today.
    masters: music.masters.map(m => ({ id: m.id, contentHash: m.contentHash })),
    excerpts: music.excerpts,
    annotations: music.annotations ?? [],
  })
}

/**
 * Deterministic hash of an email's headers. Canonicalises first (lowercased/trimmed addresses, in
 * the caller's order — see email/headers.ts normaliseHeaders) so that two byte-different spellings
 * of the same header set hash the same, and absent cc/bcc are `[]` rather than undefined — a header
 * set must have exactly ONE canonical hash or the anchored claim is ambiguous.
 */
export function emailHeadersHash(headers: {
  to: readonly string[]
  cc?: readonly string[]
  bcc?: readonly string[]
  subject: string
}): Promise<string> {
  return hashCanonical({
    v: 1,
    to: headers.to,
    cc: headers.cc ?? [],
    bcc: headers.bcc ?? [],
    subject: headers.subject,
  })
}

/**
 * Deterministic hash of the DISPLAYED bibliography. Excludes `generatedAt` (so it changes only when
 * the actual citation data or style changes) and takes entries in the caller's order — resolve.ts
 * sorts them by id first. `style` is folded in because it changes the rendered reference list.
 */
export function bibliographyHash(entries: readonly unknown[], style?: string): Promise<string> {
  return hashCanonical({ v: 1, entries, style: style ?? null })
}
