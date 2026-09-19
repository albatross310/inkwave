import { useEffect, useState } from 'react'
import { relativeTime, relativeTimeRefreshDelay } from './relativeTime'

function savedAt(value: string): number | null {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Gmail-like feedback for the automatic LOCAL draft save. This intentionally does not say
 * “synced”: that word is reserved for a provider acknowledgement once Gmail Draft sync exists.
 * State lives here so each save does not re-render the full editor tree.
 */
export function EmailDraftSaveStatus({ initialSavedAt, lastSyncedAt }: { initialSavedAt: string; lastSyncedAt?: string | null }) {
  const [lastSaved, setLastSaved] = useState<number | null>(() => savedAt(initialSavedAt))
  const lastSynced = lastSyncedAt ? savedAt(lastSyncedAt) : null
  const [, tick] = useState(0)
  const showingSynced = lastSynced != null && (lastSaved == null || lastSynced >= lastSaved)
  const displayTime = showingSynced ? lastSynced : lastSaved

  useEffect(() => {
    const onSaved = () => setLastSaved(Date.now())
    window.addEventListener('inkwave:doc-saved', onSaved)
    return () => window.removeEventListener('inkwave:doc-saved', onSaved)
  }, [])

  useEffect(() => {
    if (displayTime == null) return
    let timer = 0
    const schedule = () => {
      window.clearTimeout(timer)
      if (document.hidden) return
      timer = window.setTimeout(() => { tick((value) => value + 1); schedule() }, relativeTimeRefreshDelay(displayTime))
    }
    const onVisibility = () => { if (!document.hidden) tick((value) => value + 1); schedule() }
    schedule()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility) }
  }, [displayTime])

  return (
    <span
      className="iw-email-draft-save-status"
      title={showingSynced
        ? 'Google acknowledged this Gmail draft revision'
        : 'This draft is saved automatically on this device'}
    >
      {showingSynced
        ? `Last synced ${relativeTime(lastSynced)}`
        : lastSaved == null ? 'Saving locally…' : `Saved locally ${relativeTime(lastSaved)}`}
    </span>
  )
}
