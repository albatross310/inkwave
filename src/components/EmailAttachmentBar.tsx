import { useRef, useState } from 'react'
import {
  formatAttachmentBytes,
  importEmailAttachment,
  type EmailAttachmentRef,
} from '../email/attachmentStore'

export function EmailAttachmentBar({
  attachments,
  onChange,
  onError,
}: {
  attachments: readonly EmailAttachmentRef[]
  onChange: (attachments: EmailAttachmentRef[]) => void
  onError?: (message: string | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const pick = () => inputRef.current?.click()
  const onFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    if (!files.length) return
    setBusy(true)
    onError?.(null)
    let next = [...attachments]
    let total = next.reduce((sum, attachment) => sum + attachment.size, 0)
    for (const file of files) {
      const result = await importEmailAttachment(file, total)
      if (!result.ok) {
        onError?.(result.reason)
        break
      }
      next = [...next, result.attachment]
      total += result.attachment.size
      // Commit each successfully stored reference immediately. A later file failing must not leave
      // earlier bytes stored but unreachable from the draft.
      onChange(next)
    }
    setBusy(false)
  }

  return (
    <div className="iw-email-attachments" aria-label="Email attachments">
      <button type="button" data-iw-email-attach onClick={pick} disabled={busy} className="iw-email-attachments__add">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M8.5 12.5l6.8-6.8a3 3 0 014.2 4.2l-8.6 8.6a5 5 0 01-7.1-7.1l8.4-8.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {busy ? 'Attaching…' : 'Attach files'}
      </button>
      <input ref={inputRef} type="file" multiple className="hidden" onChange={onFiles} />
      <div className="iw-email-attachments__list">
        {attachments.map((attachment) => (
          <span key={attachment.id} className="iw-email-attachments__chip" title={attachment.name}>
            <span className="iw-email-attachments__name">{attachment.name}</span>
            <span className="iw-email-attachments__size">{formatAttachmentBytes(attachment.size)}</span>
            <button
              type="button"
              aria-label={`Remove ${attachment.name}`}
              onClick={() => onChange(attachments.filter((candidate) => candidate.id !== attachment.id))}
            >×</button>
          </span>
        ))}
      </div>
      <span className="iw-email-attachments__note">Included with Gmail send and draft sync</span>
    </div>
  )
}
