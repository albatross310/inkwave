// Automatic snapshot cadence (Peter, 2026-09-17): one snapshot per completed paragraph (default),
// or per completed sentence. Stored like the other ⚙ prefs (localStorage flag, change event).

const KEY = 'inkwave:snapshotEvery'

export type SnapshotEvery = 'paragraph' | 'sentence'

export function snapshotEvery(): SnapshotEvery {
  try { return localStorage.getItem(KEY) === 'sentence' ? 'sentence' : 'paragraph' } catch { return 'paragraph' }
}

export function setSnapshotEvery(v: SnapshotEvery): void {
  try { localStorage.setItem(KEY, v) } catch { /* private mode */ }
  window.dispatchEvent(new Event('inkwave:snapshot-settings-changed'))
}

export function cycleSnapshotEvery(): SnapshotEvery {
  const next: SnapshotEvery = snapshotEvery() === 'paragraph' ? 'sentence' : 'paragraph'
  setSnapshotEvery(next)
  return next
}
