// THE BACKGROUND WORKER'S TWO DISCIPLINES, NEITHER OF WHICH FAILS LOUDLY.
//
// `extension-src/entrypoints/background.ts` is the relay between the app, the popup and the source
// page, and it sits outside `pnpm test` with the rest of `extension-src/`. Two of its rules are
// invisible when broken:
//
//  1. AN ASYNC BRANCH MUST `return true`. Chrome closes the message channel the moment the listener
//     returns a falsy value, so a branch that answers from a `.then()` without returning true has
//     its reply thrown away — and the CALLER never settles. Its own comment says exactly this:
//     "forgetting it is how a caller waits for ever on a reply the runtime already threw away." The
//     reader's status ping is one of these, and on that channel a promise that never settles is
//     indistinguishable from "no extension installed" — the same silence that hid the missing
//     content_scripts key for months.
//
//  2. THE INSTALL HOOK MUST NOT FIRE ON UPDATES. `runtime.onInstalled` fires for `install`,
//     `update` AND `chrome_update`. Without the reason check, every background update of the
//     extension opens a tab in the writer's face. That is a nag, and it is the kind of thing nobody
//     notices until it has happened to a user three times.
//
// ⚠ WHY A SOURCE GUARD AND NOT A REAL ONE — costed, not assumed. Route 3 (a `browser` stub plus a
// vitest project for the workspace) was SPIKED and it WORKS: a ~35-line stub plus `defineBackground`
// imports background.ts and registers its listeners in 352ms. It was declined because the only
// thing it needed that this file does not have is the `@inkwave/*` alias map, which lives in
// `wxt.config.ts`'s vite config — mirroring it into the root config means the same three mappings
// defined in two places, which is the drift trap this repo has been bitten by repeatedly, in a
// shared build file, to buy coverage of two rules that are purely syntactic. Both rules below are
// properties of the TEXT, so the text is what they read. If a future rule needs real behaviour, the
// spike is known to work and the alias map should be exported from one module first.
//
// ⚠ COMMENTS ARE STRIPPED BEFORE SCANNING. The worker's own comment explains `return true` by
// naming it, so a raw-text scan would read the explanation as the code.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FILE = join(process.cwd(), 'extension-src/entrypoints/background.ts')

function code(): string {
  return readFileSync(FILE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** The `onMessage` listener body, and the branches inside it keyed by their `m.type` test. */
function relayBranches(): { head: string; body: string }[] {
  const src = code()
  const start = src.indexOf('browser.runtime.onMessage.addListener')
  if (start < 0) return []
  const body = src.slice(start)
  // Split at each top-level `if (m.type === …) {`. The trailing text after the last branch is the
  // fall-through `return false`, which owns no branch and is dropped.
  const parts = body.split(/\n\s{4}(?=if \(m\.type ===)/).slice(1)
  return parts.map(p => ({ head: p.slice(0, p.indexOf('{')), body: p.split(/\n\s{4}(?=if \(|return false)/)[0] }))
}

describe('the background relay keeps its message channels open', () => {
  it('VOID GUARD: the branches are actually found', () => {
    // Every assertion here is "for each branch, …", which is vacuously true of an empty list — and
    // an empty list is exactly what a refactor of the listener would produce.
    const b = relayBranches()
    expect(b.length, 'no m.type branches found in the onMessage listener').toBeGreaterThan(8)
    // And the sweep must be able to see BOTH kinds, or it cannot discriminate between them.
    expect(b.filter(x => x.body.includes('sendResponse')).length, 'no async branches seen').toBeGreaterThan(4)
    expect(b.filter(x => !x.body.includes('sendResponse')).length, 'no sync branches seen').toBeGreaterThan(1)
  })

  it('every branch that answers via sendResponse returns true', () => {
    const bad = relayBranches()
      .filter(b => b.body.includes('sendResponse') && !/\breturn true\b/.test(b.body))
      .map(b => b.head.trim())
    expect(bad, `async branch(es) that drop their reply: ${bad.join(' | ')}`).toEqual([])
  })

  it('every branch that does NOT answer returns false', () => {
    // The opposite mistake and equally real: `return true` on a branch that never calls
    // sendResponse holds the port open until the caller times out, rather than letting it settle.
    const bad = relayBranches()
      .filter(b => !b.body.includes('sendResponse') && /\breturn true\b/.test(b.body))
      .map(b => b.head.trim())
    expect(bad, `branch(es) holding the channel open with nothing to send: ${bad.join(' | ')}`).toEqual([])
  })
})

describe('the install-time onboarding opens the popup once, not on every update', () => {
  it('onInstalled is guarded on the install reason', () => {
    const src = code()
    const hook = src.match(/onInstalled\.addListener\([\s\S]*?\n  \}\)/)?.[0] ?? ''
    expect(hook, 'the onInstalled hook was not found — re-aim this guard').not.toBe('')
    // `runtime.onInstalled` also fires for 'update' and 'chrome_update'. Opening a tab on those is
    // a nag; the reason check is the whole of what makes this a one-time offer.
    expect(hook, 'the hook fires on updates too').toMatch(/details\.reason\s*!==\s*'install'|details\.reason\s*===\s*'install'/)
  })

  it('it does not open anything when the permission is already held', () => {
    // A reinstall over an existing grant should be silent — and the grant is the thing the popup
    // exists to ask for, so asking again when it is held is pure noise.
    const src = code()
    const hook = src.match(/onInstalled\.addListener\([\s\S]*?\n  \}\)/)?.[0] ?? ''
    expect(hook).toMatch(/canFetchPages\(\)/)
  })
})
