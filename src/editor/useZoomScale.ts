import { useEffect, useState } from 'react'

// Keep the fixed chrome (toolbar, snapshot/sync pills) from ballooning when the writer zooms the PAGE
// (Ctrl +/−) to size the text. Browser zoom scales the whole page; we counter it on those elements
// with the CSS `zoom` property (crisp, no transform drift).
//
// Two things that killed the earlier versions' flicker/expansion:
//   • the scale is computed SYNCHRONOUSLY in the useState initialiser (from the persisted baseline +
//     current DPR), so the very first paint is already correct — no "right size then jumps" flash;
//   • the scale is CLAMPED to ≤ 1 — we only ever SHRINK the chrome when you zoom in past the baseline,
//     never enlarge it. So a stale baseline can't make the toolbar balloon on load.
const BASELINE_KEY = 'inkwave:dpr-baseline-v2'

function readBaseline(): number {
  if (typeof window === 'undefined') return 0
  try { return parseFloat(localStorage.getItem(BASELINE_KEY) || '') || 0 } catch { return 0 }
}
function scaleFor(baseline: number): number {
  if (typeof window === 'undefined' || !baseline) return 1
  const ratio = (window.devicePixelRatio || 1) / baseline
  if (Math.abs(ratio - 1) < 0.02) return 1 // at/near the reference zoom: no compensation
  return Math.min(1, Number((1 / ratio).toFixed(4))) // clamp ≤1: shrink when zoomed in, never enlarge
}

export function useZoomScale(): number {
  const [scale, setScale] = useState(() => scaleFor(readBaseline()))

  useEffect(() => {
    if (typeof window === 'undefined') return
    let baseline = readBaseline()
    if (!baseline) { // first ever load = the reference; persist so later loads are stable + flash-free
      baseline = window.devicePixelRatio || 1
      try { localStorage.setItem(BASELINE_KEY, String(baseline)) } catch { /* private mode */ }
    }
    const compute = () => setScale(scaleFor(baseline))
    compute()
    window.addEventListener('resize', compute) // DPR/zoom changes fire a resize
    return () => window.removeEventListener('resize', compute)
  }, [])

  return scale
}
