// Open-path instrumentation: performance.now() marks across download → parse → snapshots → save →
// dispatch → settled, logged as ONE console.info line per open, e.g.
//   [inkwave] open (onedrive): download 840ms (cache miss), parse 120ms, snapshots 15ms, save 40ms, dispatch→settled 610ms, total 1625ms
// so real numbers can be read straight off the console. Zero-cost when idle; every entry point is
// guarded so a missing/duplicate mark can never break an open.

type Pending = { t0: number; last: number; parts: string[]; source: string }
let cur: Pending | null = null

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** Begin timing an open. Called by the cloud handlers (before the download) and by openInkwaveFile
 *  itself for local opens (idempotent — a pending run isn't restarted). */
export function openPerfStart(source: string): void {
  if (cur) return // the cloud handler already started this open; openInkwaveFile keeps its marks
  cur = { t0: now(), last: now(), parts: [], source }
}

/** Record one step's duration (since the previous mark), with an optional note ("cache hit"). */
export function openPerfStep(name: string, note?: string): void {
  if (!cur) return
  const t = now()
  cur.parts.push(`${name} ${Math.round(t - cur.last)}ms${note ? ` (${note})` : ''}`)
  cur.last = t
}

/** The open failed — drop the pending marks silently. */
export function openPerfAbort(): void {
  cur = null
}

/** The open-doc event just dispatched: wait for the editor's reveal ('inkwave:editor-revealed'),
 *  then log the single summary line. A timeout fallback logs anyway if no reveal arrives. */
export function openPerfDispatched(): void {
  if (!cur || typeof window === 'undefined') { cur = null; return }
  const p = cur
  cur = null
  const dispatchedAt = now()
  let logged = false
  const finish = (settledPart: string) => {
    if (logged) return
    logged = true
    window.removeEventListener('inkwave:editor-revealed', onReveal)
    const total = Math.round(now() - p.t0)
    console.info(`[inkwave] open (${p.source}): ${[...p.parts, settledPart].join(', ')}, total ${total}ms`)
  }
  const onReveal = () => finish(`dispatch→settled ${Math.round(now() - dispatchedAt)}ms`)
  window.addEventListener('inkwave:editor-revealed', onReveal)
  setTimeout(() => finish('dispatch→settled n/a'), 8000)
}
