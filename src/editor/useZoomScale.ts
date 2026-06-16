import { useEffect, useState } from 'react'

// Keep the fixed chrome (toolbar, snapshot/sync pills) from ballooning when the writer zooms the PAGE
// (Ctrl +/−) to size the text. Browser zoom scales the whole page; we counter it on those elements
// with the CSS `zoom` property (crisp, no transform drift).
//
// The scale is computed SYNCHRONOUSLY in the useState initialiser (from the persisted baseline +
// current DPR), so the very first paint is already correct — no "right size then jumps" flash. It
// compensates in BOTH directions (shrink when zoomed in, enlarge when zoomed out) so the chrome holds
// a constant on-screen size at any zoom.
const BASELINE_KEY = 'inkwave:dpr-baseline-v2'

function readBaseline(): number {
  if (typeof window === 'undefined') return 0
  try { return parseFloat(localStorage.getItem(BASELINE_KEY) || '') || 0 } catch { return 0 }
}
function scaleFor(baseline: number): number {
  if (typeof window === 'undefined' || !baseline) return 1
  const ratio = (window.devicePixelRatio || 1) / baseline
  if (Math.abs(ratio - 1) < 0.02) return 1 // at/near the reference zoom: no compensation
  return Number(Math.min(4, Math.max(0.25, 1 / ratio)).toFixed(4)) // constant size both directions
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
