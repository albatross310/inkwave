import { useEffect, useState } from 'react'
import { browserZoomPercent, readOrCreateBrowserZoomBaseline } from '../pwa/browserZoom'

/** Quiet diagnostic only; it never participates in layout or intercepts a pointer. */
export function BrowserZoomIndicator() {
  const [percent, setPercent] = useState(100)

  useEffect(() => {
    const baseline = readOrCreateBrowserZoomBaseline(localStorage, window.devicePixelRatio || 1)
    const update = () => setPercent(browserZoomPercent(window.devicePixelRatio || 1, baseline))
    update()
    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('resize', update)
    }
  }, [])

  return (
    <output
      className="iw-browser-zoom-indicator"
      aria-label={`Estimated browser zoom ${percent}%`}
      title="Estimated browser zoom (relative to this device’s saved 100% reference)"
    >
      {percent}%
    </output>
  )
}
