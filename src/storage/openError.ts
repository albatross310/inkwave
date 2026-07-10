// Open-failure messages that SURVIVE the open choreography. The moment an open starts,
// inkwave:open-begin hides the document (Edit renders the waves shell) — which UNMOUNTS the
// TiptapEditor instance whose async handler is running the open. If that open then fails, a
// setState on the initiating instance is a silent no-op: open-failed restores the stashed doc and
// the writer sees the previous page with NO explanation (on a fresh phone the stash is a blank
// "Untitled" — Peter's iOS "opens just a blank page", 2026-07-10). So failures park the message
// here (module scope outlives any component) and the editor that mounts after the restore — or a
// still-mounted one, via the event — picks it up and shows the banner.

let pending: string | null = null

/** Park an open-failure message + nudge any mounted editor to show it now. */
export function reportOpenError(message: string): void {
  pending = message
  try { window.dispatchEvent(new Event('inkwave:open-error')) } catch { /* non-browser */ }
}

/** Consume the parked message (called by the editor on mount and on inkwave:open-error). */
export function takeOpenError(): string | null {
  const m = pending
  pending = null
  return m
}
