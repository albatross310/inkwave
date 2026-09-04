// THE UNSYNCED-WORK NOTICE — Peter's ask (2026-07-17): "a warning that comes up if working for
// more than 5 minutes without syncing activated".
//
// The RULE is in editor/unsyncedWatch.ts (pure, unit-pinned). This is only its face.
//
// AFFECT — this is the part that is easy to get wrong. Inkwave is a calm writing environment and
// its productivity layer has an explicit non-shaming rule; a scolding modal over someone's essay
// would be off-brand and, worse, would train them to dismiss warnings without reading. So:
//  · It states the TRUE and reassuring fact first — the work IS saved on this device. The risk it
//    names is the real one (only here), not an invented emergency.
//  · It never blocks, never covers the text, and takes no focus from the editor.
//  · It offers the action, and it offers to go away. Waved away, it stays away (unsyncedWatch's
//    dismissed clause) — Peter: "it must not become a nag".
//  · It sits by the sync pill, where the writer already looks for this, rather than announcing
//    itself in the middle of the page.
//
// THEMING IS MANDATORY (CLAUDE.md): `iw-nightable` on the outer container + theme tokens with day
// fallbacks for every custom colour. A panel without it renders white-on-white in night mode.

import { isTouchDevice } from '../editor/isTouchDevice'

export function UnsyncedNotice({
  show,
  onSetUpSync,
  onDismiss,
  minutes,
}: {
  show: boolean
  /** Open the writer's sync options. Absent ⇒ the action is not offered (nothing to connect to). */
  onSetUpSync?: () => void
  onDismiss: () => void
  /** How long they have been working unsynced — reported honestly rather than as a fixed "5". */
  minutes: number
}) {
  if (!show) return null
  const touch = isTouchDevice()
  return (
    <div
      // iw-touch-guard: this floats over the editor, and on iOS a tap on an unguarded surface blurs
      // the contenteditable and retracts the keyboard mid-sentence.
      className="iw-nightable iw-touch-guard fixed rounded-lg bg-white shadow-lg"
      style={{
        // Above the sync pill's corner, out of the writing column entirely.
        right: touch ? 12 : 20,
        bottom: touch ? 96 : 74,
        zIndex: 60,
        maxWidth: touch ? 'calc(100vw - 24px)' : 320,
        padding: '12px 14px',
        border: '1px solid var(--iw-nightable-border, #e7e5e4)',
        fontSize: 13,
        lineHeight: 1.45,
      }}
      role="status"       // polite: announced, but it does not steal focus from the sentence
      aria-live="polite"
    >
      <div style={{ color: 'var(--iw-ink, #302438)', fontWeight: 600, marginBottom: 4 }}>
        Only on this device
      </div>
      <div style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
        {/* True first, and specific: they HAVE been saved — which is the thing Peter rightly
            expects OPFS to guarantee regardless of sign-in. The risk named is the real one. */}
        You&rsquo;ve been writing for {minutes} minutes. Your work is saved here, but it isn&rsquo;t
        backed up anywhere else yet.
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
        <button
          onClick={onDismiss}
          className="rounded px-2.5 py-1"
          style={{ color: 'var(--iw-pill-fg, #78716c)', fontSize: 12 }}
        >
          Not now
        </button>
        {onSetUpSync && (
          <button
            onClick={onSetUpSync}
            className="rounded px-2.5 py-1"
            style={{
              color: 'var(--iw-newbtn-fg, #fff)',
              background: 'var(--iw-ink, #302438)',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Back it up
          </button>
        )}
      </div>
    </div>
  )
}
