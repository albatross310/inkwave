// WHAT THE WRITER SEES WHEN THEY OPEN A DOCUMENT THAT IS ALREADY OPEN IN ANOTHER WINDOW ON THIS
// DEVICE. Not an error — a calm fork in the road with three ways forward, because the alternative
// (silently opening something else, or two tabs blind-autosaving over each other) is the data loss
// this whole mechanism exists to prevent.
//
// THE THREE ACTIONS (Peter's design, verbatim):
//   1. Switch to it   — ask the other window to come forward; this tab backs off.
//   2. Open a copy    — clone under a new id so the original can't diverge, and edit the copy.
//   3. Take over here — steal the document SAFELY (the other window goes read-only first).
//
// "Take over here" is deliberately the LAST and least prominent: it is the only one that changes
// another window's state, and while the handoff is proven safe (the loser freezes before this tab
// writes — see storage/singleOpen.ts), "keep both" (a copy) and "go to it" (switch) are the calmer
// defaults. None of the three is destructive: no document is ever deleted or overwritten by any path
// here.
//
// THEMING (CLAUDE.md, mandatory): iw-nightable + tokens with day fallbacks. Peter checks night mode.
// TOUCH: buttons are ≥16px text and ≥44px tall so the iOS auto-zoom + fat-finger rules hold.

import { useState } from 'react'

export interface DocumentOpenElsewhereProps {
  /** The held document's title, for recognition. */
  title: string
  /** Ask the holder to come forward (fire-and-forget). */
  onSwitch: () => void
  /** Clone under a new id and open the copy. */
  onOpenCopy: () => Promise<void>
  /** Run the safe take-over handshake, then open the document here. */
  onTakeOver: () => Promise<void>
}

type Busy = null | 'copy' | 'takeover'

export function DocumentOpenElsewhere({ title, onSwitch, onOpenCopy, onTakeOver }: DocumentOpenElsewhereProps) {
  const [busy, setBusy] = useState<Busy>(null)
  const [switched, setSwitched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(which: Exclude<Busy, null>, fn: () => Promise<void>) {
    setBusy(which); setError(null)
    try { await fn() } catch (e) {
      setError(String((e as Error)?.message ?? e))
      setBusy(null) // a successful action navigates away and unmounts; only a failure lands back here
    }
  }

  return (
    <div
      className="iw-nightable fixed inset-0 flex items-center justify-center bg-white"
      style={{ zIndex: 100, padding: 24 }}
    >
      <div style={{ maxWidth: 460 }}>
        <h1 style={{ color: 'var(--iw-ink, #302438)', fontSize: 20, fontWeight: 600, marginBottom: 10 }}>
          “{title}” is open in another window
        </h1>
        <p style={{ color: 'var(--iw-pill-fg, #78716c)', fontSize: 16, lineHeight: 1.55, marginBottom: 18 }}>
          You already have this document open somewhere else on this device. To keep your writing
          safe, only one window edits it at a time — otherwise the two could save over each other.
          Choose how to continue.
        </p>

        {error && (
          <p style={{ color: 'var(--iw-ink, #302438)', fontSize: 13, lineHeight: 1.5, marginBottom: 14,
            border: '1px solid var(--iw-nightable-border, #e7e5e4)', borderRadius: 8, padding: '8px 12px' }}>
            That didn’t work: {error}. Nothing was changed — try another option.
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <ActionButton
            primary
            disabled={busy !== null}
            onClick={() => { onSwitch(); setSwitched(true) }}
            label={switched ? 'Asked the other window to come forward' : 'Switch to it'}
            hint={switched
              ? 'If it didn’t come forward, find the other Inkwave window yourself, or take over here.'
              : 'Bring the window that already has it open to the front. Nothing changes here.'}
          />
          <ActionButton
            disabled={busy !== null}
            onClick={() => void run('copy', onOpenCopy)}
            label={busy === 'copy' ? 'Making a copy…' : 'Open a copy'}
            hint="Start a separate copy of this document and edit that. The original is untouched."
          />
          <ActionButton
            disabled={busy !== null}
            onClick={() => void run('takeover', onTakeOver)}
            label={busy === 'takeover' ? 'Taking over…' : 'Take over here'}
            hint="Move editing to this window. The other window becomes read-only first, so nothing is lost."
          />
        </div>
      </div>
    </div>
  )
}

function ActionButton({ label, hint, onClick, disabled, primary }: {
  label: string; hint: string; onClick: () => void; disabled?: boolean; primary?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="text-left rounded disabled:opacity-50"
      style={{
        minHeight: 44,
        padding: '10px 14px',
        border: primary ? 'none' : '1px solid var(--iw-nightable-border, #e7e5e4)',
        background: primary ? 'var(--iw-ink, #302438)' : 'transparent',
      }}
    >
      <span style={{
        display: 'block', fontSize: 16, fontWeight: 600,
        color: primary ? 'var(--iw-on-ink, #fff)' : 'var(--iw-ink, #302438)',
      }}>
        {label}
      </span>
      <span style={{
        display: 'block', fontSize: 13, lineHeight: 1.45, marginTop: 2,
        color: primary ? 'var(--iw-on-ink, #fff)' : 'var(--iw-pill-fg, #78716c)',
        opacity: primary ? 0.9 : 1,
      }}>
        {hint}
      </span>
    </button>
  )
}

// ─── The holder's read-only banner ─────────────────────────────────────────────
//
// Shown in the tab that JUST surrendered a document to a take-over. Its writes are already frozen at
// the storage funnel (the correctness guarantee); this banner exists so the writer is never confused
// by an editor that silently stops saving — it tells them what happened and offers the one honest way
// back (reload, which re-attempts to claim the document; if the other window still holds it they land
// on the screen above). A banner, not a full-screen cover, so their text stays visible to read/copy.

export function SurrenderedBanner({ onReload }: { onReload: () => void }) {
  return (
    <div
      className="iw-nightable iw-no-print fixed top-0 left-0 right-0 flex items-center justify-center gap-3"
      style={{
        zIndex: 90, padding: '10px 16px', background: 'var(--iw-ink, #302438)',
        color: 'var(--iw-on-ink, #fff)', fontSize: 14,
      }}
      role="status"
    >
      <span>This document is now open in another window — read-only here.</span>
      <button
        type="button"
        onClick={onReload}
        style={{
          minHeight: 32, padding: '4px 12px', borderRadius: 6, fontSize: 14, fontWeight: 600,
          border: '1px solid var(--iw-on-ink, #fff)', color: 'var(--iw-on-ink, #fff)', background: 'transparent',
        }}
      >
        Take it back
      </button>
    </div>
  )
}
