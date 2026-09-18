// ─── Load warmth — is this the FIRST time this tab has opened Inkwave? ─────────────────────────
// Peter, 2026-09-17: "first opening inkwave or a new full doc is the only time we need to make it
// take longer than minimum." Every other full page load in the same tab — the snapshot view and
// the way back, a reload — is WARM: the loading tip's three-second countdown drops to zero and the
// reveal no longer waits for the water to coast to rest; it opens the instant the document is
// ready. sessionStorage is PER TAB, so New doc / New blank (new windows) are cold by construction;
// Change doc clears the mark so a different document in this tab is cold again.

const KEY = 'inkwave:warm'

export function isWarmLoad(): boolean {
  try { return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(KEY) === '1' } catch { return false }
}

/** Call once the editor has revealed: every later load in this tab is warm. */
export function markWarm(): void {
  try { sessionStorage.setItem(KEY, '1') } catch { /* private mode — every load stays cold */ }
}

/** A different document is about to open in this tab: its first load is cold. */
export function clearWarm(): void {
  try { sessionStorage.removeItem(KEY) } catch { /* nothing to clear */ }
}
