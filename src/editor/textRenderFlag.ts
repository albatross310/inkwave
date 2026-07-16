// The `inkwave:textRender` flag, ALONE in its own module.
//
// Why it isn't in textRender.ts: TiptapEditor must read the flag to decide whether to lazy-load the
// renderer, and a static import of textRender.ts for that one function pulls the whole paint path
// (fillText, the map strip, the page model) into the editor chunk even when the flag is OFF —
// tree-shaking can't drop it once another chunk imports the same module. Keeping the flag separate
// makes "flag off ⇒ zero bundle cost" literally true rather than nearly true.
//
// Sticky, resolved once per load (the `?auth` / snapThumbs pattern — a flag read fresh from the URL
// dies the moment any route rewrites it). `?textRender` on · `?textRender=off` clears.
// entry.client.tsx does the URL→localStorage sync before the app reads anything.

const FLAG = 'inkwave:textRender'
let _flag: boolean | null = null

export function textRenderEnabled(): boolean {
  const w = typeof window !== 'undefined' ? (window as unknown as { __iwTextRender?: boolean }) : null
  if (w && typeof w.__iwTextRender === 'boolean') return w.__iwTextRender
  if (_flag !== null) return _flag
  try { _flag = typeof localStorage !== 'undefined' && localStorage.getItem(FLAG) === '1' } catch { _flag = false }
  return _flag
}

/** Test seam: forget the cached flag read. */
export function _resetTextRenderFlag(): void { _flag = null }
