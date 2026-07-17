// Provider adapters for ledger sync (spec §A9).
//
// Each adapter's ONLY job is to move bytes and REPORT WHAT HAPPENED — in particular to distinguish
// "the file isn't there yet" (absent → a first write is safe) from "I couldn't read it" (error →
// never write). The reconciliation lives in ledgerSync.ts; nothing here decides anything.
//
// OneDrive is the live provider (Graph sync shipped). Google Drive and the local folder take the
// SAME LedgerRemote shape — each needs only its own absent-vs-error mapping (Drive: a files.list by
// name returning zero hits = absent, any other failure = error; folder: getFileHandle rejecting with
// NotFoundError = absent, anything else = error). Deliberately not written blind: an adapter whose
// absent/error mapping has never been exercised against the real API is exactly the kind of guess
// that turns into a blind overwrite.

import { oneDriveConfigured, readOneDriveText, writeOneDriveText } from '../storage/onedrive'
import { parseRemoteLedger, syncLedgerMonth, type LedgerRemote, type RemoteRead, type WritePrecondition } from './ledgerSync'
import type { MonthLedger } from './types'

/** The month a ledger file name refers to — `inkwave-ledger-2026-07.json` → `2026-07`. */
function monthOfFile(file: string): string {
  return file.replace(/^inkwave-ledger-/, '').replace(/\.json$/, '')
}

export const oneDriveLedgerRemote: LedgerRemote = {
  name: 'OneDrive',
  async read(file: string): Promise<RemoteRead> {
    const res = await readOneDriveText(file)
    if (res.status === 'absent') return { status: 'absent' }
    if (res.status === 'error') return { status: 'error', reason: res.reason }
    // Carry the VERSION we read through to the write's precondition (Finding E). parseRemoteLedger
    // owns the body; the etag is transport, so it is attached here rather than parsed out of JSON.
    const parsed = parseRemoteLedger(res.text, monthOfFile(file))
    return parsed.status === 'ok' ? { ...parsed, etag: res.etag } : parsed
  },
  async write(file: string, ledger: MonthLedger, pre: WritePrecondition): Promise<boolean> {
    return writeOneDriveText(file, JSON.stringify(ledger), pre)
  },
}

/** The provider to sync the ledger with, or null when the writer syncs nowhere. */
export function activeLedgerRemote(): LedgerRemote | null {
  return oneDriveConfigured() ? oneDriveLedgerRemote : null
}

// ─── The runner ──────────────────────────────────────────────────────────────
// Sync is NETWORK work: it runs only at session boundaries and on demand, never on the input path.
// Debounced + single-flight, because a burst of session closes must not become a burst of uploads.

const SYNC_DEBOUNCE_MS = 5_000

let timer: ReturnType<typeof setTimeout> | null = null
let inFlight: Promise<void> | null = null
let queued = new Set<string>()

async function runSync(): Promise<void> {
  const remote = activeLedgerRemote()
  const months = [...queued]
  queued = new Set()
  if (!remote || months.length === 0) return
  for (const m of months) {
    const out = await syncLedgerMonth(remote, m)
    // A refusal is a NORMAL outcome (offline, not signed in) and must be visible, not silent — but
    // it is not an error the writer needs to act on: their rows are safe locally either way.
    if (!out.ok) console.info(`[inkwave] ledger sync skipped (${m}): ${out.reason}`)
  }
}

/** Queue a debounced sync of these months. Safe to call often; never overlaps itself. */
export function syncLedgerSoon(months: readonly string[]): void {
  for (const m of months) queued.add(m)
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    // Single-flight: chain behind any run already going, so two syncs can never interleave a
    // read-modify-write on the same file.
    inFlight = (inFlight ?? Promise.resolve()).catch(() => {}).then(runSync)
  }, SYNC_DEBOUNCE_MS)
}

/** Sync now (the ledger view's explicit action / exit). Resolves when the writes land. */
export async function syncLedgerNow(months: readonly string[]): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null }
  for (const m of months) queued.add(m)
  inFlight = (inFlight ?? Promise.resolve()).catch(() => {}).then(runSync)
  await inFlight
}

/** Test seam. */
export function _resetLedgerSyncRunner(): void {
  if (timer) clearTimeout(timer)
  timer = null
  inFlight = null
  queued = new Set()
}
