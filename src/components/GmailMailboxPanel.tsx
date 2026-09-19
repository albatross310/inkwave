import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  gmailMailboxDraftClient,
  gmailMailboxReader,
} from '../email/gmailMailbox'
import type {
  MailboxAttachment,
  MailboxDraft,
  MailboxDraftIndexPage,
  MailboxIndexPage,
  MailboxThread,
} from '../email/mailbox'
import { presentMailboxAttachment } from '../email/mailboxAttachment'

type View = 'inbox' | 'promotions' | 'drafts' | 'sent' | 'spam'
type LoadState = 'loading' | 'current' | 'offline' | 'permission-needed' | 'failed'

export const MAILBOX_FOREGROUND_POLL_MS = 60_000

interface Props {
  accessToken: string
  onClose: () => void
  onDisconnect: () => void
  onOpenDraft?: (draft: MailboxDraft<'gmail'>, context: { accountEmail: string; historyId: string }) => Promise<void>
}

function when(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : ''
}

function viewLabel(view: View): string {
  return view === 'inbox' ? 'Inbox'
    : view === 'promotions' ? 'Promotions'
      : view === 'drafts' ? 'Drafts'
        : view === 'sent' ? 'Sent' : 'Spam'
}

export function GmailMailboxPanel({ accessToken, onClose, onDisconnect, onOpenDraft }: Props) {
  const reader = useMemo(() => gmailMailboxReader(accessToken), [accessToken])
  const drafts = useMemo(() => gmailMailboxDraftClient(accessToken), [accessToken])
  const [view, setView] = useState<View>('inbox')
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [error, setError] = useState('')
  const [index, setIndex] = useState<MailboxIndexPage<'gmail'> | MailboxDraftIndexPage<'gmail'> | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [thread, setThread] = useState<MailboxThread<'gmail'> | null>(null)
  const [draft, setDraft] = useState<MailboxDraft<'gmail'> | null>(null)
  const [opening, setOpening] = useState(false)
  const [importing, setImporting] = useState(false)
  const [attachmentBusy, setAttachmentBusy] = useState<string | null>(null)
  const [attachmentStatus, setAttachmentStatus] = useState('')

  useEffect(() => {
    let alive = true
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setLoadState('offline')
      setError('You are offline. Gmail will refresh when this page reconnects.')
      return () => { alive = false }
    }
    setLoadState('loading')
    setError('')
    setIndex(null)
    setThread(null)
    setDraft(null)
    const request = view === 'drafts' ? drafts.listDrafts() : reader.list(view)
    void request.then((page) => {
      if (!alive) return
      setIndex(page)
      setLoadState('current')
    }).catch((cause: unknown) => {
      if (!alive) return
      const kind = typeof cause === 'object' && cause && 'kind' in cause
        ? (cause as { kind?: string }).kind
        : undefined
      setLoadState(kind === 'permission-needed' ? 'permission-needed' : 'failed')
      setError(cause instanceof Error ? cause.message : 'Gmail could not be read')
    })
    return () => { alive = false }
  }, [drafts, reader, refresh, view])

  useEffect(() => {
    if (!index || loadState !== 'current') return
    let alive = true
    let checking = false
    const check = async () => {
      if (!alive || checking || document.hidden || navigator.onLine === false) return
      checking = true
      try {
        const state = await reader.changedSince(index.historyId)
        if (alive && (state.changed || state.expired)) setRefresh((value) => value + 1)
      } catch (cause) {
        if (!alive) return
        const kind = typeof cause === 'object' && cause && 'kind' in cause
          ? (cause as { kind?: string }).kind
          : undefined
        setLoadState(kind === 'permission-needed' ? 'permission-needed' : 'failed')
        setError(cause instanceof Error ? cause.message : 'Gmail could not be refreshed')
      } finally { checking = false }
    }
    const onVisible = () => { if (!document.hidden) void check() }
    const onOnline = () => { void check() }
    const timer = window.setInterval(() => void check(), MAILBOX_FOREGROUND_POLL_MS)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    return () => {
      alive = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [index, loadState, reader])

  const openThread = async (threadId: string) => {
    setOpening(true)
    setError('')
    try { setThread(await reader.readThread(threadId)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open this Gmail thread') }
    finally { setOpening(false) }
  }

  const openDraft = async (draftId: string) => {
    setOpening(true)
    setError('')
    try { setDraft(await drafts.readDraft(draftId)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open this Gmail draft') }
    finally { setOpening(false) }
  }

  const importDraft = async () => {
    if (!draft || !index || !onOpenDraft) return
    setImporting(true)
    setError('')
    try {
      await onOpenDraft(draft, { accountEmail: index.accountEmail, historyId: index.historyId })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open this draft in Inkwave')
      setImporting(false)
    }
  }

  const openAttachment = async (messageId: string, attachment: MailboxAttachment) => {
    const key = `${messageId}:${attachment.providerAttachmentId}`
    setAttachmentBusy(key)
    setAttachmentStatus('')
    setError('')
    try {
      const content = await reader.readAttachment(messageId, attachment)
      const presentation = presentMailboxAttachment(content)
      setAttachmentStatus(presentation === 'open'
        ? `Opened ${attachment.filename} in a browser viewer.`
        : `Downloaded ${attachment.filename}; open the saved file with its usual app.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open this Gmail attachment')
    } finally { setAttachmentBusy(null) }
  }

  const detailsOpen = !!thread || !!draft
  return createPortal(
    <div
      className="fixed inset-0 z-[125] flex items-center justify-center bg-black/30 p-3"
      onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Gmail mailbox"
        className="iw-nightable iw-touch-guard flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-stone-200 bg-white text-stone-900 shadow-xl"
      >
        <header className="flex items-center gap-2 border-b border-stone-200 px-4 py-3">
          {detailsOpen && (
            <button type="button" className="text-sm underline" onClick={() => { setThread(null); setDraft(null); setError('') }}>
              ← {viewLabel(view)}
            </button>
          )}
          <strong className="text-base">Gmail</strong>
          {index?.accountEmail && <span className="truncate text-xs opacity-65">{index.accountEmail}</span>}
          <div className="ml-auto flex items-center gap-2">
            <button type="button" className="text-xs underline" onClick={() => setRefresh((value) => value + 1)}>Refresh</button>
            <button type="button" className="text-xs underline" onClick={onDisconnect}>Disconnect</button>
            <button type="button" className="text-xl leading-none opacity-65" aria-label="Close Gmail mailbox" onClick={onClose}>×</button>
          </div>
        </header>

        {!detailsOpen && (
          <nav className="flex overflow-x-auto border-b border-stone-200" aria-label="Gmail mailbox views">
            {(['inbox', 'promotions', 'drafts', 'sent', 'spam'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                aria-pressed={view === tab}
                className="min-w-fit flex-1 shrink-0 px-3 py-2 text-sm font-medium"
                style={view === tab ? { background: 'var(--iw-reader-tint)', color: 'var(--iw-ink)' } : undefined}
                onClick={() => setView(tab)}
              >
                {viewLabel(tab)}
              </button>
            ))}
          </nav>
        )}

        <div className="min-h-48 flex-1 overflow-y-auto">
          {opening && <p className="p-4 text-sm">Opening from Gmail…</p>}
          {!detailsOpen && loadState === 'loading' && <p className="p-4 text-sm">Refreshing Gmail…</p>}
          {!detailsOpen && loadState === 'offline' && <p className="p-4 text-sm">{error}</p>}
          {!detailsOpen && loadState === 'permission-needed' && (
            <div className="p-4 text-sm"><p className="font-medium">Gmail permission is needed again.</p><p className="mt-1">{error}</p></div>
          )}
          {!detailsOpen && loadState === 'failed' && (
            <div className="p-4 text-sm"><p className="font-medium">Gmail could not be refreshed.</p><p className="mt-1">{error}</p></div>
          )}
          {!detailsOpen && loadState === 'current' && index && index.rows.length === 0 && (
            <p className="p-4 text-sm">Gmail returned no {view} items.</p>
          )}
          {!detailsOpen && loadState === 'current' && index && view !== 'drafts' && 'view' in index && index.rows.map((row) => (
            <button
              type="button"
              key={row.threadId}
              className="block w-full border-b border-stone-200 px-4 py-3 text-left hover:bg-stone-50"
              onClick={() => void openThread(row.threadId)}
            >
              <span className="flex items-baseline gap-2">
                {row.unread && <span aria-label="Unread" className="text-xs">●</span>}
                <strong className="truncate text-sm">{row.correspondent}</strong>
                <span className="ml-auto shrink-0 text-xs opacity-60">{when(row.activityAt)}</span>
              </span>
              <span className="block truncate text-sm font-medium">{row.subject}</span>
              <span className="block truncate text-xs opacity-65">{row.snippet}</span>
            </button>
          ))}
          {!detailsOpen && loadState === 'current' && index && view === 'drafts' && !('view' in index) && index.rows.map((row) => (
            <button
              type="button"
              key={row.draftId}
              className="block w-full border-b border-stone-200 px-4 py-3 text-left hover:bg-stone-50"
              onClick={() => void openDraft(row.draftId)}
            >
              <span className="flex items-baseline gap-2">
                <strong className="truncate text-sm">{row.recipients}</strong>
                <span className="ml-auto shrink-0 text-xs opacity-60">{when(row.updatedAt)}</span>
              </span>
              <span className="block truncate text-sm font-medium">{row.subject}</span>
              <span className="block truncate text-xs opacity-65">{row.snippet}</span>
            </button>
          ))}

          {thread && !opening && (
            <div className="space-y-3 p-4">
              {thread.messages.map((message) => (
                <article key={message.providerMessageId} className="rounded-lg border border-stone-200 p-3">
                  <p className="text-xs opacity-65">From: {message.from || '(unknown)'}</p>
                  <p className="text-xs opacity-65">To: {message.to || '(unknown)'}</p>
                  {message.cc && <p className="text-xs opacity-65">Cc: {message.cc}</p>}
                  <h3 className="mt-1 text-sm font-semibold">{message.subject || '(no subject)'}</h3>
                  <p className="text-xs opacity-60">{when(message.sentAt)}</p>
                  {message.plainText !== null ? (
                    <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{message.plainText}</pre>
                  ) : (
                    <p className="mt-3 text-sm">This message has no plain-text part. Its HTML remains blocked.</p>
                  )}
                  {message.htmlAvailable && <p className="mt-2 text-xs opacity-60">HTML and remote images are not loaded.</p>}
                  {message.attachments.map((attachment) => (
                    <div key={attachment.providerAttachmentId} className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span>📎 {attachment.filename} ({attachment.mimeType}, {attachment.size} bytes)</span>
                      <button type="button" className="underline disabled:opacity-40"
                        disabled={attachmentBusy !== null}
                        onClick={() => void openAttachment(message.providerMessageId, attachment)}>
                        {attachmentBusy === `${message.providerMessageId}:${attachment.providerAttachmentId}` ? 'Opening…' : `Open ${attachment.filename}`}
                      </button>
                    </div>
                  ))}
                </article>
              ))}
            </div>
          )}

          {draft && !opening && (
            <div className="p-4">
              <p className="text-xs opacity-65">To: {draft.headers.to.join(', ') || '(no recipients)'}</p>
              {!!draft.headers.cc?.length && <p className="text-xs opacity-65">Cc: {draft.headers.cc.join(', ')}</p>}
              {!!draft.headers.bcc?.length && <p className="text-xs opacity-65">Bcc: {draft.headers.bcc.join(', ')}</p>}
              <h3 className="mt-1 text-sm font-semibold">{draft.headers.subject || '(no subject)'}</h3>
              {draft.body !== null ? (
                <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{draft.body}</pre>
              ) : (
                <p className="mt-3 text-sm">This draft has no plain-text body. Its HTML remains safe in Gmail.</p>
              )}
              {draft.htmlAvailable && <p className="mt-2 text-xs opacity-60">HTML and remote images are not loaded.</p>}
              {draft.attachments.map((attachment) => (
                <div key={attachment.providerAttachmentId} className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span>📎 {attachment.filename} ({attachment.mimeType}, {attachment.size} bytes)</span>
                  <button type="button" className="underline disabled:opacity-40"
                    disabled={attachmentBusy !== null}
                    onClick={() => void openAttachment(draft.messageId, attachment)}>
                    {attachmentBusy === `${draft.messageId}:${attachment.providerAttachmentId}` ? 'Opening…' : `Open ${attachment.filename}`}
                  </button>
                </div>
              ))}
              {onOpenDraft && (
                <button
                  type="button"
                  className="mt-4 rounded px-3 py-1.5 text-sm disabled:opacity-40"
                  style={{ background: 'var(--iw-ink)', color: 'var(--iw-on-ink)' }}
                  disabled={draft.body === null || importing}
                  onClick={() => void importDraft()}
                >
                  {importing ? 'Opening…' : 'Edit in Inkwave'}
                </button>
              )}
            </div>
          )}
          {detailsOpen && error && <p className="px-4 pb-4 text-sm">{error}</p>}
          {detailsOpen && attachmentStatus && <p className="px-4 pb-4 text-xs opacity-65">{attachmentStatus}</p>}
        </div>

        <footer className="border-t border-stone-200 px-4 py-2 text-xs opacity-65">
          Full bodies and attachment bytes are fetched only when you explicitly open them. HTML and remote images stay blocked.
        </footer>
      </section>
    </div>,
    document.body,
  )
}
