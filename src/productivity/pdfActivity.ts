// PDF reading/annotating activity (Peter, 2026-07-17): "Pdf pure reading time and annotating time
// can be 2 separate things. We can treat inkwave as a pdf reader and track when people have done an
// annotation in the last 5 minutes." / "We can also track whether they are scrolling in the pdf.
// that can be stored client side and go into a reading indicator on the ledger, next to a pdf name."
//
// ─── WHY SCROLLING IS THE EVIDENCE, AND WHY THE THIRD STATE IS THE POINT ──────
//
// Without scroll, "reading time" means only *a PDF was open* — which counts a tab you forgot about
// as work. So there are three states, and the third is what keeps the number true:
//   • scrolling, no annotation      → `reading`
//   • annotation in the last 5 min  → `annotating`
//   • open, no scroll, no annotation → NOT WORK. Never counted as reading.
// The third state is not a failure to detect anything; it is the honest answer, in the same family
// as `misc` (capture.ts): the PDF was open, and we did not observe reading.
//
// ─── A BOOLEAN, NOT A TRACE (§A3.2) ──────────────────────────────────────────
//
// The indicator needs "was there scroll activity in this window", NOT a scroll-position trace. §A3.2's
// bar is "does a real feature need this?", and a page-by-page reading trace of the writer's private
// PDFs is a far more sensitive object for no feature gain. So this module holds, per citekey, exactly
// TWO NUMBERS: when we last saw a scroll, and when we last saw an annotation. No page, no offset, no
// count, no history. There is NO PROGRESS BAR — that was considered and rejected; if the indicator
// ever seems to need progress, that is a question for Peter, not a field to add here.
//
// ─── TYPING/SCROLL PERFORMANCE (CLAUDE.md: the PDF surface is supersampled + lazily rendered) ──
//
// `noteScroll` rides PdfViewer's EXISTING rAF-coalesced scroll reporter — the same discipline as the
// ledger's edit-stream capture, which rides the editor's existing `onTransaction`. It does no new
// instrumentation, adds no listener, and per call does: one Map lookup, one number write. It NEVER
// touches localStorage — persistence is a separate low-frequency timer (PERSIST_DEBOUNCE_MS), so a
// scroll burst cannot reach the disk. `pdfActivity.perf.test.ts` asserts that STRUCTURALLY (it counts
// storage writes across a burst) rather than by timing a clock on a shared box.

import type { DocType } from './types'

/**
 * How recent an observation must be to count (§A4's DEFAULT_IDLE_MS, deliberately the same number).
 *
 * Peter named 5 minutes for annotation. Scroll takes the same window and the symmetry is principled,
 * not cosmetic: both answer the identical question the idle watcher asks of the editor — "are they
 * still here?" — so a third constant would be a third answer to one question.
 */
export const PDF_ACTIVITY_WINDOW_MS = 5 * 60_000

/** How often observations may reach the disk. A scroll burst writes NOTHING; this timer does. */
export const PERSIST_DEBOUNCE_MS = 10_000

const STORE_KEY = 'inkwave:pdfActivity'

/** What we observed of one PDF. Two timestamps. That is the whole record. */
interface PdfActivity {
  /** epoch ms of the last scroll we saw. */
  scrollAt?: number
  /** epoch ms of the last annotation we saw. */
  annotateAt?: number
}

/** The three states. `idle` = open, unread — NOT work, and never counted as reading. */
export type PdfReadingState = 'reading' | 'annotating' | 'idle'

// ─── The pure rule (unit-testable without a DOM, a disk or a PDF) ────────────

/**
 * The state one PDF is in, given what we observed and when we are asking.
 *
 * ANNOTATION WINS over scroll: you scroll while you annotate, so a reader who is marking up a page is
 * annotating, not merely reading. Counting the same minutes as both would be the exact double-count
 * §A6.4 forbids elsewhere.
 */
export function readingStateOf(a: PdfActivity | undefined, now: number, windowMs = PDF_ACTIVITY_WINDOW_MS): PdfReadingState {
  if (!a) return 'idle'
  if (a.annotateAt !== undefined && now - a.annotateAt < windowMs) return 'annotating'
  if (a.scrollAt !== undefined && now - a.scrollAt < windowMs) return 'reading'
  return 'idle'
}

/**
 * The doc_type a session's row should carry, given what the document DECLARED and what we observed.
 *
 * THE RULE, and every clause is load-bearing:
 *  • A DECLARED type is never overridden. The email layer's `docType: 'email'` is a claim by the
 *    layer that owns the document; PDF activity is an observation about a different surface. An
 *    observation must not overwrite a declaration.
 *  • The rule fires ONLY where the honest answer was `misc` — i.e. only where capture.ts had already
 *    concluded "they were working; we don't know at what". So this can only ever REPLACE AN ADMITTED
 *    UNKNOWN with something observed. It cannot make any existing row less true.
 *  • It fires ONLY when `editEvents === 0`. A session with typing in it is a writing session whatever
 *    else happened alongside; filing it as `reading` would put reading in the same column as the
 *    words written, which is the one conflation this feature exists to prevent.
 *  • No activity ⇒ `misc` STANDS. A Pomodoro block with a PDF open and no scroll is still a measured
 *    block (starting the timer IS the claim of work — see capture.ts), we simply never claim it was
 *    reading. Not-work-for-the-reading-number and not-a-session are different things; don't collapse.
 */
export function observedDocType(
  declared: DocType,
  editEvents: number,
  observed: { scrolled: boolean; annotated: boolean },
): DocType {
  if (declared !== 'misc' || editEvents > 0) return declared
  if (observed.annotated) return 'annotating'
  if (observed.scrolled) return 'reading'
  return declared
}

// ─── The store ───────────────────────────────────────────────────────────────

/**
 * In-memory, keyed by citekey. UNPRUNED for the session's lifetime (two numbers per PDF), because
 * `activityDuring` must be able to answer about a 25-minute block that ended six minutes ago — a map
 * pruned to the window would forget exactly the reading it is meant to attribute. What is PERSISTED
 * is pruned (see `persist`), so nothing accumulates on disk.
 */
let _mem: Map<string, PdfActivity> | null = null
let _persistTimer: ReturnType<typeof setTimeout> | null = null
let _dirty = false

function mem(): Map<string, PdfActivity> {
  if (_mem) return _mem
  _mem = new Map()
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, PdfActivity>
      const now = Date.now()
      for (const [k, v] of Object.entries(parsed)) {
        // Load-time prune: an entry outside the window can only ever read as `idle`, so keeping it
        // would be storing a record of which PDFs were opened and when for no feature at all.
        if (readingStateOf(v, now) !== 'idle') _mem.set(k, v)
      }
    }
  } catch { /* private mode / malformed — start empty; this is an indicator, not a record */ }
  return _mem
}

function touch(citekey: string, field: 'scrollAt' | 'annotateAt', at: number): void {
  const m = mem()
  const cur = m.get(citekey)
  if (cur) cur[field] = at
  else m.set(citekey, { [field]: at })
  _dirty = true
  schedulePersist()
}

/**
 * THE SCROLL PATH. Called from PdfViewer's existing rAF-coalesced scroll reporter.
 * One Map lookup + one number write. No storage, no allocation on the hot path, no React.
 */
export function noteScroll(citekey: string, at: number = Date.now()): void {
  touch(citekey, 'scrollAt', at)
}

/** An annotation was made (highlight/underline/strike/text note). Event-driven; never per-frame. */
export function noteAnnotation(citekey: string, at: number = Date.now()): void {
  touch(citekey, 'annotateAt', at)
}

/** The state one PDF is in right now — what the ledger's reading indicator reads. */
export function pdfReadingState(citekey: string, now: number = Date.now()): PdfReadingState {
  return readingStateOf(mem().get(citekey), now)
}

/** Every PDF with live activity, for the indicator. Sorted most-recent first; `idle` never appears. */
export function activePdfs(now: number = Date.now()): Array<{ citekey: string; state: PdfReadingState; at: number }> {
  const out: Array<{ citekey: string; state: PdfReadingState; at: number }> = []
  for (const [citekey, a] of mem()) {
    const state = readingStateOf(a, now)
    if (state === 'idle') continue
    out.push({ citekey, state, at: Math.max(a.scrollAt ?? 0, a.annotateAt ?? 0) })
  }
  return out.sort((x, y) => y.at - x.at)
}

/**
 * Did we observe reading/annotating between two instants? A BOOLEAN PAIR — the capture path's whole
 * question, and deliberately not "how much" or "where": we hold last-seen only, so any claim about
 * quantity would be an invention. `[from, to]` is the session's own span.
 */
export function activityDuring(from: number, to: number): { scrolled: boolean; annotated: boolean } {
  let scrolled = false, annotated = false
  for (const a of mem().values()) {
    if (a.scrollAt !== undefined && a.scrollAt >= from && a.scrollAt <= to) scrolled = true
    if (a.annotateAt !== undefined && a.annotateAt >= from && a.annotateAt <= to) annotated = true
    if (scrolled && annotated) break
  }
  return { scrolled, annotated }
}

// ─── Persistence (client-side only — this never leaves the device) ───────────

function schedulePersist(): void {
  if (_persistTimer !== null || typeof window === 'undefined') return
  _persistTimer = setTimeout(() => { _persistTimer = null; persist() }, PERSIST_DEBOUNCE_MS)
}

/**
 * Write the window's observations. PRUNES on every write, so the stored object can only ever hold the
 * last few minutes — it is structurally incapable of becoming a reading history.
 */
export function persist(): void {
  if (!_dirty) return
  _dirty = false
  try {
    const now = Date.now()
    const out: Record<string, PdfActivity> = {}
    for (const [k, v] of mem()) if (readingStateOf(v, now) !== 'idle') out[k] = v
    if (Object.keys(out).length === 0) localStorage.removeItem(STORE_KEY)
    else localStorage.setItem(STORE_KEY, JSON.stringify(out))
  } catch { /* private mode — the indicator stays session-only, which is a fine degradation */ }
}

/** Test seam. */
export function _resetPdfActivity(): void {
  if (_persistTimer !== null) clearTimeout(_persistTimer)
  _persistTimer = null
  _mem = null
  _dirty = false
}
