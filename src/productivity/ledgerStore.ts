// Ledger persistence (spec §A3.1) — the writer's own storage, debounced background writes.
//
// ⚠ ZERO-RETENTION: stored like any other Inkwave document, in the writer's own OPFS. The ONLY
// thing that ever leaves the device from here is a BLOCK HASH for OTS anchoring — no prose, and
// the relay logs nothing.
// ⚠ GROW-ONLY (§A9, and the 2026-07-05 truncation incident): every write reads the target's rows
// and UNIONS first. → docs/archive/productivity-email-build.md#ledgerstore-zero-retention

import { v4 as uuidv4 } from 'uuid'
import { readAppJsonStrict, writeAppJson } from '../storage/opfs'
import { stampBundle } from '../provenance/ots'
import { attestLedger, emptyLedger, ledgerNameFor, mergeLedgerRows, mergeLedgers, mergeReflections } from './ledger'
import { buildPostHocRow, cleanText, localMonthOf, type PostHocEntry } from './sessionLogic'
import type { MonthLedger, Reflection, SessionRow } from './types'

const fileFor = (month: string): string => `${ledgerNameFor(month)}.json`

/** Debounce for background writes (§A4: "background write; debounce to avoid churn"). */
export const WRITE_DEBOUNCE_MS = 2_000

function isLedger(v: unknown): v is MonthLedger {
  const l = v as MonthLedger | null
  return !!l && l.v === 1 && typeof l.month === 'string' && Array.isArray(l.rows)
}

/**
 * ⚠ THROWS on a failed read, and that is the whole point (R1). It used to read through
 * `readAppJson`, which answers `null` to BOTH "no ledger yet" and "the disk just failed" — and
 * every caller here is a read-modify-WRITE, so `flushMonth` would write the buffered rows ALONE
 * over a real month and `saveReflection` would erase the sessions it was about. One transient
 * failure, no race. Each writer's `.catch` already recovers; the read swallowed the failure before
 * they could see it. An ABSENT file still returns an empty ledger — the one case where writing
 * cannot lose anything.
 *
 * ⚠ Do NOT quieten a noisy console with `.catch(() => emptyLedger(month))`: that is the bug again
 * in eleven characters and it typechecks. `ledgerStore.readfail.test.ts` goes red.
 * → docs/archive/productivity-email-build.md#ledgerstore-read-throws
 */
export async function loadLedger(month: string): Promise<MonthLedger> {
  const raw = await readAppJsonStrict<MonthLedger>(fileFor(month))
  // ONLY a genuinely missing file is an absence. This is the sole branch that licenses a write.
  if (raw === null) return emptyLedger(month)
  // Present but unrecognised (a future schema, a foreign file under our name) — NOT an absence.
  // `parseRemoteLedger` has always called this an error for the REMOTE copy; the LOCAL copy read it
  // as empty and overwrote it. That asymmetry — the far copy guarded, the near one not — is the
  // 2026-07-15 bug's own signature (snapshots grow-only, `current.json` blind). An older build must
  // refuse a newer ledger, not flatten it.
  if (!isLedger(raw)) throw new Error(`ledger ${fileFor(month)} has an unrecognised shape — refusing to overwrite it`)
  return {
    v: 1, month,
    rows: raw.rows.filter((r) => r && r.session_id),
    ...(raw.reflections?.length ? { reflections: raw.reflections.filter((r) => r && r.reflection_id) } : {}),
    attestations: raw.attestations ?? [],
  }
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

/**
 * Add a block the writer TOLD us about (§A5's repair tool).
 *
 * ⚠ THROUGH `queueRow` — the SAME grow-only, read-then-union, re-attested path as a measured row.
 * The honesty is `entered: 'post-hoc'` on the row, never a softer write path; a second storage
 * route would be a second rule for one question. Flushed immediately (he typed it on purpose and
 * expects to see it) and returns the row so the caller can show what landed.
 */
export async function addPostHocRow(entry: PostHocEntry, opts: { at?: number; offsetMin?: number; sessionId?: string } = {}): Promise<SessionRow> {
  const at = opts.at ?? Date.now()
  const offsetMin = opts.offsetMin ?? -new Date().getTimezoneOffset()
  const row = buildPostHocRow(entry, { sessionId: opts.sessionId ?? uuidv4(), at, offsetMin })
  queueRow(localMonthOf(row.start), row)
  await flushLedgerNow()
  return row
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
 * written at session END, by which time the row is on disk). Flushes first so a row still in the
 * debounce buffer can be annotated, then ONE read-modify-write on the ledger's own chain, and
 * re-attests. Returns false when the session isn't in this month.
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

/**
 * Union an incoming ledger (another device's, via cloud sync) into the LOCAL file. Grow-only.
 *
 * ⚠ ON THE SAME PER-MONTH WRITE CHAIN as every other write, and it re-reads local FRESH inside the
 * chain: the gap between a read and a write is exactly where a blind overwrite lives.
 */
export async function mergeIntoLocalLedger(month: string, incoming: MonthLedger): Promise<MonthLedger> {
  let result: MonthLedger = incoming
  const prev = _chain.get(month) ?? Promise.resolve()
  const next = prev
    .catch(() => { /* keep the chain alive */ })
    .then(async () => {
      const local = await loadLedger(month)
      const merged = await mergeLedgers(local, incoming)
      // Only write when the union actually differs — a no-op write is a chance to corrupt for nothing.
      if (merged.rows.length !== local.rows.length || anchorsDiffer(local, merged)) {
        await writeAppJson(fileFor(month), merged)
      }
      result = merged
    })
    .catch((err) => {
      console.warn('[inkwave] ledger local merge failed:', err)
      result = incoming
    })
  _chain.set(month, next)
  await next
  return result
}

/** True when the merge gained or upgraded any OTS proof — worth persisting even at equal row count. */
function anchorsDiffer(a: MonthLedger, b: MonthLedger): boolean {
  const rank = (s: string): number => (s === 'confirmed' ? 2 : s === 'pending' ? 1 : 0)
  const byDay = new Map(a.attestations.map((x) => [x.day, x]))
  return b.attestations.some((x) => {
    const prev = byDay.get(x.day)
    return !prev || prev.blockHash !== x.blockHash || rank(x.ots.status) > rank(prev.ots.status)
  })
}

/**
 * Save the writer's reflection on a stretch. Grow-only, on the same per-month chain as every other
 * write: read fresh, union by `reflection_id`, re-attest (so their account is inside the day's
 * tamper-evident block with the measurements it describes), write.
 */
export async function saveReflection(month: string, reflection: Reflection): Promise<void> {
  await flushLedgerNow()
  const prev = _chain.get(month) ?? Promise.resolve()
  const next = prev
    .catch(() => { /* keep the chain alive */ })
    .then(async () => {
      const l = await loadLedger(month)
      const reflections = mergeReflections(l.reflections ?? [], [reflection])
      await writeAppJson(fileFor(month), await attestLedger({ ...l, reflections }))
    })
    .catch((err) => console.warn('[inkwave] reflection write failed:', err))
  _chain.set(month, next)
  await next
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
 * ⚠ NEVER ON LOAD (the sweep once cost ~10s per open) and ONLY for days that are DONE: today's
 * block still gains rows, so stamping it burns a proof on a block that will not exist by evening.
 * `todayLocal` is the writer's current local day ('YYYY-MM-DD').
 * → docs/archive/productivity-email-build.md#ledgerstore-ots
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
