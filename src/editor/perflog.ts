// Gated on-device performance capture — for chasing PHONE typing lag without desktop devtools.
// Enable with localStorage 'inkwave:perflog' = '1' (then reload); off = zero work, zero console
// noise for normal users. Callers report per-task durations via notePerf; the worst value per
// label in each 2s window is printed as ONE throttled console.info line, readable in the iOS
// inspector / Eruda. The flag is cached at first read (per-keystroke callers must not touch
// localStorage) — toggling requires a reload, which is how it's used anyway.

const FLAG = 'inkwave:perflog'
let cached: boolean | null = null

export function perflogEnabled(): boolean {
  if (cached !== null) return cached
  if (typeof window === 'undefined') return false
  try { cached = window.localStorage.getItem(FLAG) === '1' } catch { cached = false }
  return cached
}

let worst: Record<string, number> = {}
let flushTimer: ReturnType<typeof setTimeout> | null = null

function flush() {
  flushTimer = null
  const entries = Object.entries(worst)
  worst = {}
  if (!entries.length) return
  const line = entries.map(([label, ms]) => `${label} ${ms.toFixed(1)}ms`).join('  ')
  console.info(`[inkwave:perf] worst in last 2s — ${line}`)
}

/** Record a task duration under `label`. No-op unless the perflog flag is on. */
export function notePerf(label: string, ms: number): void {
  if (!perflogEnabled()) return
  if (ms > (worst[label] ?? -1)) worst[label] = ms
  if (!flushTimer) flushTimer = setTimeout(flush, 2000)
}
