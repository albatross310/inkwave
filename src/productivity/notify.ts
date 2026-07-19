// The end-of-timer OS notification (Peter, 2026-07-18): "a VISIBLE POPUP NOTIFICATION that if
// possible comes up whatever tab or wherever you are in the OS."
//
// This is the Web Notifications API — an OS-level popup that surfaces even when the tab is
// backgrounded or the writer is in another app entirely. It is the loud sibling of the chime: the
// chime you can miss with headphones off; the notification you see.
//
// THREE RULES, all of them about not being a nuisance:
//   1. PERMISSION IS REQUESTED LAZILY, FROM A GESTURE. A page that asks for notification permission
//      on load is spam. We ask on the FIRST "Start work" tap — the moment the writer opts into the
//      timer is the honest moment to offer them its notification, and a tap is the user gesture the
//      prompt needs anyway. `requestPermission` is called at most once; a denial is remembered by the
//      browser and never re-asked here.
//   2. DEGRADE GRACEFULLY, NEVER A DEAD END. If notifications are unsupported (older WebKit had no
//      Notification in a page context) or denied, we fall back to the in-page toast — the writer
//      still gets a visible "time's up", just inside the tab. Never a silent nothing.
//   3. NEVER THROW ON THE TIMER PATH. This fires from pomodoroStore's tick; an exception there must
//      not break the session-close that follows it. Everything here is wrapped.

const TOAST_EVENT = 'inkwave:toast' // shared with components/Toast.tsx (CITATION_TOAST_EVENT)

function supported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

/** The current permission, or 'unsupported' where the API is absent. */
export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (!supported()) return 'unsupported'
  try {
    return Notification.permission
  } catch {
    return 'unsupported'
  }
}

/**
 * Ask for notification permission, once, from a user gesture.
 *
 * Idempotent and safe to call on every "Start work": the browser only shows its prompt while the
 * permission is 'default', so a granted OR denied answer just resolves. Returns the resulting
 * permission so a caller can, if it wants, tell the writer what to expect.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!supported()) return 'unsupported'
  try {
    if (Notification.permission !== 'default') return Notification.permission
    return await Notification.requestPermission()
  } catch {
    return notificationPermission()
  }
}

/** Fire the in-page toast — the fallback, and the belt-and-braces companion to a real notification. */
function toast(text: string): void {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { text } }))
  } catch { /* no-op */ }
}

/** What each phase-end says. Plain, calm, §A5 — a nudge back, not an alarm. */
function messageFor(phaseEnded: 'work' | 'break' | 'long-break'): { title: string; body: string } {
  if (phaseEnded === 'work') {
    return { title: 'Time for a break', body: 'Your writing block is done — step away for a moment.' }
  }
  return { title: 'Back to it', body: 'Break’s over. Your next block is ready when you are.' }
}

/**
 * Surface the end of a timer block, wherever the writer is.
 *
 * Fires a real OS notification when permission is granted; ALWAYS also raises the in-page toast, so a
 * writer looking at the tab sees it immediately and a writer elsewhere gets the OS popup. A denied or
 * unsupported permission degrades to the toast alone — never a dead end.
 */
export function fireTimerEndNotification(phaseEnded: 'work' | 'break' | 'long-break'): void {
  const { title, body } = messageFor(phaseEnded)
  // Always the in-page signal (cheap, no permission, and it is what a focused writer sees).
  toast(`${title} — ${body}`)

  if (notificationPermission() !== 'granted') return
  try {
    const n = new Notification(title, {
      body,
      // A stable tag COLLAPSES repeats into one popup rather than stacking a tower of them if several
      // blocks elapse while the tab was asleep and catch up at once.
      tag: 'inkwave-timer',
      // Silent: the chime is our sound. A double-beep (OS + chime) is exactly the jarring interruption
      // the whole calm-writing argument is against.
      silent: true,
    })
    // Clicking the popup brings the writer's tab forward — they asked to come back.
    n.onclick = () => {
      try { window.focus() } catch { /* no-op */ }
      n.close()
    }
    // Auto-dismiss so a stale "time's up" doesn't sit on the desktop an hour later.
    setTimeout(() => { try { n.close() } catch { /* no-op */ } }, 20_000)
  } catch { /* construction can throw on some platforms — the toast already fired */ }
}
