// Snapshot storage (v4 spec §8, M1). A snapshot is a content-addressed, append-only record of the
// document at a moment: its contentHash, the Bitcoin-anchored bundleHash, and an OTS proof slot
// (unstamped until M2). Snapshots are taken on a *resolved kick* when the content hash has changed
// — so ordinary typing and pasted blocks (no kick resolution) never produce one.
//
// Stored in OPFS alongside the document: documents/<id>/snapshots.json (an array, append-only).
// The folder-mirror to a writer-granted directory arrives in M4.

import { v4 as uuidv4 } from 'uuid'
import type { InkwaveDocument, Snapshot, SnapshotMeta, SignedReceipt, TiptapJSON } from '../types/document'
import { contentHash, bundleHash, bibliographyHash, emailHeadersHash, musicAttachmentsHash } from './hash'
import { normaliseHeaders } from '../email/headers'
import { stampBundle, upgradeProof } from './ots'
import { gunzipJsonOffThread, gzipJsonOffThread } from '../workers/parseClient'
import { writeOpfsFile } from '../storage/opfsWrite'
import { isNotFound } from '../storage/notFound'
import { StorageReadError } from '../storage/opfs'

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory()
}

// ── Gzip (CompressionStream, available in all target browsers) ────────────────
// Snapshots JSON is highly repetitive (same contentJson structure, receipt fields)
// and compresses ~75%, keeping storage manageable as the snapshot list grows.
// Capability floor: CompressionStream is iOS/Safari 16.4+. Older WebKit can't write the gzip
// archive, so createSnapshotIfChanged degrades to a no-op (warn once) instead of throwing on the
// first resolved kick — writing keeps working, provenance is disabled. entry.client shows a banner.
//
// THE COMPRESS RUNS OFF-THREAD (gzipJsonOffThread, workers/parseClient.ts). Every snapshot embeds
// the whole document body, so the archive is N × the whole thesis and JSON.stringify + gzip of it
// is O(N×doc) — it used to run on the main thread inside queueSnapshotsWrite, stalling keystrokes
// ~1s per checkpoint on a large doc (Peter's report). The READ was already off-thread
// (gunzipJsonOffThread); this is the missing sibling. Falls back inline where there is no Worker
// (node/vitest/prerender). "We should be able to make snapshots while continuing to type."
const hasCompressionStream = typeof CompressionStream !== 'undefined'
let warnedNoCompression = false

// Detect gzip by magic bytes 0x1f 0x8b.
function isGzip(buf: ArrayBuffer): boolean {
  const v = new Uint8Array(buf, 0, 2)
  return v[0] === 0x1f && v[1] === 0x8b
}

// THE ARCHIVE READ. `[]` MEANS "THIS DOCUMENT HAS NO HISTORY" AND MAY MEAN NOTHING ELSE.
//
// This function used to end `catch { return [] }`, which is the 2026-07-15 shape (`catch { return
// null }` erasing the difference between "there is nothing there" and "I could not find out")
// pointed at the provenance spine itself. Every consumer below reads-then-writes the WHOLE array,
// so a transient OPFS fault, a corrupt gzip or a worker failure made this happen:
//
//     const snaps = await readSnapshotsFile(doc.id)          // ← [] on ANY failure
//     await writeSnapshotsFile(doc.id, [...snaps, snapshot]) // ← ONE snapshot over the archive
//
// Every OTS proof and signed receipt for the document — Peter's evidence that he wrote his thesis
// himself — replaced by a single snapshot. No race: one failed read did it. `clearAllSnapshotSummaries`
// was a second vector on the same lie ([] → writes [] over the archive).
//
// So the boundary is `storage/notFound.ts`, the same predicate the document body already hangs off:
// a NotFoundError is the ONE honest `[]` (a new document has no snapshots.json and must still get a
// blank archive, not an error screen); everything else THROWS and the write paths refuse.
//
// A NON-ARRAY parse is a failure, NOT an emptiness, for exactly the reason a corrupt JSON body is:
// the bytes are still on disk and may be recoverable, and answering `[]` would invite the next
// snapshot to write over them. Same for a gzip that won't inflate.
//
async function readSnapshotsFromDisk(documentId: string): Promise<Snapshot[]> {
  const path = `documents/${documentId}/snapshots.json`
  // THE LIVE KNOWN-NEGATIVE — `window.__iwArchiveGuard = 'off'` restores the `catch { return [] }`
  // collapse above, so a browser probe can destroy the archive in the SAME BUILD it then proves
  // fixed. The precedents are `__iwReadGuard` (opfs.ts) and `__iwOpenGuard` (openDoc.ts) and the
  // reason is theirs: "a probe that only ever runs against the fixed build cannot tell 'the guard
  // works' from 'the probe cannot see the bug'".
  //
  // THE PREVIOUS LANE DELIBERATELY LEFT THIS OUT, and was right to: it had no probe, and a live
  // off-switch for the provenance archive with no consumer is only a way to turn provenance off.
  // It arrives now WITH its consumer — `scripts/archguard-probe/repro.mjs`, which REQUIRES this
  // cell to truncate a real 4-snapshot archive in real OPFS before it will read the fixed verdict
  // (it exits 2 if the control fails to reproduce). Do not keep this seam if that probe goes: the
  // rule the previous lane wrote still binds, in both directions.
  //
  // It is checked FIRST, before `isNotFound`, exactly like opfs.ts's — the legacy shape had no
  // NotFoundError branch at all, so honouring one here would make the control a partial fiction.
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
    // unbreakable main-thread work otherwise, felt as typing/scroll freezes whenever it loads.
    // Legacy uncompressed files fall through to a plain UTF-8 decode inline.
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
 * The archive read, as an outcome a caller must branch on rather than a value it can mistake for
 * emptiness — the same shape as `DocRead` in storage/opfs.ts, and deliberately with NO `[]` member
 * on the failure arm. The whole bug was that `[]` answered two different questions.
 *
 * WHY THERE IS NO 'absent' ARM, when DocRead has one. For a DOCUMENT, absent is a real third answer:
 * it is what makes `newDocument()` legal, so it must stay distinct from `found`. For an ARCHIVE the
 * two collapse — "no snapshots.json" and "a snapshots.json holding []" mean the identical thing to
 * every caller ("this document has no history"), and both are safe to append to. Splitting them
 * would buy nothing and cost a dead branch at every call site, which is its own kind of rot. The
 * distinction that DOES matter is the one this union keeps: established emptiness vs failed read.
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
// One parsed copy per document per session. A single doc open used to gunzip + JSON.parse the whole
// archive up to 5 times (eager list, receipt recovery ×2, folder link, cloud resume) — 100ms–1s each
// on a big archive. Every mutation in this app funnels through writeSnapshotsFile (and the editor
// serialises snapshot work through one queue), so a write-through cache is safe. Reads hand out a
// shallow COPY so a caller's in-place edits can't alias the cached array. (A second tab writing the
// same doc's OPFS bypasses this cache — but concurrent same-doc tabs already race on the file itself;
// the grow-only merge protects sync targets either way.)
const _snapCache = new Map<string, Promise<Snapshot[]>>()

async function readSnapshotsFile(documentId: string): Promise<Snapshot[]> {
  let p = _snapCache.get(documentId)
  if (!p) {
    p = readSnapshotsFromDisk(documentId)
    // A FAILED READ MUST NOT BE CACHED. When this cache held `[]` from a failed read, the lie
    // persisted for the whole session — every later reader was told "no history" long after the
    // transient fault had passed. Caching the REJECTION instead would be the same mistake wearing
    // the other hat: one blip and provenance is off until reload. So evict on failure and let the
    // next reader retry the disk; only a resolved read is worth keeping.
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
 * Await every queued snapshot write to LAND. Tests only.
 *
 * The open path restores with `deferDiskWrite: true` — a fire-and-forget write on `_writeChain`
 * that outlives the call that queued it (`restoreSnapshotsFromBundle` → `void write.catch(...)`).
 * A test that swaps its in-memory OPFS root between cases (installOpfsShim) must first let those
 * writes DRAIN, or the previous case's deferred write resolves `getDirectory()` against the NEXT
 * case's fresh root and materialises a stray document in a disk that should have been clean. A
 * fixed `setTimeout` cannot bound an off-thread gzip under CPU load; this awaits the actual chain.
 * Loops because a chain can enqueue a successor while we await the first.
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
// The write-through cache updates SYNCHRONOUSLY (before the disk write lands) and is the in-session
// authority; the gzip+stringify+write is chained per-document so writes can never land out of order.
// Grow-only safety: the cache is a SUPERSET of disk *for every read that succeeded* (only intentional
// deletes shrink it), and every write-back (cloud sync, folder mirror) reads through the cache — so if
// a deferred disk write fails, disk merely didn't grow (never truncated) and every sync target still
// gets the full union.
//   THE CAVEAT IS LOAD-BEARING, and this comment used to assert the invariant flatly. It was FALSE: a
// failed read cached `[]`, so the "superset" was a lie for the rest of the session and every sync
// target got that lie unioned into nothing. The read now throws instead of returning `[]` and a
// failure is never cached (see readSnapshotsFile) — which is what makes the sentence above true.
// A comment asserting parity is a reason nobody checks parity; this one earns it or it goes.
// The per-doc chain also means a deferred open-time restore write and a subsequent snapshot append
// serialise: disk always converges to the latest cache state.
const _writeChain = new Map<string, Promise<void>>()
function queueSnapshotsWrite(documentId: string, snaps: Snapshot[]): Promise<void> {
  const copy = snaps.slice()
  _snapCache.set(documentId, Promise.resolve(copy)) // write-through FIRST — readers see it immediately
  const prev = _writeChain.get(documentId) ?? Promise.resolve()
  const next = prev.catch(() => { /* keep the chain alive after a failed predecessor */ }).then(async () => {
    // The compress (stringify + gzip of the WHOLE archive) runs OFF-THREAD — see the gzip note above.
    // It stays INSIDE the per-doc chain, after `prev`, so the write-through cache set above remains
    // the synchronous in-session authority and disk writes still land in order (the grow-only
    // invariant depends on that ordering). writeOpfsFile works on iOS too (worker sync-access).
    await writeOpfsFile(['documents', documentId, 'snapshots.json'], await gzipJsonOffThread(copy))
  })
  _writeChain.set(documentId, next)
  return next
}

async function writeSnapshotsFile(documentId: string, snaps: Snapshot[]): Promise<void> {
  await queueSnapshotsWrite(documentId, snaps)
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

// The grow-only "read the existing file and union its snapshots" pass on write-back only needs to run
// ONCE per target per session — enough to fold in another device's snapshots. After that the local
// OPFS set is the superset (snapshots are append-only), so a save just grows it; re-reading and parsing
// the (possibly 20 MB) file on EVERY save is pure lag. Callers gate on needsWritebackMerge() and call
// markWritebackMerged() only on a successful read, so a failed read retries next time.
const _mergedTargets = new Set<string>()
export const needsWritebackMerge = (targetKey: string): boolean => !_mergedTargets.has(targetKey)
export const markWritebackMerged = (targetKey: string): void => { _mergedTargets.add(targetKey) }

/**
 * All snapshots for a document, in creation order.
 *
 * ⚠ THROWS `StorageReadError` if the archive cannot be read — it will not answer `[]` for a failure,
 * because that answer is what truncated the archive (see readSnapshotsFromDisk). It returns `[]`
 * only for a document that genuinely has no history.
 *
 * PREFER `readSnapshotArchive`, and note that every production caller now uses it: the failure here
 * is invisible to the compiler, so an unguarded `await listSnapshots(id)` in a click handler is a
 * button that silently does nothing, and `.catch(() => [])` around it walks the original bug right
 * back in. The union makes the failure a value you have to look at. This stays exported because it
 * is the honest primitive and the tests drive it directly.
 */
export async function listSnapshots(documentId: string): Promise<Snapshot[]> {
  return readSnapshotsFile(documentId)
}

// ─── Metadata projection (the snapshot memory diet) ──────────────────────────
// React state must never hold the full snapshot array — every Snapshot embeds its whole
// contentJson (+ receipts + frozen bibliography), so hundreds of snapshots would keep hundreds
// of MB resident just to render a 210px list. The cache above keeps the full array ONCE
// (unavoidable — rapid scrubbing needs it hot); UI state holds only this cheap projection.

/** Project a Snapshot to its UI metadata — drop contentJson / receipts / bibliography,
 *  keep a receipt COUNT (all the panel ever shows). */
export function toSnapshotMeta(s: Snapshot): SnapshotMeta {
  const { contentJson: _c, receipts, bibliography: _b, ...rest } = s
  return { ...rest, receiptCount: Array.isArray(receipts) ? receipts.length : 0 }
}

/** Metadata-only listing for React state. Same cached read as listSnapshots (so the eager
 *  load still warms the scrub cache), but hands back only the lightweight projection.
 *  ⚠ THROWS on an unreadable archive, exactly like listSnapshots — never `[]`. A caller that
 *  answers the failure by rendering an empty list has moved the lie from storage into the UI. */
export async function listSnapshotMeta(documentId: string): Promise<SnapshotMeta[]> {
  return (await readSnapshotsFile(documentId)).map(toSnapshotMeta)
}

/** Permanently remove one snapshot by ID. The remaining snapshots are unaffected. */
export async function deleteSnapshot(documentId: string, snapId: string): Promise<void> {
  const snaps = await readSnapshotsFile(documentId)
  const filtered = snaps.filter((s) => s.id !== snapId)
  if (filtered.length === snaps.length) return // already gone
  await writeSnapshotsFile(documentId, filtered)
}

/**
 * Restore snapshots from an export bundle into OPFS — only when OPFS has FEWER snapshots than the
 * bundle. Local OPFS always wins: if the machine already has the full history, leave it untouched.
 * Call this when opening a .studio file so provenance survives device transfers.
 *
 * `deferDiskWrite` (the OPEN path): the union lands in the write-through cache synchronously —
 * the editor's eager snapshot list right after open sees the FULL union — while the heavy
 * stringify+gzip+write runs behind the reveal (the wave-decay dead time) on the per-doc write
 * chain. GROW-ONLY holds either way: a failed deferred write leaves disk un-grown (never
 * truncated), the cache stays the superset every write-back unions from, and the bundle's copy
 * still exists at its source.
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

/** Count content words in TipTap JSON (whitespace-delimited runs of letters/digits). */
export function countWords(contentJson: TiptapJSON): number {
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

  // Freeze the DISPLAYED bibliography (the mode-resolved cited subset resolve.ts embedded) and hash
  // it deterministically. Only when there's ≥1 displayed entry — otherwise bibHash stays undefined
  // and bundleHash keeps its v:1 form (pre-citation docs hash exactly as before). See citations §12.
  const bib = doc.bibliography
  const hasBib = !!bib && bib.entries.length > 0
  const bHash = hasBib ? await bibliographyHash(bib!.entries, doc.citationStyle) : undefined
  const frozenBib = hasBib
    ? { ...bib!, style: doc.citationStyle, bibHash: bHash }
    : undefined

  // Freeze the EMAIL HEADERS (§B2.2) the same way, and only on an email document — so the bundle
  // keeps its v:1/v:2 form for every other document and all existing anchors verify unchanged.
  // The body needs no special handling: it IS contentJson, already committed via contentHash. The
  // headers are canonicalised before hashing so one header set has exactly one anchored hash.
  const isEmail = doc.docType === 'email' && !!doc.email
  const frozenEmail = isEmail ? normaliseHeaders(doc.email!) : undefined
  const eHash = frozenEmail ? await emailHeadersHash(frozenEmail) : undefined

  // Freeze the ATTACHED MUSIC (music spec §B5) the same way, and only on a document that carries a
  // score — so the bundle keeps its v:1/v:2/v:3 form for every other document and every existing
  // anchor verifies unchanged. The MusicXML BYTES are not frozen here (a master lives in OPFS, like
  // a PDF sidecar); its sha256 is, which is what actually pins the notation: correct the score under
  // an anchored analysis and this stops matching. For a music essay the claim is exactly §B5's —
  // this analysis, of these bars of this notation, existed by time T.
  const music = doc.music
  const hasMusic = !!music && (music.masters.length > 0 || music.excerpts.length > 0)
  const frozenMusic = hasMusic ? music : undefined
  const mHash = frozenMusic ? await musicAttachmentsHash(frozenMusic) : undefined

  // bundleHash commits to content, the DISPLAYED bibliography (v:2), the EMAIL HEADERS (v:3), the
  // ATTACHED MUSIC (v:4), AND the live-composition receipt chain, so the OTS proof (M2) anchors the
  // whole signed record to Bitcoin. For an email that is exactly the §B2.2 claim: headers + body
  // existed by time T.
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
// Each mutation re-reads the file before writing, so callers that serialise them (the editor's
// snapshot queue) never lose a concurrent append.

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
