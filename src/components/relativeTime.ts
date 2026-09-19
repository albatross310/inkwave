/** Short relative time shared by save/sync indicators. */
export function relativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds} seconds ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  return `${hours} hour${hours === 1 ? '' : 's'} ago`
}

/** Coarse refresh cadence for visible relative-time labels; older labels need far fewer wakes. */
export function relativeTimeRefreshDelay(timestamp: number, now = Date.now()): number {
  const age = Math.max(0, now - timestamp)
  if (age < 60_000) return 5_000
  if (age < 60 * 60_000) return 60_000
  return 60 * 60_000
}
