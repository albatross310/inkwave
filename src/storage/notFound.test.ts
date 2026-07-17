// The test that should have existed the moment `DocRead` did.
//
// F16, from the test auditor, and it is the sharpest thing said about this lane: *"The whole union
// hangs off one predicate that nothing tests. I made it lenient — also matching the message — and
// got typecheck 0 and the full 1705-test gate green. The union is perfectly typed and perfectly
// wrong."*
//
// That is the 2026-07-15 bug wearing a better outfit. `readDocument` returning
// `found | absent | error` with no null member forces every caller to say which it means — but the
// classification handed to them comes from ONE line, and if that line says `absent` for a failure,
// every compiler-forced call site correctly handles the absence it was given, and `newDocument()`
// mints a blank over someone's thesis exactly as before. A discriminated union constrains
// consumers; it cannot constrain the classification that produces it.
//
// MUTATION-PROVED. Each of these was injected into `isNotFound`; the named test FAILS:
//   · `|| String((err as Error)?.message).includes('NotFoundError')`  (THE auditor's mutation,
//        and the one a real person will genuinely reach for to make testOpfsShim pass)
//        ⇒ "an Error whose MESSAGE merely mentions NotFoundError is NOT absent" fails
//   · `return true` (treat everything as absent — the pre-fix `catch { return null }` in spirit)
//        ⇒ every "is NOT absent" test fails
//   · `err?.name?.includes('NotFound')` (loose name match)
//        ⇒ "a NotSupportedError is not absent" survives, but "NotFoundErrorX" fails
//   · dropping the `typeof err !== 'object'` guard ⇒ "a bare string is not absent" fails
//
// A keeper that has never been shown to fail is the same disease one level up.

import { describe, it, expect } from 'vitest'
import { isNotFound } from './notFound'

/** What real OPFS throws when an entry does not exist. */
const realNotFound = () => new DOMException('The requested file could not be found.', 'NotFoundError')

describe('isNotFound — the one line that decides "absent" from "could not find out"', () => {
  it('a DOMException named NotFoundError IS absent — the only honest null', () => {
    expect(isNotFound(realNotFound())).toBe(true)
  })

  it('an Error whose MESSAGE merely mentions NotFoundError is NOT absent', () => {
    // THE AUDITOR'S MUTATION, and the exact `testOpfsShim` bug: `new Error('NotFoundError')` sets
    // the MESSAGE; real OPFS sets the NAME. Loosening this predicate to make such a shim pass is
    // fixing it from the wrong end — it makes production report `absent` for any failure whose text
    // happens to mention NotFoundError, and `absent` is the arm that says "safe to write here".
    expect(isNotFound(new Error('NotFoundError'))).toBe(false)
    expect(isNotFound(new Error('failed: NotFoundError while reading current.json'))).toBe(false)
  })

  it('a quota failure is NOT absent', () => {
    expect(isNotFound(new DOMException('quota exceeded', 'QuotaExceededError'))).toBe(false)
  })

  it('an abort is NOT absent', () => {
    expect(isNotFound(new DOMException('aborted', 'AbortError'))).toBe(false)
  })

  it('a transient/unknown state failure is NOT absent — this is the 11:19:40 error', () => {
    // The precise shape injected by scripts/openguard-probe/blankdoc.mjs to reproduce the incident.
    expect(isNotFound(new DOMException('simulated transient read failure', 'InvalidStateError'))).toBe(false)
  })

  it('a corrupt-JSON SyntaxError is NOT absent — the bytes are still on disk', () => {
    expect(isNotFound(new SyntaxError('Unexpected end of JSON input'))).toBe(false)
  })

  it('a security/permission failure is NOT absent', () => {
    expect(isNotFound(new DOMException('denied', 'SecurityError'))).toBe(false)
    expect(isNotFound(new DOMException('denied', 'NotAllowedError'))).toBe(false)
  })

  it('a name that merely STARTS WITH or CONTAINS NotFound is NOT absent', () => {
    // Guards a loose `.includes('NotFound')` rewrite.
    expect(isNotFound(new DOMException('x', 'NotFoundErrorX'))).toBe(false)
    expect(isNotFound(new DOMException('x', 'NotSupportedError'))).toBe(false)
  })

  it('junk is NOT absent — null, undefined, strings, numbers', () => {
    // A bare string error is the classic worker-relay shape; `'NotFoundError'` as a STRING must not
    // read as absence.
    expect(isNotFound(null)).toBe(false)
    expect(isNotFound(undefined)).toBe(false)
    expect(isNotFound('NotFoundError')).toBe(false)
    expect(isNotFound(42)).toBe(false)
    expect(isNotFound({})).toBe(false)
  })

  it('a plain object carrying the right NAME is absent — a worker-relayed DOMException', () => {
    // Deliberately honoured, and the reasoning is asymmetric-cost: being too STRICT here tells a
    // first-time writer (no `documents/` directory yet) that their storage is broken, instead of
    // handing them a blank page. Being too LENIENT overwrites a thesis. So: trust the name, never
    // the message.
    expect(isNotFound({ name: 'NotFoundError' })).toBe(true)
  })
})
