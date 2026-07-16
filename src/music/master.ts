// The MASTER SCORE ATTACHMENT (build spec §B6) — "the full MusicXML is stored ONCE as an embedded
// source attachment (deduplicated)".
//
// Follows the existing embedded-source pattern exactly (citations/pdfStore.ts): the BYTES live in
// OPFS, and the document JSON records only a small reference. That keeps a multi-MB score out of the
// document JSON and out of every provenance hash — the same reason PDFs live there.
//
// ─── IDENTITY vs CONTENT: the decision that makes §B6 work ───────────────────────────────────
// §B6 wants two things that pull in opposite directions:
//   (a) "stored ONCE ... deduplicated"          → identity from CONTENT
//   (b) "fix the master and every excerpt updates" → identity that SURVIVES a content change
// A content-addressed id (masterId = sha256(xml)) satisfies (a) and DESTROYS (b): fixing the master
// would mint a new id and orphan every excerpt pointing at the old one. The excerpts would not
// update — they would break, silently, and only for scores that had been corrected. So:
//
//   masterId    — a stable opaque id, minted once at import and NEVER derived from content.
//   contentHash — sha256 of the current MusicXML. Used for dedup at import, and for provenance (§B5).
//
// Dedup happens by looking up contentHash → an existing masterId at import time; the id itself never
// moves. `replaceMasterContent` then swaps the bytes under a FIXED id, which is precisely what makes
// every transclusion re-render. `transclusion.test.ts` proves that end to end.
//
// ─── What "fix the master" means, given the score is markup-only (§0) ────────────────────────
// Inkwave is NOT a notation editor and does not compete with Sibelius/MuseScore/Dorico — it consumes
// their output. So a master is never fixed by editing notes here. It is fixed the way a student
// actually works: correct the typo in MuseScore, re-export, and REPLACE the master. Same id, new
// bytes, every excerpt in the essay updates. `replaceMasterContent` is a re-import, not an editor.

import { sha256Hex } from '../provenance/hash'
import { writeOpfsFile } from '../storage/opfsWrite'
import { parseMusicXml } from './parse'
import { readScoreFile } from './mxl'

const DIR = 'library'
const SUB = 'scores'
const INDEX_FILE = 'index.json'

/** What we know about a stored master, without reading its (potentially multi-MB) bytes. */
export interface MasterMeta {
  /** Stable identity. Never derived from content — see the header. */
  id: string
  /** sha256 of the CURRENT MusicXML text. Changes when the master is replaced. */
  contentHash: string
  title: string
  composer: string
  /** Original filename as imported, for display ("Nocturne.mxl"). */
  fileName: string
  measureCount: number
  addedAt: string
  updatedAt: string
  /**
   * Where the score came from. 'import' = the student's own file; 'openscore' = the public-domain
   * library (§B7), which carries an attribution the licence requires us to keep.
   */
  origin: 'import' | 'openscore'
  attribution?: ScoreAttribution
}

/** Licence/attribution travelling with a library score (§B7 "attribution as the licence requires"). */
export interface ScoreAttribution {
  /** Human-readable source, e.g. "OpenScore Lieder Corpus". */
  corpus: string
  /** SPDX-ish licence id as published by the corpus, e.g. 'CC0-1.0'. */
  licence: string
  /** URL the file came from, so the claim is checkable rather than asserted. */
  sourceUrl: string
}

const fileNameFor = (id: string) => `${encodeURIComponent(id)}.musicxml`

async function scoresDir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory()
    const lib = await root.getDirectoryHandle(DIR, { create })
    return await lib.getDirectoryHandle(SUB, { create })
  } catch {
    return null
  }
}

// ─── the index (contentHash → id, and the display metadata) ──────────────────────────────────

export async function readIndex(): Promise<MasterMeta[]> {
  const dir = await scoresDir(false)
  if (!dir) return []
  try {
    const file = await (await dir.getFileHandle(INDEX_FILE)).getFile()
    const parsed: unknown = JSON.parse(await file.text())
    return Array.isArray(parsed) ? (parsed as MasterMeta[]) : []
  } catch {
    return []
  }
}

async function writeIndex(index: MasterMeta[]): Promise<void> {
  await writeOpfsFile([DIR, SUB, INDEX_FILE], JSON.stringify(index))
}

// ─── reading / writing masters ───────────────────────────────────────────────────────────────

/** The MusicXML text of a master, or null if it isn't on this device. */
export async function loadMasterXml(id: string): Promise<string | null> {
  const dir = await scoresDir(false)
  if (!dir) return null
  try {
    return await (await dir.getFileHandle(fileNameFor(id))).getFile().then(f => f.text())
  } catch {
    return null
  }
}

export async function masterMeta(id: string): Promise<MasterMeta | null> {
  return (await readIndex()).find(m => m.id === id) ?? null
}

export async function listMasters(): Promise<MasterMeta[]> {
  return readIndex()
}

/** Mint a stable id. Opaque by construction — nothing may infer content from it. */
function mintId(): string {
  return `mx_${crypto.randomUUID()}`
}

export interface ImportOptions {
  fileName?: string
  origin?: 'import' | 'openscore'
  attribution?: ScoreAttribution
}

/**
 * Import a score file (.musicxml or .mxl) as a master attachment (§B2 + §B6).
 *
 * DEDUPLICATED: importing byte-identical content twice returns the SAME master id and writes the
 * bytes once — "the full MusicXML is stored once". The returned `deduped` flag says which happened,
 * so the UI can say "you already have this score" rather than silently doing nothing.
 */
export async function importMaster(file: Blob, opts: ImportOptions = {}): Promise<{ meta: MasterMeta; deduped: boolean }> {
  const xml = await readScoreFile(file)
  return importMasterXml(xml, opts)
}

/** As `importMaster`, for MusicXML text that has already been unwrapped. */
export async function importMasterXml(xml: string, opts: ImportOptions = {}): Promise<{ meta: MasterMeta; deduped: boolean }> {
  // Parse BEFORE storing: an unreadable file must fail at the door with a real message, not become
  // a stored master that explodes every time an excerpt tries to render it.
  const score = parseMusicXml(xml)
  const contentHash = await sha256Hex(xml)

  const index = await readIndex()
  const existing = index.find(m => m.contentHash === contentHash)
  if (existing) return { meta: existing, deduped: true }

  const now = new Date().toISOString()
  const meta: MasterMeta = {
    id: mintId(),
    contentHash,
    title: score.title,
    composer: score.composer,
    fileName: opts.fileName ?? 'score.musicxml',
    measureCount: score.measureCount,
    addedAt: now,
    updatedAt: now,
    origin: opts.origin ?? 'import',
    attribution: opts.attribution,
  }
  await writeOpfsFile([DIR, SUB, fileNameFor(meta.id)], xml)
  await writeIndex([...index, meta])
  return { meta, deduped: false }
}

/**
 * Replace a master's CONTENT while keeping its identity — the §B6 "fix the master" operation.
 *
 * This is a RE-IMPORT (correct it in MuseScore, export, replace), never an in-app note edit: the
 * score stays markup-only (§0). Because `id` is untouched, every transclusion that references this
 * master re-renders from the new bytes on its next resolve. That is the whole single-source-of-truth
 * claim, and `transclusion.test.ts` proves it rather than asserting it.
 */
export async function replaceMasterContent(id: string, xml: string): Promise<MasterMeta> {
  const index = await readIndex()
  const at = index.findIndex(m => m.id === id)
  if (at < 0) throw new Error(`No master score with id ${id} on this device.`)

  const score = parseMusicXml(xml) // fail before overwriting a good master with a broken one
  const contentHash = await sha256Hex(xml)

  await writeOpfsFile([DIR, SUB, fileNameFor(id)], xml)
  const updated: MasterMeta = {
    ...index[at],
    contentHash,
    title: score.title || index[at].title,
    composer: score.composer || index[at].composer,
    measureCount: score.measureCount,
    updatedAt: new Date().toISOString(),
  }
  index[at] = updated
  await writeIndex(index)
  return updated
}

/** Forget a master and its bytes. Excerpts pointing at it will fail LOUDLY on resolve, by design. */
export async function deleteMaster(id: string): Promise<void> {
  const dir = await scoresDir(false)
  if (dir) {
    try { await dir.removeEntry(fileNameFor(id)) } catch { /* already gone */ }
  }
  await writeIndex((await readIndex()).filter(m => m.id !== id))
}
