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
// TWO FAILURES WEAR THIS SCREEN, AND ONE OF THE MESSAGES IS A LIE IN THE OTHER'S CASE.
// The message above is right for a TRANSIENT failure on working storage. But the identical screen
// also appears in a PRIVATE/INCOGNITO window — where a private window has no persistent storage, so
// there is nothing "still here" and nothing to recover via the Storage inspector (it reads OPFS and
// will be empty/broken). There, "your writing is still here / nothing deleted" is a LIE. So we probe
// (probeStorageUnavailable — a fresh navigator.storage.getDirectory()) and, ONLY on high confidence
// that storage is fundamentally unavailable, switch to a message that says so plainly.
//
// THE ASYMMETRY IS DELIBERATE — get it wrong and you create a NEW scary lie. The transient message is
// the SAFE DEFAULT; a false "you're in private mode" shown to a real transient failure on working
// storage would tell a genuine writer their storage is broken (the inverse of the bug this screen
// exists to prevent). So the component STARTS in the safe message and switches to the private-window
// message only after the probe resolves to "unavailable" — never a blank flash, never worse than
// before the probe answered.
//
// THEMING (CLAUDE.md, mandatory): `iw-nightable` + tokens with day fallbacks — a full-screen panel
// that renders white-on-white in night mode would be its own small disaster. Peter checks night.

import { useEffect, useState } from 'react'
import type { StorageReadError } from '../storage/opfs'
import { probeStorageUnavailable } from '../storage/probeStorage'
import { OpfsInspector } from './OpfsInspector'

export function StorageUnavailable({
  error,
  onRetry,
}: {
  error: StorageReadError
  onRetry: () => void
}) {
  const [storageOpen, setStorageOpen] = useState(false)
  // Start SAFE (false = transient message). Only flip to the private-window message if the fresh
  // probe proves storage is fundamentally unavailable. Never a blank flash: the worst case is the
  // reassuring default staying, which is exactly what shipped before this feature.
  const [unavailable, setUnavailable] = useState(false)
  useEffect(() => {
    let live = true
    void probeStorageUnavailable().then((u) => {
      if (live && u) setUnavailable(true)
    })
    return () => { live = false }
  }, [])

  return (
    <div
      className="iw-nightable fixed inset-0 flex items-center justify-center bg-white"
      style={{ zIndex: 100, padding: 24 }}
    >
      <div style={{ maxWidth: 460 }}>
        {unavailable ? (
          <>
            <h1 style={{ color: 'var(--iw-ink, #35283e)', fontSize: 20, fontWeight: 600, marginBottom: 10 }}>
              This looks like a private window — Inkwave can&rsquo;t save here
            </h1>
            <p style={{ color: 'var(--iw-pill-fg, #78716c)', fontSize: 14, lineHeight: 1.55, marginBottom: 10 }}>
              You&rsquo;re in a private or incognito window (or a browser that can&rsquo;t store
              documents here), so Inkwave has no local storage to keep your work in.
              <strong> Anything you write here will be lost when you close the window.</strong>
            </p>
            <p style={{ color: 'var(--iw-pill-fg, #78716c)', fontSize: 14, lineHeight: 1.55, marginBottom: 16 }}>
              Open Inkwave in a normal window to save your writing. If you&rsquo;re signed in, cloud
              sync still works and will carry your saves.
            </p>
          </>
        ) : (
          <>
            <h1 style={{ color: 'var(--iw-ink, #35283e)', fontSize: 20, fontWeight: 600, marginBottom: 10 }}>
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
          </>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onRetry}
            className="rounded px-3.5 py-2"
            style={{
              color: 'var(--iw-newbtn-fg, #fff)',
              background: 'var(--iw-ink, #35283e)',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Reload
          </button>
          {/* Open Storage reads OPFS and can export any document it finds — useless, and a false
              promise of recoverable data, when storage is fundamentally unavailable. Hidden there. */}
          {!unavailable && (
            <button
              onClick={() => setStorageOpen(true)}
              className="rounded px-3.5 py-2"
              style={{
                color: 'var(--iw-ink, #35283e)',
                border: '1px solid var(--iw-nightable-border, #e7e5e4)',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Open Storage
            </button>
          )}
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
