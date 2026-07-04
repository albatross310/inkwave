// One-time coach toast shown the first time a citation is inserted on this device. The "seen" flag is
// device-scoped (localStorage) so it never repeats across documents; when auth lands, a per-account
// flag (DB) can gate it too — see hasSeen()'s logged-in seam.

export const CITATION_TOAST_EVENT = 'inkwave:toast'
const SEEN_KEY = 'inkwave:seenCitationToast'

const TOAST_TEXT = 'Tip: click & hold a citation to add page numbers — or highlight quotes in the source PDF and the pages fill in automatically.'

function hasSeen(): boolean {
  // Future: if a logged-in account flag says seen, return true here too.
  try { return localStorage.getItem(SEEN_KEY) === '1' } catch { return false }
}
function markSeen(): void {
  try { localStorage.setItem(SEEN_KEY, '1') } catch { /* private mode — just show once per session */ }
}

/** Call after inserting a citation. Shows the coach toast once per device. */
export function maybeShowCitationToast(): void {
  if (typeof window === 'undefined' || hasSeen()) return
  markSeen()
  window.dispatchEvent(new CustomEvent(CITATION_TOAST_EVENT, { detail: { text: TOAST_TEXT } }))
}
