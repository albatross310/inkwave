// Snapshot storage (v4 spec §8, M1). A snapshot is a content-addressed, append-only record of the
// document at a moment: its contentHash, the Bitcoin-anchored bundleHash, and an OTS proof slot
// (unstamped until M2). Snapshots are taken on a *resolved kick* when the content hash has changed
// — so ordinary typing and pasted blocks (no kick resolution) never produce one.
//
// Stored in OPFS alongside the document: documents/<id>/snapshots.json (an array, append-only).
// The folder-mirror to a writer-granted directory arrives in M4.

import { v4 as uuidv4 } from 'uuid'
import type { InkwaveDocument, Snapshot, SignedReceipt, TiptapJSON } from '../types/document'
import { contentHash, bundleHash, bibliographyHash } from './hash'
import { stampBundle, upgradeProof } from './ots'
import { gunzipJsonOffThread } from '../workers/parseClient'

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory()
}

// ── Gzip helpers (CompressionStream, available in all target browsers) ────────
// Snapshots JSON is highly repetitive (same contentJson structure, receipt fields)
// and compresses ~75%, keeping storage manageable as the snapshot list grows.
async function gzipEncode(json: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(json)
  const cs    = new CompressionStream('gzip')
  const w     = cs.writable.getWriter()
  void w.write(bytes)
  void w.close()
  return new Uint8Array(await new Response(cs.readable).arrayBuffer())
}

// Detect gzip by magic bytes 0x1f 0x8b.
function isGzip(buf: ArrayBuffer): boolean {
  const v = new Uint8Array(buf, 0, 2)
  return v[0] === 0x1f && v[1] === 0x8b
}

async function readSnapshotsFromDisk(documentId: string): Promise<Snapshot[]> {
  try {
    const root = await getRoot()
    let dir: FileSystemDirectoryHandle = root
    for (const part of `documents/${documentId}`.split('/')) {
      dir = await dir.getDirectoryHandle(part)
    }
    const file = await (await dir.getFileHandle('snapshots.json')).getFile()
    const buf  = await file.arrayBuffer()
    // Gzip archives (the normal case) gunzip + JSON.parse OFF-THREAD — a big archive is ~1s of
    // unbreakable main-thread work otherwise, felt as typing/scroll freezes whenever it loads.
    // Legacy uncompressed files fall through to a plain UTF-8 decode inline.
    const parsed = isGzip(buf)
      ? await gunzipJsonOffThread(buf)
      : JSON.parse(new TextDecoder().decode(buf))
    if (!Array.isArray(parsed)) return []
    // Normalise legacy 'kick' trigger to 'word-nudge' on read (stored data backward compat)
    return (parsed as Snapshot[]).map((s) =>
      (s.trigger as string) === 'kick' ? { ...s, trigger: 'word-nudge' as const } : s
    )
  } catch {
    return []
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
  if (!p) { p = readSnapshotsFromDisk(documentId); _snapCache.set(documentId, p) }
  return (await p).slice()
}

async function writeSnapshotsFile(documentId: string, snaps: Snapshot[]): Promise<void> {
  const root = await getRoot()
  let dir: FileSystemDirectoryHandle = root
  for (const part of `documents/${documentId}`.split('/')) {
    dir = await dir.getDirectoryHandle(part, { create: true })
  }
  const handle   = await dir.getFileHandle('snapshots.json', { create: true })
  const writable = await handle.createWritable()
  await writable.write(await gzipEncode(JSON.stringify(snaps)))
  await writable.close()
  _snapCache.set(documentId, Promise.resolve(snaps.slice())) // write-through, after a successful close
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

/** All snapshots for a document, in creation order. */
export async function listSnapshots(documentId: string): Promise<Snapshot[]> {
  return readSnapshotsFile(documentId)
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
 */
export async function restoreSnapshotsFromBundle(documentId: string, bundleSnaps: Snapshot[]): Promise<void> {
  if (!bundleSnaps.length) return
  const existing = await readSnapshotsFile(documentId)
  const merged = mergeSnapshots(existing, bundleSnaps)
  if (merged.length <= existing.length) return // OPFS already holds everything the bundle has
  await writeSnapshotsFile(documentId, merged)   // union — never drops local-only snapshots either
}

export async function latestSnapshot(documentId: string): Promise<Snapshot | null> {
  const snaps = await readSnapshotsFile(documentId)
  return snaps.length ? snaps[snaps.length - 1] : null
}

// ─── Version grouping ─────────────────────────────────────────────────────────
// A "version" is any manually saved snapshot (trigger:'manual'). All automatic
// snapshots (kick/paragraph) that follow it — until the next manual save — are
// its "species". Snapshots before the first manual save form a pre-version draft.

export interface SnapshotGroup {
  versionSnap: Snapshot | null  // null = pre-version draft
  items: Snapshot[]             // versionSnap is items[0] when present
  label: string                 // 'v1', 'v2', … or '' for the pre-version draft
}

/** Group an ordered (oldest-first) snapshot list into version buckets. */
export function groupByVersion(snapshots: Snapshot[]): SnapshotGroup[] {
  const groups: SnapshotGroup[] = []
  let versionCount = 0
  let current: SnapshotGroup = { versionSnap: null, items: [], label: '' }

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

  // bundleHash commits to content, the DISPLAYED bibliography (v:2), AND the live-composition receipt
  // chain, so the OTS proof (M2) anchors the whole signed record to Bitcoin.
  const snapshot: Snapshot = {
    id: uuidv4(),
    documentId: doc.id,
    createdAt: new Date().toISOString(),
    trigger,
    wordCount: countWords(doc.contentJson),
    contentHash: cHash,
    contentJson: doc.contentJson,
    receipts,
    bundleHash: await bundleHash(cHash, receipts, bHash),
    ots: { status: 'unstamped' },
    ...(frozenBib ? { bibliography: frozenBib, bibHash: bHash } : {}),
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
