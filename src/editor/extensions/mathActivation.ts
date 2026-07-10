// One-shot handshake between the insert commands (insertMathInline / insertMathBlock)
// and the math node views: "the node about to mount was just inserted by the writer —
// open it in edit mode with the MathLive caret ready".
//
// Why not `latex === ''` at mount (the old rule)? An empty node that arrives by doc
// load / undo / sync ALSO mounted active and stole focus from the page. The views now
// mount inactive unless this flag was raised by an explicit insert gesture.
//
// The window is time-boxed rather than cleared on read: React StrictMode double-invokes
// useState initializers in dev, so a read-once flag would be consumed by the throwaway
// render and the real mount would see false.

const WINDOW_MS = 600

let pendingUntil = 0

/** Called by the insert commands immediately before dispatching the insert. */
export function requestMathEdit(): void {
  pendingUntil = Date.now() + WINDOW_MS
}

/** Read by a mounting math node view: was an insert gesture just made? */
export function pendingMathEdit(): boolean {
  return Date.now() < pendingUntil
}
