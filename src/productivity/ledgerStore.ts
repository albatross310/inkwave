// Ledger persistence (spec §A3.1) — the writer's own storage, debounced background writes.
//
// ZERO-RETENTION: the ledger is stored exactly like any other Inkwave document — in the writer's
// own storage (OPFS, via the same app-level JSON helpers the rest of the app uses). Inkwave's
// servers never hold it. The ONLY thing that ever leaves the device from this module is a
// BLOCK HASH sent to the OTS relay for Bitcoin anchoring (a hash of metadata hashes — it carries no
// prose, and the relay logs nothing; see provenance/ots.ts).
//
// GROW-ONLY (§A9, and the real 2026-07-05 truncation incident in CLAUDE.md): every write reads the
// target's current rows and UNIONS first. A write can only ever grow the ledger.

import { readAppJson, writeAppJson } from '../storage/opfs'
import { stampBundle } from '../provenance/ots'
import { attestLedger, emptyLedger, ledgerNameFor, mergeLedgerRows } from './ledger'
import { cleanText } from './sessionLogic'
import type { MonthLedger, SessionRow } from './types'

const fileFor = (month: string): string => `${ledgerNameFor(month)}.json`

/** Debounce for background writes (§A4: "background write; debounce to avoid churn"). */
export const WRITE_DEBOUNCE_MS = 2_000

function isLedger(v: unknown): v is MonthLedger {
  const l = v as MonthLedger | null
  return !!l && l.v === 1 && typeof l.month === 'string' && Array.isArray(l.rows)
}

/** Read a month's ledger from the writer's storage. Missing/corrupt → an empty ledger (never throws). */
export async function loadLedger(month: string): Promise<MonthLedger> {
  const raw = await readAppJson<MonthLedger>(fileFor(month))
  if (!isLedger(raw)) return emptyLedger(month)
  return { v: 1, month, rows: raw.rows.filter((r) => r && r.session_id), attestations: raw.attestations ?? [] }
}

// ── Serialised, debounced write path ─────────────────────────────────────────
// Rows are buffered per month and flushed on a debounce; writes are chained per month so two
// flushes can never interleave a read-modify-write (which is how an append gets lost).

const _pending = new Map<string, SessionRow[]>()
const _timers = new Map<string, ReturnType<typeof setTimeout>>()
const _chain = new Map<string, Promise<void>>()

/** Merge pending rows into the stored ledger, re-attest, and write. Grow-only by construction. */
async function flushMonth(month: string): Promise<void> {
  const rows = _pending.get(month)
  if (!rows || rows.length === 0) return
  _pending.set(month, [])

  const prev = _chain.get(month) ?? Promise.resolve()
  const next = prev
    .catch(() => { /* keep the chain alive after a failed predecessor */ })
    .then(async () => {
      // READ-THEN-UNION: the on-disk copy may hold rows this device never saw (another device's
      // sync landed underneath us). Union first, always — never write `rows` alone.
      const stored = await loadLedger(month)
      const merged = mergeLedgerRows(stored.rows, rows)
      const attested = await attestLedger({ v: 1, month, rows: merged, attestations: stored.attestations })
      await writeAppJson(fileFor(month), attested)
    })
    .catch((err) => {
      // A failed write must not lose the rows — put them back for the next flush.
      const back = _pending.get(month) ?? []
      _pending.set(month, [...rows, ...back])
      console.warn('[inkwave] ledger write failed; rows retained for retry:', err)
    })
  _chain.set(month, next)
  return next
}

/**
 * Queue a row for its month's ledger and schedule a debounced background write.
 * Called on session close; `flushLedgerNow` forces it on save/idle/exit.
 */
export function queueRow(month: string, row: SessionRow): void {
  const buf = _pending.get(month) ?? []
  buf.push(row)
  _pending.set(month, buf)

  const t = _timers.get(month)
  if (t) clearTimeout(t)
  _timers.set(
    month,
    setTimeout(() => {
      _timers.delete(month)
      void flushMonth(month)
    }, WRITE_DEBOUNCE_MS),
  )
}

/** Flush every buffered month immediately (save / idle / exit). Resolves when the writes land. */
export async function flushLedgerNow(): Promise<void> {
  for (const [month, t] of _timers) {
    clearTimeout(t)
    _timers.delete(month)
    void month
  }
  await Promise.all([..._pending.keys()].map((m) => flushMonth(m)))
  await Promise.all([..._chain.values()])
}

/**
 * Attach the writer's diary note / place label to an already-written session (§A5 — the note is
 * written at session END, by which time the row is on disk).
 *
 * Flushes first so a row still sitting in the debounce buffer can be annotated, then does one
 * read-modify-write on the ledger's own chain. Re-attests, so the note is inside the day's
 * tamper-evident block like everything else. Returns false when the session isn't in this month.
 */
export async function annotateRow(
  month: string,
  sessionId: string,
  patch: { note?: string; place?: string },
): Promise<boolean> {
  await flushLedgerNow()
  let ok = false
  const prev = _chain.get(month) ?? Promise.resolve()
  const next = prev
    .catch(() => { /* keep the chain alive */ })
    .then(async () => {
      const l = await loadLedger(month)
      const i = l.rows.findIndex((r) => r.session_id === sessionId)
      if (i < 0) return
      const row = { ...l.rows[i] }
      // An empty string CLEARS the field (the writer deleted their note) — omit it, never store "".
      for (const k of ['note', 'place'] as const) {
        if (!(k in patch)) continue
        const v = cleanText(patch[k], k === 'place' ? 120 : 2000)
        if (v) row[k] = v
        else delete row[k]
      }
      l.rows[i] = row
      await writeAppJson(fileFor(month), await attestLedger(l))
      ok = true
    })
    .catch((err) => console.warn('[inkwave] ledger annotate failed:', err))
  _chain.set(month, next)
  await next
  return ok
}

/** True when rows are waiting to be written (test/diagnostic). */
export function hasPendingRows(): boolean {
  return [..._pending.values()].some((r) => r.length > 0)
}

/** Test seam — drop all buffered state. */
export function _resetLedgerStore(): void {
  for (const t of _timers.values()) clearTimeout(t)
  _timers.clear()
  _pending.clear()
  _chain.clear()
}

// ─── OTS anchoring (§A3.1) ───────────────────────────────────────────────────

/**
 * Anchor the ledger's CLOSED daily blocks to Bitcoin via the existing OTS relay.
 *
 * NEVER call this on load. CLAUDE.md's load-performance rule is explicit — the OTS sweep used to
 * cost ~10s on every open — so this runs only on demand/idle, and only for days that are DONE:
 * today's block still gains rows, so its hash still changes and stamping it would burn a proof on a
 * block that no longer exists by evening.
 *
 * `todayLocal` is the writer's current local day ('YYYY-MM-DD').
 */
export async function stampClosedDays(month: string, todayLocal: string): Promise<number> {
  const l = await loadLedger(month)
  let stamped = 0
  const next = [...l.attestations]
  for (let i = 0; i < next.length; i++) {
    const a = next[i]
    if (a.day >= todayLocal) continue // today (or a clock-skewed future day) is not closed yet
    if (a.ots.status !== 'unstamped') continue
    const ots = await stampBundle(a.blockHash)
    if (!ots) continue // relay unreachable — stay unstamped, retry next sweep
    next[i] = { ...a, ots }
    stamped++
  }
  if (stamped === 0) return 0

  // Re-read + union before writing back (grow-only): the sweep is async and rows may have landed.
  const fresh = await loadLedger(month)
  const merged = mergeLedgerRows(fresh.rows, l.rows)
  const attested = await attestLedger({ v: 1, month, rows: merged, attestations: next })
  await writeAppJson(fileFor(month), attested)
  return stamped
}
