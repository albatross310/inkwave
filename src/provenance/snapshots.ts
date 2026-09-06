// Snapshot storage (v4 spec §8, M1). A snapshot is a content-addressed, append-only record of the
// document at a moment: its contentHash, the Bitcoin-anchored bundleHash, and an OTS proof slot
// (unstamped until M2). Snapshots are taken on a *resolved kick* when the content hash has changed
// — so ordinary typing does not produce one. Image paste deliberately enters through the global
// manual-snapshot funnel after its bytes and SHA-256 binding land.
//
// Stored in OPFS alongside the document: documents/<id>/snapshots.json (an array, append-only).
// The folder-mirror to a writer-granted directory arrives in M4.

import { v4 as uuidv4 } from 'uuid'
import type { InkwaveDocument, Snapshot, SnapshotMeta, SignedReceipt } from '../types/document'
import { countWords } from './countWords'
import { contentHash, bundleHash, bibliographyHash, emailHeadersHash, musicAttachmentsHash } from './hash'
import { normaliseHeaders } from '../email/headers'
import { stampBundle, upgradeProof } from './ots'
import { gunzipJsonOffThread, gzipJsonOffThread } from '../workers/parseClient'
import { writeOpfsFile } from '../storage/opfsWrite'
import { isNotFound } from '../storage/notFound'
import { StorageReadError } from '../storage/opfs'

/** Result of the one global explicit snapshot action, shared by document and application UIs. */
export interface ManualSnapshotResult {
  snapshot: Snapshot | null
  /** Submitted to OTS (pending or confirmed), not necessarily Bitcoin-confirmed yet. */
  stamped: boolean
  reason?: string
}

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory()
}

// ── Gzip (CompressionStream, available in all target browsers) ────────────────
// ⚠ NO CompressionStream (iOS/Safari < 16.4) ⇒ createSnapshotIfChanged DEGRADES to a no-op and warns
// once, never throws: writing keeps working, provenance is disabled, entry.client shows a banner.
// ⚠ THE COMPRESS RUNS OFF-THREAD — the archive is N × the whole thesis, so an on-thread
// stringify+gzip stalled keystrokes ~1s per checkpoint. "We should be able to make snapshots while
// continuing to type." → docs/archive/storage-and-sync.md#snap-gzip
const hasCompressionStream = typeof CompressionStream !== 'undefined'
let warnedNoCompression = false

// Detect gzip by magic bytes 0x1f 0x8b.
function isGzip(buf: ArrayBuffer): boolean {
  const v = new Uint8Array(buf, 0, 2)
  return v[0] === 0x1f && v[1] === 0x8b
}

// ⚠ THE ARCHIVE READ. `[]` MEANS "THIS DOCUMENT HAS NO HISTORY" AND MAY MEAN NOTHING ELSE.
//
// A NotFoundError is the ONE honest `[]` (a new document has no snapshots.json and must still get a
// blank archive, not an error screen); every other fault — a transient OPFS error, a gzip that will
// not inflate, a non-array parse — THROWS, and the write paths refuse. Both catch arms below are
// load-bearing: every consumer reads-then-writes the WHOLE array, so one `[]` from a failed read
// puts a single snapshot over every OTS proof and signed receipt the document has.
// → docs/archive/storage-and-sync.md#snap-archive-read
//
async function readSnapshotsFromDisk(documentId: string): Promise<Snapshot[]> {
  const path = `documents/${documentId}/snapshots.json`
  // THE LIVE KNOWN-NEGATIVE — `window.__iwArchiveGuard = 'off'` restores the `catch { return [] }`
  // collapse, so a probe can destroy the archive in the SAME BUILD it then proves fixed. ⚠ It is
  // checked FIRST, before `isNotFound`: the legacy shape had no NotFoundError branch, so honouring
  // one here would make the control a partial fiction. ⚠ DO NOT KEEP THIS SEAM if its consumer
  // (`scripts/archguard-probe/repro.mjs`) goes — a live off-switch for the provenance archive with
  // no probe is only a way to turn provenance off.
  // → docs/archive/storage-and-sync.md#snap-known-negative
  const legacy = typeof window !== 'undefined'
    && (window as unknown as { __iwArchiveGuard?: string }).__iwArchiveGuard === 'off'
  let buf: ArrayBuffer
  try {
    const root = await getRoot()
    let dir: FileSystemDirectoryHandle = root
    for (const part of `documents/${documentId}`.split('/')) {
      dir = await dir.getDirectoryHandle(part)
    }
    const file = await (await dir.getFileHandle('snapshots.json')).getFile()
    buf = await file.arrayBuffer()
  } catch (err) {
    if (legacy) return [] // ← the bug, on demand (see the seam note above)
    if (isNotFound(err)) return [] // no snapshots.json — the one honest empty archive
    throw new StorageReadError(path, err)
  }
  try {
    // Gzip archives (the normal case) gunzip + JSON.parse OFF-THREAD — a big archive is ~1s of
    // unbreakable main-thread work otherwise. Legacy uncompressed files decode inline.
    const parsed = isGzip(buf)
      ? await gunzipJsonOffThread(buf)
      : JSON.parse(new TextDecoder().decode(buf))
    if (!Array.isArray(parsed)) throw new Error('snapshots.json did not contain an array')
    // Normalise legacy 'kick' trigger to 'word-nudge' on read (stored data backward compat)
    return (parsed as Snapshot[]).map((s) =>
      (s.trigger as string) === 'kick' ? { ...s, trigger: 'word-nudge' as const } : s
    )
  } catch (err) {
    if (legacy) return [] // ← the bug, on demand: a corrupt gzip / non-array parse answered "no history"
    throw new StorageReadError(path, err)
  }
}

/**
 * The archive read as an OUTCOME to branch on — same shape as `DocRead`, and with NO `[]` member on
 * the failure arm, because `[]` answering two different questions was the whole bug. The one
 * distinction it keeps is established emptiness vs failed read; there is no 'absent' arm because for
 * an ARCHIVE (unlike a document) "no file" and "a file holding []" mean the same thing to every
 * caller. → docs/archive/storage-and-sync.md#snap-read-union
 */
export type SnapshotRead =
  /** The archive, possibly empty — an ESTABLISHED emptiness (new document). Safe to write. */
  | { kind: 'found'; snapshots: Snapshot[] }
  /** Could not find out. NEVER write an archive derived from this. */
  | { kind: 'error'; error: StorageReadError }

/** Read the archive without throwing, for the callers that must tell an empty history from a failed
 *  read: the open-time ancestry guard above all (openDoc.ts), and every action that would publish or
 *  overwrite the record. Prefer this to try/catch around listSnapshots — it cannot be forgotten. */
export async function readSnapshotArchive(documentId: string): Promise<SnapshotRead> {
  try {
    return { kind: 'found', snapshots: await readSnapshotsFile(documentId) }
  } catch (err) {
    return { kind: 'error', error: err instanceof StorageReadError ? err : new StorageReadError(`documents/${documentId}/snapshots.json`, err) }
  }
}

// ── In-memory cache ─────────────────────────────────────────────────────────────
// One parsed copy per document per session — a single open used to gunzip + parse the whole archive
// up to 5 times. Safe because every mutation funnels through writeSnapshotsFile; reads hand out a
// shallow COPY so a caller's in-place edits cannot alias it.
// → docs/archive/storage-and-sync.md#snap-cache
const _snapCache = new Map<string, Promise<Snapshot[]>>()

async function readSnapshotsFile(documentId: string): Promise<Snapshot[]> {
  let p = _snapCache.get(documentId)
  if (!p) {
    p = readSnapshotsFromDisk(documentId)
    // ⚠ A FAILED READ MUST NOT BE CACHED — a cached `[]` told every later reader "no history" long
    // after the fault passed. Caching the REJECTION is the same mistake wearing the other hat: one
    // blip and provenance is off until reload. Evict, and let the next reader retry the disk.
    p.catch(() => { if (_snapCache.get(documentId) === p) _snapCache.delete(documentId) })
    _snapCache.set(documentId, p)
  }
  return (await p).slice()
}

/** Drop the in-memory archive cache. Tests only — a fresh module normally does this. */
export function _resetSnapCache(): void {
  _snapCache.clear()
  _writeChain.clear()
  _mergedTargets.clear()
}

/**
 * Await every queued snapshot write to LAND. Tests only — a case that swaps its in-memory OPFS root
 * must DRAIN the open path's deferred writes first, or the previous case's write resolves against
 * the next case's fresh root. A fixed `setTimeout` cannot bound an off-thread gzip under load; this
 * awaits the actual chain, and loops because a chain can enqueue a successor.
 * → docs/archive/storage-and-sync.md#snap-drain-writes
 */
export async function _drainSnapshotWrites(): Promise<void> {
  for (let pass = 0; pass < 5; pass++) {
    const pending = [..._writeChain.values()]
    if (pending.length === 0) return
    await Promise.allSettled(pending)
    if ([..._writeChain.values()].every((p) => pending.includes(p))) return // nothing new enqueued
  }
}

// ── Cache-first, serialised disk writes ────────────────────────────────────────
// The write-through cache updates SYNCHRONOUSLY and is the in-session authority; the write is chained
// per-document so writes can never land out of order. Grow-only holds because the cache is a SUPERSET
// of disk FOR EVERY READ THAT SUCCEEDED — a caveat that is load-bearing, not decoration: while a
// failed read cached `[]` the sentence was FALSE and every sync target got that lie unioned into
// nothing. → docs/archive/storage-and-sync.md#snap-write-chain
const _writeChain = new Map<string, Promise<void>>()
/**
 * Byte length this tab last WROTE for a document's archive. A different size is proof someone else
 * has written since — the cheap trigger for the re-read below, off metadata alone, so the single-tab
 * case pays no gunzip and no parse.
 */
const _lastWrittenSize = new Map<string, number>()

/** Current byte length of the archive, or null if it cannot be determined (absent, or any fault). */
async function archiveSizeOnDisk(documentId: string): Promise<number | null> {
  try {
    let dir: FileSystemDirectoryHandle = await getRoot()
    for (const part of `documents/${documentId}`.split('/')) dir = await dir.getDirectoryHandle(part)
    return (await (await dir.getFileHandle('snapshots.json')).getFile()).size
  } catch {
    return null // absent (new doc) or unreadable — the caller re-reads rather than assuming
  }
}

/**
 * @param opts.allowShrink  This write is an INTENTIONAL removal (`deleteSnapshot`) and must be
 *   allowed to make the archive smaller. Everything else is append/update and is merged grow-only
 *   against disk first. Default false, so a new write path cannot silently gain the power to
 *   truncate — it has to ask for it.
 */
function queueSnapshotsWrite(documentId: string, snaps: Snapshot[], opts: { allowShrink?: boolean } = {}): Promise<void> {
  const copy = snaps.slice()
  _snapCache.set(documentId, Promise.resolve(copy)) // write-through FIRST — readers see it immediately
  const prev = _writeChain.get(documentId) ?? Promise.resolve()
  const next = prev.catch(() => { /* keep the chain alive after a failed predecessor */ }).then(async () => {
    let out = copy
    // ── ⚠ THE STALE-CACHE GUARD ───────────────────────────────────────────────────────────────
    // `_snapCache` is MODULE state, so it is PER TAB. A tab that loaded at 4 snapshots keeps that
    // for its whole life and will union against it even after another tab has grown the archive to
    // 79 — which Peter lost, twice in one session. `mergeSnapshots` cannot catch it: it guards a
    // SHORT read, and this read is not short, it is STALE. So: compare the byte SIZE against what
    // we last wrote, and only a surprise pays the gunzip.
    // → docs/archive/storage-and-sync.md#snap-stale-cache
    if (!opts.allowShrink) {
      const size = await archiveSizeOnDisk(documentId)
      const untouched = size !== null && size === _lastWrittenSize.get(documentId)
      if (!untouched) {
        // Someone else wrote (or we have never written this file). Union against DISK, not cache.
        // ⚠ A read failure THROWS here and the write is ABANDONED, deliberately: losing one new
        // snapshot is recoverable, overwriting an archive we could not read is not.
        const onDisk = await readSnapshotsFromDisk(documentId)
        if (onDisk.length) {
          out = mergeSnapshots(onDisk, copy) // outgoing wins id clashes ⇒ OTS/summary updates survive
          _snapCache.set(documentId, Promise.resolve(out.slice())) // this tab is now current again
        }
      }
    }
    // The compress runs OFF-THREAD but stays INSIDE the per-doc chain, after `prev`: the grow-only
    // invariant depends on disk writes landing in order. writeOpfsFile works on iOS (worker sync).
    const bytes = await gzipJsonOffThread(out)
    await writeOpfsFile(['documents', documentId, 'snapshots.json'], bytes)
    _lastWrittenSize.set(documentId, bytes.byteLength)
  })
  _writeChain.set(documentId, next)
  return next
}

async function writeSnapshotsFile(documentId: string, snaps: Snapshot[], opts: { allowShrink?: boolean } = {}): Promise<void> {
  await queueSnapshotsWrite(documentId, snaps, opts)
}

/** Union two snapshot lists by id — GROW-ONLY. Provenance history is append-only, so no write-back
 *  (OPFS restore, folder mirror, cloud sync) may ever SHRINK it just because the local OPFS set is
 *  momentarily short — a fresh login, cleared site data, or a sync racing ahead of a restore. The
 *  richer copy wins on an id clash (more signed receipts = more evidence); ordering is by createdAt. */
export function mergeSnapshots(a: Snapshot[], b: Snapshot[]): Snapshot[] {
  const byId = new Map<string, Snapshot>()
  for (const s of a) if (s && s.id) byId.set(s.id, s)
  for (const s of b) {
    if (!s || !s.id) continue
    const prev = byId.get(s.id)
    if (!prev || receiptCount(s) >= receiptCount(prev)) byId.set(s.id, s)
  }
  return [...byId.values()].sort((x, y) => (x.createdAt < y.createdAt ? -1 : x.createdAt > y.createdAt ? 1 : 0))
}
function receiptCount(s: Snapshot): number {
  const r = (s as { receipts?: unknown[] }).receipts
  return Array.isArray(r) ? r.length : 0
}

// The write-back union pass runs ONCE per target per session — after it the local set is the superset,
// and re-parsing a 20MB file on every save is pure lag. ⚠ `markWritebackMerged()` only on a SUCCESSFUL
// read, so a failed one retries. (The ledger deliberately does NOT copy this gate.)
// → docs/archive/storage-and-sync.md#snap-merge
const _mergedTargets = new Set<string>()
export const needsWritebackMerge = (targetKey: string): boolean => !_mergedTargets.has(targetKey)
export const markWritebackMerged = (targetKey: string): void => { _mergedTargets.add(targetKey) }

/**
 * All snapshots for a document, in creation order.
 *
 * ⚠ THROWS `StorageReadError` on an unreadable archive; `[]` means only that this document has no
 * history. PREFER `readSnapshotArchive` — the failure here is invisible to the compiler, so an
 * unguarded call in a click handler is a button that silently does nothing and `.catch(() => [])`
 * around it walks the original bug right back in. Exported because it is the honest primitive and
 * the tests drive it directly. → docs/archive/storage-and-sync.md#snap-read-union
 */
export async function listSnapshots(documentId: string): Promise<Snapshot[]> {
  return readSnapshotsFile(documentId)
}

// ─── Metadata projection (the snapshot memory diet) ──────────────────────────
// ⚠ React state must never hold the full snapshot array — every Snapshot embeds its whole
// contentJson, so hundreds would keep hundreds of MB resident to render a 210px list.
// → docs/archive/storage-and-sync.md#snap-meta-diet

/** Project a Snapshot to its UI metadata — drop contentJson / receipts / bibliography,
 *  keep a receipt COUNT (all the panel ever shows). */
export function toSnapshotMeta(s: Snapshot): SnapshotMeta {
  const { contentJson: _c, receipts, bibliography: _b, ...rest } = s
  return { ...rest, receiptCount: Array.isArray(receipts) ? receipts.length : 0 }
}

/** Metadata-only listing for React state. Same cached read as listSnapshots (so the eager load still
 *  warms the scrub cache), but hands back only the lightweight projection.
 *  ⚠ THROWS on an unreadable archive, never `[]` — a caller that answers the failure by rendering an
 *  empty list has moved the lie from storage into the UI. */
export async function listSnapshotMeta(documentId: string): Promise<SnapshotMeta[]> {
  return (await readSnapshotsFile(documentId)).map(toSnapshotMeta)
}

/** Permanently remove one snapshot by ID. The remaining snapshots are unaffected. */
export async function deleteSnapshot(documentId: string, snapId: string): Promise<void> {
  const snaps = await readSnapshotsFile(documentId)
  const filtered = snaps.filter((s) => s.id !== snapId)
  if (filtered.length === snaps.length) return // already gone
  // The ONE write that is allowed to shrink the archive: the writer asked for this snapshot to go.
  await writeSnapshotsFile(documentId, filtered, { allowShrink: true })
}

/**
 * Restore snapshots from an export bundle into OPFS — only when OPFS has FEWER than the bundle, and
 * as a UNION, so local-only snapshots are never dropped. Call this when opening a .studio so
 * provenance survives device transfers.
 *
 * `deferDiskWrite` (the OPEN path) lands the union in the write-through cache synchronously and runs
 * the heavy write behind the reveal. GROW-ONLY holds either way: a failed deferred write leaves disk
 * un-grown, never truncated. → docs/archive/storage-and-sync.md#snap-restore-bundle
 */
export async function restoreSnapshotsFromBundle(
  documentId: string,
  bundleSnaps: Snapshot[],
  opts: { deferDiskWrite?: boolean } = {},
): Promise<void> {
  if (!bundleSnaps.length) return
  const existing = await readSnapshotsFile(documentId)
  const merged = mergeSnapshots(existing, bundleSnaps)
  if (merged.length <= existing.length) return // OPFS already holds everything the bundle has
  const write = queueSnapshotsWrite(documentId, merged) // union — never drops local-only snapshots either
  if (opts.deferDiskWrite) {
    void write.catch((err) => console.warn('[inkwave] deferred snapshot restore write failed:', err))
    return
  }
  await write
}

export async function latestSnapshot(documentId: string): Promise<Snapshot | null> {
  const snaps = await readSnapshotsFile(documentId)
  return snaps.length ? snaps[snaps.length - 1] : null
}

// ─── Version grouping ─────────────────────────────────────────────────────────
// A "version" is any manually saved snapshot (trigger:'manual'). All automatic
// snapshots (kick/paragraph) that follow it — until the next manual save — are
// its "species". Snapshots before the first manual save form a pre-version draft.

export interface SnapshotGroup<T extends Pick<Snapshot, 'trigger'> = Snapshot> {
  versionSnap: T | null         // null = pre-version draft
  items: T[]                    // versionSnap is items[0] when present
  label: string                 // 'v1', 'v2', … or '' for the pre-version draft
}

/** Group an ordered (oldest-first) snapshot list into version buckets.
 *  Generic so it works on full Snapshots (SnapshotView) and SnapshotMeta (ReceiptPanel). */
export function groupByVersion<T extends Pick<Snapshot, 'trigger'>>(snapshots: T[]): SnapshotGroup<T>[] {
  const groups: SnapshotGroup<T>[] = []
  let versionCount = 0
  let current: SnapshotGroup<T> = { versionSnap: null, items: [], label: '' }

  for (const snap of snapshots) {
    if (snap.trigger === 'manual') {
      if (current.items.length > 0) groups.push(current)
      versionCount++
      current = { versionSnap: snap, items: [snap], label: `v${versionCount}` }
    } else {
      current.items.push(snap)
    }
  }
  if (current.items.length > 0 || groups.length === 0) groups.push(current)
  return groups
}

// The word notion lives in `./countWords` (a leaf that imports nothing). Re-exported so the existing
// callers keep importing it from here. → docs/archive/storage-and-sync.md#snap-countwords
export { countWords }

/**
 * Take a snapshot IF the content has changed since the last one. Returns the new Snapshot, or null
 * if the content hash is unchanged (so repeated triggers on the same text don't pile up). Pass
 * `force: true` for manual "save version" so the user always gets a marker even on unchanged content.
 */
export async function createSnapshotIfChanged(
  doc: InkwaveDocument,
  trigger: Snapshot['trigger'],
  receipts: SignedReceipt[] = [],
  summary?: string,
  force = false,
  nudgeWord?: { from: string; to: string },
): Promise<Snapshot | null> {
  if (!hasCompressionStream) {
    if (!warnedNoCompression) {
      warnedNoCompression = true
      console.warn('[inkwave] CompressionStream unavailable (iOS/Safari < 16.4) — provenance snapshots are disabled; writing still works')
    }
    return null
  }
  const cHash = await contentHash(doc.contentJson)
  const snaps = await readSnapshotsFile(doc.id)
  const last = snaps[snaps.length - 1]
  if (!force && last && last.contentHash === cHash) return null

  // Freeze the DISPLAYED bibliography and hash it deterministically. ⚠ Only when there is ≥1 entry:
  // otherwise bibHash stays undefined and the bundle keeps its v:1 form, so every pre-citation
  // anchor still verifies. → docs/archive/storage-and-sync.md#snap-bundlehash-versions
  const bib = doc.bibliography
  const hasBib = !!bib && bib.entries.length > 0
  const bHash = hasBib ? await bibliographyHash(bib!.entries, doc.citationStyle) : undefined
  const frozenBib = hasBib
    ? { ...bib!, style: doc.citationStyle, bibHash: bHash }
    : undefined

  // Freeze the EMAIL HEADERS (§B2.2) the same way, ⚠ only on an email document. The body needs no
  // handling — it IS contentJson. Headers are canonicalised first, so one header set has exactly one
  // anchored hash. → docs/archive/storage-and-sync.md#snap-bundlehash-versions
  const isEmail = doc.docType === 'email' && !!doc.email
  const frozenEmail = isEmail ? normaliseHeaders(doc.email!) : undefined
  const eHash = frozenEmail ? await emailHeadersHash(frozenEmail) : undefined

  // Freeze the ATTACHED MUSIC (music spec §B5) the same way, ⚠ only on a document carrying a score.
  // The MusicXML BYTES are not frozen (a master lives in OPFS, like a PDF sidecar); its sha256 is,
  // which is what pins the notation. → docs/archive/storage-and-sync.md#snap-bundlehash-versions
  const music = doc.music
  const hasMusic = !!music && (music.masters.length > 0 || music.excerpts.length > 0)
  const frozenMusic = hasMusic ? music : undefined
  const mHash = frozenMusic ? await musicAttachmentsHash(frozenMusic) : undefined

  // bundleHash commits to content, the bibliography (v:2), the email headers (v:3), the attached
  // music (v:4) AND the receipt chain, so the OTS proof anchors the whole signed record to Bitcoin.
  const snapshot: Snapshot = {
    id: uuidv4(),
    documentId: doc.id,
    createdAt: new Date().toISOString(),
    trigger,
    wordCount: countWords(doc.contentJson),
    contentHash: cHash,
    contentJson: doc.contentJson,
    receipts,
    bundleHash: await bundleHash(cHash, receipts, bHash, eHash, mHash),
    ots: { status: 'unstamped' },
    ...(frozenBib ? { bibliography: frozenBib, bibHash: bHash } : {}),
    ...(frozenEmail ? { email: frozenEmail, emailHash: eHash } : {}),
    ...(frozenMusic ? { music: frozenMusic, musicHash: mHash } : {}),
    ...(summary ? { summary } : {}),
    ...(nudgeWord ? { nudgeWord } : {}),
  }
  await writeSnapshotsFile(doc.id, [...snaps, snapshot])
  return snapshot
}

/** Patch a snapshot's summary field after an async AI call resolves. */
export async function patchSnapshotSummary(
  documentId: string,
  id: string,
  summary: string,
): Promise<Snapshot | null> {
  const snaps = await readSnapshotsFile(documentId)
  const i = snaps.findIndex((s) => s.id === id)
  if (i < 0) return null
  snaps[i] = { ...snaps[i], summary }
  await writeSnapshotsFile(documentId, snaps)
  return snaps[i]
}

/** Patch a snapshot's versionSummary field (AI bullet comparison of the full version). */
export async function patchSnapshotVersionSummary(
  documentId: string,
  id: string,
  versionSummary: string,
): Promise<Snapshot | null> {
  const snaps = await readSnapshotsFile(documentId)
  const i = snaps.findIndex((s) => s.id === id)
  if (i < 0) return null
  snaps[i] = { ...snaps[i], versionSummary }
  await writeSnapshotsFile(documentId, snaps)
  return snaps[i]
}

/** Clear all AI summaries for a document so they can be regenerated fresh. */
export async function clearAllSnapshotSummaries(documentId: string): Promise<void> {
  const snaps = await readSnapshotsFile(documentId)
  const cleared = snaps.map((s) => {
    const { diffSummary: _d, versionSummary: _v, ...rest } = s
    return rest as typeof s
  })
  await writeSnapshotsFile(documentId, cleared)
}

/** Patch a snapshot's diffSummary field (the AI diff vs its predecessor). */
export async function patchSnapshotDiffSummary(
  documentId: string,
  id: string,
  diffSummary: { bullets: string },
): Promise<Snapshot | null> {
  const snaps = await readSnapshotsFile(documentId)
  const i = snaps.findIndex((s) => s.id === id)
  if (i < 0) return null
  snaps[i] = { ...snaps[i], diffSummary }
  await writeSnapshotsFile(documentId, snaps)
  return snaps[i]
}

// ─── OTS stamping / upgrading (M2) ──────────────────────────────────────────────
// Each mutation RE-READS the file before writing, so callers that serialise them (the editor's
// snapshot queue) never lose a concurrent append.
// → docs/archive/storage-and-sync.md#snap-ots-reread

async function patchSnapshot(
  documentId: string,
  id: string,
  ots: Snapshot['ots'],
): Promise<Snapshot | null> {
  const snaps = await readSnapshotsFile(documentId)
  const i = snaps.findIndex((s) => s.id === id)
  if (i < 0) return null
  snaps[i] = { ...snaps[i], ots }
  await writeSnapshotsFile(documentId, snaps)
  return snaps[i]
}

/** Stamp one unstamped snapshot's bundleHash → pending. Returns the updated snapshot, or null. */
export async function stampSnapshot(documentId: string, id: string): Promise<Snapshot | null> {
  const snaps = await readSnapshotsFile(documentId)
  const snap = snaps.find((s) => s.id === id)
  if (!snap || snap.ots.status !== 'unstamped') return null
  const ots = await stampBundle(snap.bundleHash)
  if (!ots) return null // relay unreachable — stay unstamped, retry on next drain
  return patchSnapshot(documentId, id, ots)
}

/** Stamp every still-unstamped snapshot (drains the backlog on reconnect). */
export async function drainUnstamped(documentId: string): Promise<void> {
  const snaps = await readSnapshotsFile(documentId)
  for (const s of snaps) {
    if (s.ots.status === 'unstamped') {
      try { await stampSnapshot(documentId, s.id) } catch { /* stay unstamped; retry later */ }
    }
  }
}

/** Ask the calendars to upgrade every pending proof; promotes to 'confirmed' once Bitcoin has it. */
export async function upgradePending(documentId: string): Promise<void> {
  const snaps = await readSnapshotsFile(documentId)
  for (const s of snaps) {
    if (s.ots.status === 'pending' && s.ots.proofBase64) {
      try {
        const ots = await upgradeProof(s.ots.proofBase64, s.bundleHash)
        if (ots) await patchSnapshot(documentId, s.id, ots)
      } catch { /* not ready / offline */ }
    }
  }
}
