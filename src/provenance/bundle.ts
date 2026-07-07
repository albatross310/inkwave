// The export bundle (v4 spec §6, M4) — the self-contained, self-verifying record a writer hands to
// a verifier. It carries the content, the snapshots (with their OTS proofs + bundleHashes), the
// signed receipt chain, and the signing key reference. A third party verifies it with no Inkwave
// login (src/verify), against Bitcoin and the published key. Pure data assembly — no I/O here.

import type { InkwaveDocument, Snapshot, SignedReceipt, TiptapJSON, CSLItem, IwCitationMeta } from '../types/document'
import { bibProvider } from '../citations/bibProvider'
import { simpleInText } from '../citations/format'
import { usedCitekeys, referenceListKeys } from '../citations/resolve'
import { loadPdf, blobToBase64, pdfVersion } from '../citations/pdfStore'
import { signingPublicKeyHex } from './receipts'
import { POOL_ID } from '../scas/pool'
import { deviceId } from '../sync/presence'
import { collectViewSettings } from '../editor/viewSettings'

// Render an in-text citation as readable text from the node's OWN attrs only — deterministic and
// library-independent. pmToText feeds the verifiable bundle header (verify/index.ts recomputes it and
// requires a byte match), so this MUST NOT depend on bibProvider: the verify environment has no
// library, and a resolved "(Author, Year)" there would diverge from the exporter's. The bare citekeys
// are stable across both. This still fixes the real bug — a dropped citation used to leave an orphaned
// ". " in the prose/diff. (DocView, which is not verified, resolves the pretty author-year form.)
function citationText(attrs: Record<string, unknown> | undefined, resolve = false): string {
  const keys = (attrs?.citekeys as string[] | undefined) ?? []
  if (!keys.length) return ''
  // Display mode (snapshot diff): resolve to "(Author, Year)" like the reader sees it. NEVER do this
  // in the verifiable path — the verifier has no library and would diverge (keeps default resolve=false).
  if (resolve) {
    const items = keys.map(k => bibProvider.get(k)).filter((x): x is CSLItem => !!x)
    if (items.length) return simpleInText(items)
  }
  const loc = attrs?.locator ? `, ${String(attrs.locator)}` : ''
  const pre = attrs?.prefix ? `${String(attrs.prefix)} ` : ''
  const suf = attrs?.suffix ? String(attrs.suffix) : ''
  return `${pre}(${keys.join('; ')}${loc})${suf}`
}

// A clean, readable plain-text copy of the document — block nodes (paragraphs/headings/list items)
// separated by blank lines, hard breaks as newlines. Sits near the top of the bundle so the writing
// is legible to a human opening the file, with no markdown syntax to parse.
export function pmToText(doc: TiptapJSON, resolveCitations = false): string {
  const blocks: string[] = []
  const inline = (node: { type?: string; text?: string; content?: unknown[]; attrs?: Record<string, unknown> }): string => {
    if (node.type === 'text') return node.text ?? ''
    if (node.type === 'hardBreak') return '\n'
    if (node.type === 'citation') return citationText(node.attrs, resolveCitations)
    return (node.content as typeof node[] ?? []).map(inline).join('')
  }
  const walk = (node: { type?: string; text?: string; content?: unknown[] }): void => {
    const t = node.type
    if (t === 'paragraph' || t === 'heading' || t === 'listItem' || t === 'blockquote' || t === 'codeBlock') {
      blocks.push((node.content as typeof node[] ?? []).map(inline).join('').trim())
    } else if (Array.isArray(node.content)) {
      ;(node.content as typeof node[]).forEach(walk)
    }
  }
  walk(doc as { type?: string; content?: unknown[] })
  return blocks.filter((b) => b.length > 0).join('\n\n') + '\n'
}

// Hard-wrap each paragraph at ~width columns on word boundaries. The readable header is plain text
// (real line + paragraph breaks), so it stays legible in any viewer — unlike a JSON string value,
// whose newlines show as escaped "\n" on one long line.
function wrapText(text: string, width = 76): string {
  return text.split('\n').map((line) => {
    if (line.length <= width) return line
    const out: string[] = []
    let cur = ''
    for (const word of line.split(' ')) {
      if (cur && (cur + ' ' + word).length > width) { out.push(cur); cur = word }
      else cur = cur ? `${cur} ${word}` : word
    }
    if (cur) out.push(cur)
    return out.join('\n')
  }).join('\n')
}

export interface BundleSummary {
  what: string
  title: string
  words: number
  snapshots: number
  signedReceipts: number
  bitcoinAnchored: number
  created: string
  exported: string
  verifyAt: string
  note: string
}

export interface ExportBundle {
  v: 1
  summary?: BundleSummary // human-readable header (first key) — what the file is, at a glance
  text?: string           // a clean, readable plain-text copy of the writing, near the top
  exportedAt: string
  document: {
    id: string
    title: string
    contentJson: TiptapJSON
    createdAt: string
    schemaVersion: string
    scasMode?: string
    scasSetSize?: number
    scasPoolId?: string
  }
  snapshots: Snapshot[]       // each with contentJson, contentHash, bundleHash, ots proof, receipts
  receipts: SignedReceipt[]   // the live-composition signed chain (held by the writer)
  signingKey: { keyId: string; alg: 'Ed25519'; publicKeyHex: string }
  poolId: string
  session?: string // writing device id (advisory multi-device guard; not part of any hash)
  // Portability extras (not hashed): the cited library entries so citations resolve on another
  // device, and — only on an explicit "download" export — the embedded PDFs (base64) so the doc
  // travels with its sources + annotations. See buildExportBundleWithPdfs / openInkwaveFile.
  bibliography?: CSLItem[]
  pdfs?: Record<string, { name: string; data: string }>
  viewSettings?: Record<string, string> // theme / gapped / paper / margins / zoom — travels with the doc
}

// The library entries a document depends on (cited in-text or shown in its reference list), so a
// transferred .studio can resolve its citations without the recipient's own library.
function citedItems(contentJson: TiptapJSON): CSLItem[] {
  const keys = new Set([...usedCitekeys(contentJson), ...referenceListKeys(contentJson)])
  const out: CSLItem[] = []
  for (const k of keys) { const it = bibProvider.get(k); if (it) out.push(it) }
  return out
}

function countWords(contentJson: TiptapJSON): number {
  let text = ''
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as { text?: string; content?: unknown[] }
    if (typeof n.text === 'string') text += n.text + ' '
    if (Array.isArray(n.content)) n.content.forEach(walk)
  }
  walk(contentJson)
  const m = text.trim().match(/[\p{L}\p{N}]+/gu)
  return m ? m.length : 0
}

export function buildExportBundle(doc: InkwaveDocument, snapshots: Snapshot[]): ExportBundle {
  const receipts = doc.scasReceipts ?? []
  const exportedAt = new Date().toISOString()
  const summary: BundleSummary = {
    what: 'Inkwave provenance record — a tamper-evident, independently-verifiable record of how this document was written.',
    title: doc.title || 'Untitled',
    words: countWords(doc.contentJson),
    snapshots: snapshots.length,
    signedReceipts: receipts.length,
    bitcoinAnchored: snapshots.filter((s) => s.ots.status === 'confirmed').length,
    created: doc.createdAt,
    exported: exportedAt,
    verifyAt: 'https://iwzero.me/verify',
    note: 'Open this file at the verify link above (or any Inkwave /verify page) to check it — entirely in your browser, against the published signing key and Bitcoin, with no sign-in. The fields below are the cryptographic record; this summary is for humans.',
  }
  return {
    v: 1,
    summary,
    text: pmToText(doc.contentJson),
    exportedAt,
    document: {
      id: doc.id,
      title: doc.title,
      contentJson: doc.contentJson,
      createdAt: doc.createdAt,
      schemaVersion: doc.schemaVersion,
      scasMode: doc.scasMode,
      scasSetSize: doc.scasSetSize,
      scasPoolId: doc.scasPoolId,
    },
    snapshots,
    receipts,
    // A reference to the key the writer's client used; a verifier should still check against the
    // INDEPENDENTLY published key (src/verify defaults to it), not blindly trust this field.
    signingKey: { keyId: 'inkwave-signing-v1', alg: 'Ed25519', publicKeyHex: signingPublicKeyHex() },
    poolId: doc.scasPoolId ?? POOL_ID,
    session: deviceId(),
    bibliography: citedItems(doc.contentJson),
    viewSettings: collectViewSettings(),
  }
}

// Explicit-export variant: also embeds each cited source's PDF bytes (base64) so the .studio is fully
// self-contained. NOT used by autosave/sync (would rewrite megabytes on every checkpoint) — only when
// the writer clicks "download". On the other end, openInkwaveFile restores them to OPFS.
// Cache the base64 of each PDF keyed by citekey + its version, so a save that hasn't changed any PDF
// (the common case) reuses the encoded strings instead of re-reading OPFS + re-encoding ~20 MB.
const _pdfB64Cache = new Map<string, { v: number; name: string; data: string }>()

// stripPdfs: 'all' embeds no PDFs at all ("doc without PDFs"); 'public' omits only sources ticked
// "publicly available" (they can be re-fetched from their open source). Default embeds everything.
export async function buildExportBundleWithPdfs(
  doc: InkwaveDocument, snapshots: Snapshot[], stripPdfs?: 'all' | 'public',
): Promise<ExportBundle> {
  const bundle = buildExportBundle(doc, snapshots)
  if (stripPdfs === 'all') return bundle
  const pdfs: Record<string, { name: string; data: string }> = {}
  for (const item of bundle.bibliography ?? []) {
    const iw = (item as { _iw?: IwCitationMeta })._iw
    const name = iw?.pdfName
    if (!name) continue
    if (stripPdfs === 'public' && iw?.publiclyAvailable) continue // available elsewhere → don't embed
    const v = pdfVersion(item.id)
    const cached = _pdfB64Cache.get(item.id)
    if (cached && cached.v === v && cached.name === name) { pdfs[item.id] = { name, data: cached.data }; continue }
    const blob = await loadPdf(item.id)
    if (blob) {
      const data = await blobToBase64(blob)
      _pdfB64Cache.set(item.id, { v, name, data })
      pdfs[item.id] = { name, data }
    }
  }
  return Object.keys(pdfs).length ? { ...bundle, pdfs } : bundle
}

/** Plain-text README written alongside the mirrored files (folder + OneDrive), for humans. */
export function bundleReadme(s?: BundleSummary): string {
  return [
    'Inkwave — your provenance record',
    '================================',
    '',
    'This folder mirrors your writing and its tamper-evident provenance record.',
    '',
    s ? `  Document : ${s.title}` : '',
    s ? `  Words    : ${s.words}` : '',
    s ? `  Snapshots: ${s.snapshots}   Signed receipts: ${s.signedReceipts}   Bitcoin-anchored: ${s.bitcoinAnchored}` : '',
    '',
    'Files:',
    '  inkwave-*.json     — the self-verifying export bundle. Open it at',
    '                       https://iwzero.me/verify to check it (no sign-in).',
    '  *.current.json     — the document content (for reloading your work).',
    '  *.snapshots.json   — the dated snapshots with their Bitcoin proofs.',
    '',
    'You hold this record; Inkwave keeps nothing. Anyone can verify it against Inkwave’s',
    'published signing key and Bitcoin, with no Inkwave server in the loop.',
    '',
  ].filter((l) => l !== '').join('\n') + '\n'
}

function slugOf(doc: InkwaveDocument): string {
  return (doc.title || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'untitled'
}

// Everything (content, snapshots, Bitcoin proofs, signed receipts, readable text header) lives in
// ONE self-contained file with the distinctive `.studio` extension — so the OS can associate it
// with the app (double-click → open in Inkwave) and it's unmistakably an Inkwave record. Still
// plain text inside (readable header + JSON). NEW files are `.studio`; old `.inkwave` and legacy
// `.trace.json` files still open (the open paths accept all of them).
export const TRACE_EXTENSION = 'studio'

/** The .studio filename a title would produce — for showing file names in the recent list. */
export function inkwaveFileName(title: string): string {
  const slug = (title || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'untitled'
  return `${slug}.${TRACE_EXTENSION}`
}

export function bundleFilename(doc: InkwaveDocument): string {
  return `${slugOf(doc)}.${TRACE_EXTENSION}`
}

// The .trace.json file is a hybrid: the WRITING first (wrapped — real line + paragraph breaks, so
// you open the file and read it immediately), then this marker, then the verifiable JSON record.
// composeTraceFile() writes that shape; parseTraceFile() reads it back (and still accepts a legacy
// pure-JSON file). The box-drawing rule makes the marker unmistakable and ~impossible to hit in prose.
const TRACE_DATA_MARKER = '══════ INKWAVE RECORD · verify at iwzero.me/verify ══════'
// Older domains, still accepted on read so files exported before the iwzero.me migration keep opening.
const TRACE_DATA_MARKERS_LEGACY = [
  '══════ INKWAVE RECORD · verify at inkwave.studio/verify ══════',
  '══════ INKWAVE RECORD · verify at inkwave.me/verify ══════',
]

/** Serialize a bundle to the single .trace.json file: readable writing on top, JSON record below. */
export function composeTraceFile(bundle: ExportBundle): string {
  return [
    wrapText((bundle.text ?? '').replace(/\n+$/, '')),
    '',
    '══════════════════════════════════════════════════════════════',
    TRACE_DATA_MARKER,
    'Everything below is the structured record that proves the writing above. You don’t need to',
    'read it — open this file at iwzero.me/verify to check it.',
    '══════════════════════════════════════════════════════════════',
    '',
    JSON.stringify(bundle, null, 2),
    '',
  ].join('\n')
}

// Cap the dropped-file size before JSON.parse (audit F7): a real record is well under this, so a
// huge file is either a mistake or a DoS attempt — reject it cheaply rather than parse it.
const MAX_TRACE_BYTES = 120_000_000 // 120 MB — allows a few base64-embedded source PDFs

/** Read a .trace.json file back into a bundle (hybrid text-header format OR a legacy pure-JSON file). */
export function parseTraceFile(fileText: string): ExportBundle {
  if (fileText.length > MAX_TRACE_BYTES) throw new Error('file too large to be an Inkwave record')
  // Anchor on the FULL marker line, not a substring an attacker could plant earlier in the prose
  // to redirect the JSON slice (audit F7). Accept both the current domain and the legacy one so
  // files exported before the inkwave.studio domain continue to open.
  let i = fileText.indexOf(TRACE_DATA_MARKER)
  if (i < 0) for (const m of TRACE_DATA_MARKERS_LEGACY) { i = fileText.indexOf(m); if (i >= 0) break }
  const json = i < 0 ? fileText : fileText.slice(fileText.indexOf('{', i))
  return JSON.parse(json) as ExportBundle
}

/** Trigger a download of the single self-contained .trace.json file (browser only). */
export function downloadBundle(bundle: ExportBundle, filename: string): void {
  triggerDownload(new Blob([composeTraceFile(bundle)], { type: 'application/json' }), filename)
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// gzip the composed .studio (native CompressionStream) → a much smaller, emailable file. The JSON part
// compresses ~5–10×; already-compressed PDFs don't shrink, so pair with a strip mode for the smallest
// result. Inkwave reads .studio.gz back transparently (readStudioFile), so nobody unzips by hand.
export async function downloadBundleGz(bundle: ExportBundle, filename: string): Promise<void> {
  const text = composeTraceFile(bundle)
  if (typeof CompressionStream === 'undefined') { downloadBundle(bundle, filename.replace(/\.gz$/, '')); return }
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  triggerDownload(await new Response(stream).blob(), filename)
}

/** Read a possibly-gzipped .studio file: gunzip when it starts with the gzip magic bytes, else UTF-8. */
export async function readStudioFile(file: File | Blob): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer())
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b && typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))
    return await new Response(stream).text()
  }
  return new TextDecoder().decode(buf)
}
