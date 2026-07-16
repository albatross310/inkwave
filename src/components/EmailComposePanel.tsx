// The email header block (§B2.1) — To / Cc / Bcc / Subject above the ordinary editor body.
//
// This panel is ONLY the headers and the two actions. The body is the normal Tiptap editor, because
// an email IS an ordinary Inkwave document: that is what gives it edit history, provenance hashing
// and session capture without a line of code here.
//
// THEMING (CLAUDE.md, mandatory): the outer container carries `iw-nightable`, and every custom
// colour is a theme token with a day fallback — no hard-coded hex.

import { useState, useRef, useEffect } from 'react'
import type { InkwaveDocument, EmailHeaders } from '../types/document'
import { parseAddressList, suspectAddresses, hasRecipient } from '../email/headers'
import { finaliseEmail, draftFor, canHandOff } from '../email/finalise'
import { handoffSender, fits, type MailSenderId } from '../email/sender'
import { titleForEmail } from '../email/newEmail'
import * as copy from '../email/copy'

interface Props {
  doc: InkwaveDocument
  onDocChange: (updated: InkwaveDocument) => void
}

const PROVIDERS: { id: MailSenderId; label: string }[] = [
  { id: 'gmail-handoff', label: 'Gmail' },
  { id: 'outlook-handoff', label: 'Outlook' },
  { id: 'mailto', label: 'Mail app' },
]

export function EmailComposePanel({ doc, onDocChange }: Props) {
  const headers = doc.email
  const [showCc, setShowCc] = useState(() => !!(headers?.cc?.length || headers?.bcc?.length))
  const [status, setStatus] = useState<string | null>(null)
  const [recordedAt, setRecordedAt] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [handoffOpen, setHandoffOpen] = useState(false)
  const handoffRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!handoffOpen) return
    const onDown = (e: PointerEvent) => {
      if (!handoffRef.current?.contains(e.target as Node)) setHandoffOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [handoffOpen])

  if (!headers) return null

  const patch = (next: Partial<EmailHeaders>) => {
    const email = { ...headers, ...next }
    onDocChange({
      ...doc,
      email,
      // The title tracks the subject so the document reads correctly in the library — and in the
      // ledger's optional `doc_label`.
      title: titleForEmail(email),
      updatedAt: new Date().toISOString(),
    })
  }

  const onFinalise = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const r = await finaliseEmail(doc)
      if (!r.snapshot) {
        setStatus(r.reason ?? 'could not record this draft')
      } else {
        setRecordedAt(r.snapshot.createdAt)
        setStatus(r.stamped ? null : (r.reason ?? null))
      }
    } finally {
      setBusy(false)
    }
  }

  const onHandoff = async (id: MailSenderId, label: string) => {
    const draft = draftFor(doc)
    if (!draft) return
    // The window must open inside the click's own transient activation — a deferred open is a
    // popup block (the same rule the GIS popups live under; see CLAUDE.md).
    const sender = handoffSender(id, label, (url) => { window.open(url, '_blank', 'noopener,noreferrer') })
    const out = await sender.send(draft)
    setHandoffOpen(false)
    setStatus(out.kind === 'failed' ? (out.reason ?? 'could not open your provider') : null)
  }

  const suspect = suspectAddresses(headers)
  const draft = draftFor(doc)
  const ready = canHandOff(doc)

  const field = 'flex-1 bg-transparent outline-none text-sm py-1'
  const row = 'flex items-baseline gap-2 border-b px-3'
  const labelCls = 'text-xs w-10 shrink-0'
  const labelStyle = { color: 'var(--iw-pill-fg, #78716c)' }
  const borderStyle = { borderColor: 'var(--iw-nightable-border, #e7e5e4)' }

  return (
    <div className="iw-nightable bg-white rounded-lg shadow-sm mb-3 text-stone-800" style={borderStyle}>
      {/* ── Headers ───────────────────────────────────────────────────────── */}
      <div className={row} style={borderStyle}>
        <span className={labelCls} style={labelStyle}>To</span>
        <input
          className={field}
          value={headers.to.join(', ')}
          placeholder="ada@example.com"
          onChange={(e) => patch({ to: parseAddressList(e.target.value) })}
          aria-label="To"
        />
        {!showCc && (
          <button
            className="text-xs hover:opacity-70"
            style={{ color: 'var(--iw-ink, #5c2d8a)' }}
            onClick={() => setShowCc(true)}
          >
            Cc/Bcc
          </button>
        )}
      </div>

      {showCc && (
        <>
          <div className={row} style={borderStyle}>
            <span className={labelCls} style={labelStyle}>Cc</span>
            <input
              className={field}
              value={(headers.cc ?? []).join(', ')}
              onChange={(e) => patch({ cc: parseAddressList(e.target.value) })}
              aria-label="Cc"
            />
          </div>
          <div className={row} style={borderStyle}>
            <span className={labelCls} style={labelStyle}>Bcc</span>
            <input
              className={field}
              value={(headers.bcc ?? []).join(', ')}
              onChange={(e) => patch({ bcc: parseAddressList(e.target.value) })}
              aria-label="Bcc"
            />
          </div>
        </>
      )}

      <div className={row} style={borderStyle}>
        <span className={labelCls} style={labelStyle}>Subject</span>
        <input
          className={field}
          value={headers.subject}
          onChange={(e) => patch({ subject: e.target.value })}
          aria-label="Subject"
        />
      </div>

      {/* ── Warnings (never blocks) ───────────────────────────────────────── */}
      {suspect.length > 0 && (
        <div className="px-3 py-1.5 text-xs" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
          Check {suspect.length === 1 ? 'this address' : 'these addresses'}: {suspect.join(', ')}
        </div>
      )}

      {/* ── Actions + the honesty copy ────────────────────────────────────── */}
      <div className="px-3 py-2.5 flex flex-wrap items-center gap-2">
        <button
          className="text-xs px-2.5 py-1 rounded border disabled:opacity-40"
          style={{ color: 'var(--iw-ink, #5c2d8a)', borderColor: 'var(--iw-nightable-border, #e7e5e4)' }}
          onClick={onFinalise}
          disabled={busy}
        >
          {busy ? 'Recording…' : copy.FINALISE_LABEL}
        </button>

        <div className="relative" ref={handoffRef}>
          <button
            className="text-xs px-2.5 py-1 rounded border disabled:opacity-40"
            style={{ color: 'var(--iw-ink, #5c2d8a)', borderColor: 'var(--iw-nightable-border, #e7e5e4)' }}
            onClick={() => setHandoffOpen((v) => !v)}
            disabled={!ready}
            title={ready ? undefined : 'Add a recipient first'}
          >
            Open in provider ▾
          </button>
          {handoffOpen && draft && (
            // iw-touch-guard: without it, tapping this panel blurs the editor on iOS and the
            // keyboard retracts (CLAUDE.md, footer drop-up rule).
            <div
              className="absolute left-0 bottom-full mb-1 z-[99] min-w-[190px] iw-touch-guard iw-nightable bg-white rounded-lg shadow-lg py-1 text-sm"
            >
              {PROVIDERS.map((p) => {
                const f = fits(p.id, draft)
                return (
                  <button
                    key={p.id}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 disabled:opacity-40"
                    onClick={() => onHandoff(p.id, p.label)}
                    disabled={!f.ok}
                    title={f.ok ? undefined : f.reason}
                  >
                    {p.label}
                    {!f.ok && <span className="block opacity-60">too long for a compose link</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {recordedAt && (
          <span className="text-xs" style={{ color: 'var(--iw-verified, #15803d)' }}>
            Recorded {new Date(recordedAt).toLocaleString()}
          </span>
        )}
        {status && (
          <span className="text-xs" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>{status}</span>
        )}
      </div>

      {/* The claim and its limit, at the SAME weight — §B2.2 requires the limit to be stated
          in-product, and a limit the reader must hunt for is a limit the product is hiding. */}
      <div
        className="px-3 pb-2.5 text-xs leading-relaxed space-y-1"
        style={{ color: 'var(--iw-pill-fg, #78716c)' }}
      >
        <p>{recordedAt ? copy.PROVENANCE_RECORDED : copy.PROVENANCE_EXPLAINER}</p>
        <p>{copy.PROVENANCE_LIMIT}</p>
        <p>{copy.HANDOFF_EXPLAINER}</p>
        <p>{copy.STORAGE_CLAIM}</p>
        <p>{copy.LEDGER_NOTE}</p>
        {!hasRecipient(headers) && <p>Add a recipient to hand this draft to your provider.</p>}
      </div>
    </div>
  )
}
