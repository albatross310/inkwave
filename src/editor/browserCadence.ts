// Engine capabilities for the decorative water only. User-driven zoom follows requestAnimationFrame
// directly: adding a timer ceiling before rAF can miss the next display refresh and halve cadence.

export function isWebKitEngine(userAgent: string): boolean {
  return /AppleWebKit/i.test(userAgent) && /Safari\//i.test(userAgent)
    && !/(?:HeadlessChrome|Chrome|Chromium|Edg|OPR)\//i.test(userAgent)
}

/** Safari keeps the water artwork, but ordinary document scroll does not animate it. */
export function scrollWaterMovesFor(userAgent: string): boolean {
  return !isWebKitEngine(userAgent)
}

/** Safari 26.4 is the first release where scroll-driven animations run on a threaded path. */
export function threadedScrollWaterFor(userAgent: string, cssTimelineSupported: boolean): boolean {
  if (!cssTimelineSupported || !isWebKitEngine(userAgent)) return false
  const match = /Version\/(\d+)(?:\.(\d+))?/i.exec(userAgent)
  if (!match) return false
  const major = Number(match[1])
  const minor = Number(match[2] ?? 0)
  return major > 26 || (major === 26 && minor >= 4)
}
