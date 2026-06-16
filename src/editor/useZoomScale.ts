import { useEffect, useState } from 'react'

// Keep the fixed chrome (toolbar, snapshot/sync pills) a CONSTANT on-screen size while the writer
// zooms the PAGE (Ctrl +/−) to size the text. Browser zoom scales the whole page; we counter it on
// those elements. Two deliberate choices fix the artifacts the earlier version had:
//   • counter with the CSS `zoom` property, NOT `transform: scale()` — `zoom` re-rasterises so it
//     stays crisp at any level and doesn't drift sub-pixel from a transform-origin (no blur, no move);
//   • the reference DPR is PERSISTED from the first load, so the chrome's size is stable across
//     refreshes no matter what zoom you reload at (the old per-load baseline made it jump).
// Returns 1 when not meaningfully zoomed, so the common 100% case applies no `zoom` at all.
const BASELINE_KEY = 'inkwave:dpr-baseline'

export function useZoomScale(): number {
  const [scale, setScale] = useState(1)

  useEffect(() => {
    if (typeof window === 'undefined') return
    let baseline = 0
    try { const s = localStorage.getItem(BASELINE_KEY); if (s) baseline = parseFloat(s) || 0 } catch { /* ignore */ }
    const compute = () => {
      const dpr = window.devicePixelRatio || 1
      if (!baseline) {
        baseline = dpr // first ever load = the 100% reference; persist so refreshes are stable
        try { localStorage.setItem(BASELINE_KEY, String(baseline)) } catch { /* private mode */ }
      }
      const ratio = dpr / baseline
      if (Math.abs(ratio - 1) < 0.02) { setScale(1); return } // ~reference zoom: no compensation
      setScale(Number(Math.min(4, Math.max(0.2, 1 / ratio)).toFixed(4)))
    }
    compute()
    window.addEventListener('resize', compute) // DPR/zoom changes fire a resize
    return () => window.removeEventListener('resize', compute)
  }, [])

  return scale
}
