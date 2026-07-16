// WHAT THE WRITER SEES WHEN A READ FAILS — instead of a blank page.
//
// THE INCIDENT THIS REPLACES (forensics, 2026-07-15 11:19:40): a transient OPFS read failure was
// swallowed by `readJson`'s `catch { return null }`, Edit.tsx read that null as "no such document",
// fell through to `newDocument()`, and REPOINTED the active-doc pointer at a blank. Peter reloaded
// and his honours proposal was simply... gone (doc `978e0772`, 0 chars, created and never typed
// into). Eleven minutes later he opened a `.studio` backup to recover from that blank, got the
// stale twin, and it blind-overwrote Wednesday's work. **The blank page is not a cosmetic failure
// — it is the thing that caused the data loss.** It told him, wordlessly, that his thesis was gone,
// and everything he did next was a reasonable response to a lie.
//
// So this screen has exactly three jobs, in this order:
//   1. Contradict the blank page. His work is almost certainly still there; the READ failed, not
//      the document. Say that first and plainly.
//   2. Offer the cheap fix (a reload clears a transient failure nearly every time).
//   3. Put the recovery surface one click away — Storage enumerates OPFS directly and can export
//      any document it finds. Buried in a menu is not good enough for someone who has just been
//      shown an empty page; this is the exact moment it exists for.
//
// And the thing it must NEVER do: offer to start a new document. That is the failure mode, dressed
// up as a helpful button.
//
// THEMING (CLAUDE.md, mandatory): `iw-nightable` + tokens with day fallbacks — a full-screen panel
// that renders white-on-white in night mode would be its own small disaster.

import { useState } from 'react'
import type { StorageReadError } from '../storage/opfs'
import { OpfsInspector } from './OpfsInspector'

export function StorageUnavailable({
  error,
  onRetry,
}: {
  error: StorageReadError
  onRetry: () => void
}) {
  const [storageOpen, setStorageOpen] = useState(false)
  return (
    <div
      className="iw-nightable fixed inset-0 flex items-center justify-center bg-white"
      style={{ zIndex: 100, padding: 24 }}
    >
      <div style={{ maxWidth: 460 }}>
        <h1 style={{ color: 'var(--iw-ink, #5c2d8a)', fontSize: 20, fontWeight: 600, marginBottom: 10 }}>
          Your writing is still here — this device just couldn&rsquo;t open it
        </h1>
        <p style={{ color: 'var(--iw-pill-fg, #78716c)', fontSize: 14, lineHeight: 1.55, marginBottom: 10 }}>
          Something went wrong reading this device&rsquo;s storage, so Inkwave stopped rather than
          show you an empty page. <strong>Nothing has been changed or deleted.</strong> Your
          documents are where they were.
        </p>
        <p style={{ color: 'var(--iw-pill-fg, #78716c)', fontSize: 14, lineHeight: 1.55, marginBottom: 16 }}>
          Reloading usually fixes it. If it doesn&rsquo;t, open Storage — it reads your documents
          directly and can save a copy of any of them somewhere safe.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onRetry}
            className="rounded px-3.5 py-2"
            style={{
              color: 'var(--iw-newbtn-fg, #fff)',
              background: 'var(--iw-ink, #5c2d8a)',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Reload
          </button>
          <button
            onClick={() => setStorageOpen(true)}
            className="rounded px-3.5 py-2"
            style={{
              color: 'var(--iw-ink, #5c2d8a)',
              border: '1px solid var(--iw-nightable-border, #e7e5e4)',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Open Storage
          </button>
        </div>
        {/* The technical reason, available but not shouted — it is what a bug report needs, and
            nothing the writer has to read to act. */}
        <details style={{ marginTop: 18 }}>
          <summary style={{ color: 'var(--iw-pill-fg, #78716c)', fontSize: 12, cursor: 'pointer' }}>
            Technical details
          </summary>
          <pre
            style={{
              color: 'var(--iw-pill-fg, #78716c)',
              fontSize: 11,
              marginTop: 8,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {error.message}
          </pre>
        </details>
      </div>
      {storageOpen && <OpfsInspector onClose={() => setStorageOpen(false)} />}
    </div>
  )
}
