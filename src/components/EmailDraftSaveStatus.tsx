import { useEffect, useState } from 'react'
import { relativeTime } from './relativeTime'

function savedAt(value: string): number | null {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Gmail-like feedback for the automatic LOCAL draft save. This intentionally does not say
 * “synced”: that word is reserved for a provider acknowledgement once Gmail Draft sync exists.
 * State lives here so each save does not re-render the full editor tree.
 */
export function EmailDraftSaveStatus({ initialSavedAt }: { initialSavedAt: string }) {
  const [lastSaved, setLastSaved] = useState<number | null>(() => savedAt(initialSavedAt))
  const [, tick] = useState(0)

  useEffect(() => {
    const onSaved = () => setLastSaved(Date.now())
    window.addEventListener('inkwave:doc-saved', onSaved)
    const timer = window.setInterval(() => tick((value) => value + 1), 5000)
    return () => {
      window.removeEventListener('inkwave:doc-saved', onSaved)
      window.clearInterval(timer)
    }
  }, [])

  return (
    <span
      className="iw-email-draft-save-status"
      title="This draft is saved automatically on this device"
    >
      {lastSaved == null ? 'Saving locally…' : `Saved locally ${relativeTime(lastSaved)}`}
    </span>
  )
}
