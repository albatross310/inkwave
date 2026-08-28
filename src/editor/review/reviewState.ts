// Review-layer client state: the active annotation SET (which comments/suggestions new ones join and
// which are shown), and whether live suggestion (track-changes) mode is on. The set pointer and the
// visibility toggles are persisted in localStorage; SUGGEST MODE DELIBERATELY IS NOT (see below).
// All of it is broadcast via a custom event so the toolbar, sticky notes, and editor stay in sync. The set
// LIST is derived from the document itself (distinct `set` attrs on comment marks) so it travels with
// the doc; this module only holds the active-set pointer + the suggest toggle.

const K_SET = 'inkwave:reviewActiveSet'
const K_SUGGEST = 'inkwave:reviewSuggest'
const K_SHOW = 'inkwave:reviewShowChanges'
const K_HIDDEN = 'inkwave:reviewHiddenSets'
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

// ⚠ SUGGEST MODE IS DELIBERATELY NOT PERSISTED (2026-08-28, Peter: "stop the text from going
// red"). It used to live in localStorage, and that made a TRAP with no way out: the ✎ toggle is
// reachable ONLY from the review row, so closing that row — or simply reloading — left a mode that
// rewrites EVERY keystroke into a red `insertion` mark, with no visible control and nothing on
// screen saying why the writing had turned red. MEASURED on Peter's real file: his honours proposal
// carried five `insertion` marks — the title and every heading — and NOT ONE text-colour mark, so
// he was reaching for the colour menu to undo something the colour menu cannot touch, which is
// exactly what an invisible mode costs.
//
// The rule now: you can only be IN suggest mode while you can SEE the lit ✎ button. Module state,
// so a reload clears it; and TiptapEditor clears it when the review row closes. That makes the
// trap unrepresentable rather than merely unlikely — there is no stored '1' left to come back.
// The suggestions themselves are untouched: they are marks in the document and stay exactly where
// they are, to be accepted or discarded from the review bar.
let _suggest = false
export function suggestOn(): boolean { return _suggest }
export function setSuggestOn(v: boolean): void { _suggest = v; fire() }

/** Drop a legacy persisted flag so an existing writer isn't stranded in the mode on their next
 *  load. One-way: nothing writes K_SUGGEST any more. */
export function clearLegacySuggestFlag(): void {
  try { localStorage.removeItem(K_SUGGEST) } catch { /* private mode */ }
}

// ── Show/hide changes (MS-Word markup visibility) ────────────────────────────────────────────────
// Global: show the doc WITH tracked suggestions (default) or CLEAN (as-if-accepted — insertions
// render as normal text, deletion-marked text disappears; nothing is resolved, only display).
// Per-layer: each named set can be hidden independently (its suggestions + comment underlines).
// Both are pure CSS (a managed <style> tag) — the marks stay in the document untouched.

export function showChangesGlobal(): boolean { return ls(K_SHOW) !== '0' }
export function setShowChangesGlobal(v: boolean): void { setLs(K_SHOW, v ? '1' : '0'); syncReviewVisibilityStyles(); fire() }

export function hiddenSets(): string[] {
  try { const a = JSON.parse(ls(K_HIDDEN) || '[]'); return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : [] } catch { return [] }
}
export function isSetHidden(name: string): boolean { return hiddenSets().includes(name) }
export function setSetHidden(name: string, hidden: boolean): void {
  const cur = new Set(hiddenSets())
  if (hidden) cur.add(name); else cur.delete(name)
  setLs(K_HIDDEN, JSON.stringify([...cur]))
  syncReviewVisibilityStyles()
  fire()
}
// A set is effectively visible only when the global toggle is on AND it isn't individually hidden.
export function isSetVisible(name: string): boolean { return showChangesGlobal() && !isSetHidden(name) }

// Escape a string for use inside a double-quoted CSS attribute selector value.
const cssAttr = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

// The clean-view rules for one layer (or for everything when `set` is null — the global hide).
// Insertions must fall back to the surrounding text colour (the inline gradient uses
// -webkit-text-fill-color:transparent, so both it and the background must be overridden).
function cleanRules(set: string | null): string {
  const sug = set == null ? '' : `[data-set="${cssAttr(set)}"]`       // suggestion marks carry data-set
  const com = set == null ? '' : `[data-comment-set="${cssAttr(set)}"]` // comment marks carry data-comment-set
  return (
    `.ProseMirror ins.iw-ins${sug}{background:none !important;-webkit-text-fill-color:currentColor !important;color:inherit !important;}` +
    `.ProseMirror del.iw-del${sug}{display:none !important;}` +
    `.ProseMirror span.iw-comment${com}{background:transparent !important;border-bottom:none !important;}`
  )
}

// Maintain the <style> tag that realises the current visibility state. Idempotent; call on boot
// (TiptapEditor mount) and from the setters above. No-op outside the browser (prerender).
export function syncReviewVisibilityStyles(): void {
  if (typeof document === 'undefined') return
  let el = document.getElementById('iw-review-visibility') as HTMLStyleElement | null
  if (!el) { el = document.createElement('style'); el.id = 'iw-review-visibility'; document.head.appendChild(el) }
  let css = ''
  if (!showChangesGlobal()) {
    css = cleanRules(null)
  } else {
    for (const name of hiddenSets()) css += cleanRules(name)
  }
  el.textContent = css
}
