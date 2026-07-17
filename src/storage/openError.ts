// Open-failure messages that SURVIVE the open choreography. The moment an open starts,
// inkwave:open-begin hides the document (Edit renders the waves shell) — which UNMOUNTS the
// TiptapEditor instance whose async handler is running the open. If that open then fails, a
// setState on the initiating instance is a silent no-op: open-failed restores the stashed doc and
// the writer sees the previous page with NO explanation (on a fresh phone the stash is a blank
// "Untitled" — Peter's iOS "opens just a blank page", 2026-07-10). So failures park the message
// here (module scope outlives any component) and the editor that mounts after the restore — or a
// still-mounted one, via the event — picks it up and shows the banner.

// NOT EVERY MESSAGE FROM AN OPEN IS BAD NEWS (2026-07-17). The blind-overwrite guard reports the
// two outcomes where it PROTECTED the writer's work — "your newer version was kept", "it opened as
// a separate copy, nothing was overwritten". Those went out through the same red ⚠ ERROR banner as
// "this file is corrupt", which is the wrong thing to tell someone at the exact moment the app just
// saved their thesis: it reads as a failure, and it trains them to fear a protective action. So a
// notice carries its KIND, and the banner reads calm or alarming accordingly.
export type OpenNoticeKind = 'error' | 'info'
export interface OpenNotice {
  message: string
  kind: OpenNoticeKind
}

let pending: OpenNotice | null = null

function park(notice: OpenNotice): void {
  pending = notice
  try { window.dispatchEvent(new Event('inkwave:open-error')) } catch { /* non-browser */ }
}

/** Park an open-FAILURE message (red) + nudge any mounted editor to show it now. */
export function reportOpenError(message: string): void {
  park({ message, kind: 'error' })
}

/** Park a calm, informational open message (no alarm) — e.g. "nothing was overwritten". */
export function reportOpenNotice(message: string): void {
  park({ message, kind: 'info' })
}

/** Consume the parked notice (called by the editor on mount and on inkwave:open-error). */
export function takeOpenError(): OpenNotice | null {
  const m = pending
  pending = null
  return m
}
