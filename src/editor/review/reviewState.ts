// Review-layer client state: the active annotation SET (which comments/suggestions new ones join and
// which are shown), and whether live suggestion (track-changes) mode is on. Persisted in localStorage
// and broadcast via a custom event so the toolbar, sticky notes, and editor stay in sync. The set
// LIST is derived from the document itself (distinct `set` attrs on comment marks) so it travels with
// the doc; this module only holds the active-set pointer + the suggest toggle.

const K_SET = 'inkwave:reviewActiveSet'
const K_SUGGEST = 'inkwave:reviewSuggest'
const EVT = 'inkwave:review-changed'

const ls = (k: string): string | null => { try { return localStorage.getItem(k) } catch { return null } }
const setLs = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
const fire = () => window.dispatchEvent(new Event(EVT))

export function onReviewChanged(fn: () => void): () => void {
  window.addEventListener(EVT, fn)
  return () => window.removeEventListener(EVT, fn)
}

export const DEFAULT_SET = 'Notes'

export function activeSet(): string { return ls(K_SET) || DEFAULT_SET }
export function setActiveSet(name: string): void { setLs(K_SET, name || DEFAULT_SET); fire() }

export function suggestOn(): boolean { return ls(K_SUGGEST) === '1' }
export function setSuggestOn(v: boolean): void { setLs(K_SUGGEST, v ? '1' : '0'); fire() }
