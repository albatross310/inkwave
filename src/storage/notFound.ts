// THE BOUNDARY PREDICATE — the one line the whole `DocRead` union hangs off.
//
// WHY IT LIVES ALONE, IN ITS OWN FILE, WITH NOTHING IMPORTED:
// `readDocument` returns `found | absent | error` with no null member, and every call site is
// compiler-forced to handle all three. That fixed the 2026-07-15 loss, where `catch { return null }`
// made "there is no document" and "I could not find out" the same answer, and Edit.tsx minted a
// blank over Peter's honours proposal.
//
// But a union constrains CONSUMERS; it cannot constrain the CLASSIFICATION that produces it. This
// function is what decides which arm a caller is handed, and until now it was a private one-liner
// with no test — so **the union was one lenient edit away from being perfectly typed and perfectly
// wrong**: make this match the error's *message* as well as its *name*, and `readDocument` starts
// faithfully reporting `absent` for genuine failures. Every call site then correctly handles the
// absence it was handed, the compiler is satisfied, and `newDocument()` mints a blank over someone's
// thesis again. The auditor demonstrated exactly that mutation passing typecheck AND all 1705 tests.
// That is my own bug, one level up: I moved the ambiguity from the return type into the predicate.
//
// THE LENIENT VERSION IS NOT HYPOTHETICAL. `testOpfsShim` threw `new Error('NotFoundError')` — which
// sets the MESSAGE, while real OPFS throws a `DOMException` whose NAME is `NotFoundError`. The
// tempting fix is to loosen this predicate until the shim passes. That fixes it from the wrong end:
// it makes production misclassify every failure whose text happens to mention NotFoundError. The
// shim is what should throw a real DOMException. These tests exist to make that pressure land in the
// right place — loosen this, and notFound.test.ts goes red.
//
// It is in its own module (no imports, not even types) so it can be tested with zero mocking:
// `storage/opfs.ts` pulls in the OPFS write path and the parse worker, which is why no test file
// imported it and why this line went unexamined for as long as it did.

/**
 * Is this error the ONE failure that honestly means "there is no such file"?
 *
 * `true` ⇒ safe to treat as absent (create a fresh document, write here).
 * `false` ⇒ we do not know what is there. NEVER write.
 *
 * Matched on `name`, per the File System Access spec: `getFileHandle`/`getDirectoryHandle` reject
 * with a `DOMException` named `NotFoundError` when the entry does not exist. Deliberately NOT
 * `instanceof DOMException`: a brand-new writer's very first load has no `documents/` directory, so
 * this predicate is what lets them get a blank page instead of an error screen. If some engine (or
 * a worker relaying an error across postMessage, where a DOMException can arrive as a plain object)
 * reports the right name on a non-DOMException, honouring it is the safe direction — the failure
 * mode of being too STRICT here is telling a first-time user their storage is broken.
 *
 * And deliberately NOT matched on `message`: see the note above. That is the mutation.
 */
export function isNotFound(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false
  return (err as { name?: unknown }).name === 'NotFoundError'
}
