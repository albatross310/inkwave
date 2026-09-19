import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ONE_DRIVE_BLUE as ONE } from './oneDriveBrand'

/** Recovery belongs over the still-open document; it never replaces or clears editor state. */
export function OneDriveSignInRecoveryDialog({
  message,
  onRetry,
  onBack,
}: {
  message: string
  onRetry: () => void | Promise<void>
  onBack: () => void
}) {
  const [retrying, setRetrying] = useState(false)
  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" onMouseDown={onBack}>
      <div className="absolute inset-0 bg-stone-900/20" aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="OneDrive sign-in did not finish"
        onMouseDown={(event) => event.stopPropagation()}
        className="relative iw-nightable bg-white w-full max-w-sm p-6 shadow-xl"
        style={{ border: `1px solid ${ONE}66`, borderRadius: 14 }}
      >
        <h2 className="font-serif text-xl mb-2" style={{ color: 'var(--iw-ink, #302438)' }}>
          OneDrive sign-in didn’t finish
        </h2>
        <p className="font-sans text-sm text-stone-600 mb-5">{message}</p>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={retrying}
            onClick={async () => {
              setRetrying(true)
              try { await onRetry() } finally { setRetrying(false) }
            }}
            className="px-4 py-2.5 rounded-lg font-sans font-medium text-white disabled:opacity-60"
            style={{ background: ONE }}
          >
            {retrying ? 'Opening…' : 'Try again'}
          </button>
          <button
            type="button"
            onClick={onBack}
            className="px-4 py-2.5 rounded-lg font-sans font-medium"
            style={{ border: '1px solid var(--iw-nightable-border, #e7e5e4)', color: 'var(--iw-ink, #302438)' }}
          >
            Back to document
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
