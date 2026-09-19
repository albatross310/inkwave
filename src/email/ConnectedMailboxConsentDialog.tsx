// Explicit capability step-up for the optional connected Gmail mailbox (Productivity + Email
// v0.2, §B3.1). The caller owns OAuth; this face must be shown before it invokes that boundary.

import { createPortal } from 'react-dom'
import * as copy from './copy'

interface Props {
  busy?: boolean
  onCancel: () => void
  onContinue: () => void
}

export function ConnectedMailboxConsentDialog({ busy = false, onCancel, onContinue }: Props) {
  return createPortal(
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/30 p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="iw-mailbox-consent-title"
        className="iw-nightable iw-touch-guard bg-white z-[131] w-full max-w-lg rounded-xl border border-stone-200 px-5 py-4 text-stone-900 shadow-xl"
      >
        <h2 id="iw-mailbox-consent-title" className="text-base font-semibold">
          {copy.MAILBOX_CONSENT_TITLE}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-stone-600">
          {copy.MAILBOX_CONSENT_INTRO}
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
          <li>{copy.MAILBOX_READ_CAPABILITY}</li>
          <li>{copy.MAILBOX_DRAFT_CAPABILITY}</li>
        </ul>
        <div className="mt-3 space-y-2 text-xs leading-relaxed text-stone-600">
          <p>{copy.MAILBOX_PERMISSION_LIMIT}</p>
          <p>{copy.MAILBOX_TRANSPORT_BOUNDARY}</p>
          <p>{copy.MAILBOX_CONTENT_BOUNDARY}</p>
          <p>{copy.MAILBOX_DISCONNECT_BOUNDARY}</p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded border border-stone-200 px-3 py-1.5 text-sm text-stone-900 disabled:opacity-40"
            onClick={onCancel}
            disabled={busy}
            autoFocus
          >
            Not now
          </button>
          <button
            type="button"
            className="rounded px-3 py-1.5 text-sm disabled:opacity-40"
            style={{ background: 'var(--iw-ink)', color: 'var(--iw-on-ink)' }}
            onClick={onContinue}
            disabled={busy}
          >
            {busy ? 'Waiting for Google…' : 'Continue to Google'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
