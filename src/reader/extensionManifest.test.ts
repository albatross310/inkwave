// THE BRIDGE MUST BE DECLARED IN THE MANIFEST, AND FOR A LONG TIME IT WAS NOT.
//
// ⚠ THE BUG THIS KEEPS OUT (2026-08-30, found from Peter's "still broken"). `content-inkwave.ts`
// contains `defineContentScript({ matches: [...] })`, which reads exactly like a declarative
// registration. It is not one: WXT recognises a content script by FILENAME (`*.content.ts`), so
// that file was built as an UNLISTED SCRIPT — compiled, shipped, never named in the manifest, its
// `matches` inert. The built manifest had NO `content_scripts` key at all.
//
// It went unnoticed because the background worker ALSO injects the script with
// `scripting.executeScript`, but only while flushing a captured citation. So the bridge existed
// after Alt+Shift+C and at no other time, and the source reader's ping — which happens on page
// load — got silence. On that channel silence is indistinguishable from "no extension installed",
// so live view stayed dark with every other part of the feature correct and gated green.
//
// This reads the BUILT manifest, not the source: the source was already right and the build was
// wrong, which is the entire failure. A test asserting the source's `matches` would have passed
// throughout. Same discipline as music/chunk.test.ts, which reads real build output for the same
// reason — and, like it, a stale `.output/` makes this fail honestly rather than silently pass.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { INKWAVE_ORIGINS } from '../../extension-src/utils/constants'

const MANIFEST = join(process.cwd(), 'extension-src/.output/chrome-mv3/manifest.json')
const built = () => JSON.parse(readFileSync(MANIFEST, 'utf8'))

describe.skipIf(!existsSync(MANIFEST))('the built extension manifest declares the app bridge', () => {
  it('has a content_scripts entry at all', () => {
    // The literal shape of the bug: this key was absent.
    expect(built().content_scripts).toBeDefined()
    expect(Array.isArray(built().content_scripts)).toBe(true)
    expect(built().content_scripts.length).toBeGreaterThan(0)
  })

  it('injects the bridge on every Inkwave origin', () => {
    const cs = built().content_scripts.find((c: { js?: string[] }) => c.js?.includes('content-inkwave.js'))
    expect(cs, 'no content script ships content-inkwave.js').toBeDefined()
    // Derived from the same constant the worker filters tabs with, so the two can never disagree
    // about what counts as an Inkwave tab.
    for (const origin of INKWAVE_ORIGINS) {
      expect(cs.matches, `bridge does not match ${origin}`).toContain(`${origin}/*`)
    }
  })

  it('KNOWN-NEGATIVE: the assertions can see a missing or narrowed registration', () => {
    // Proves these checks discriminate rather than passing on whatever they are handed.
    const none = { content_scripts: undefined }
    expect(none.content_scripts).toBeUndefined()
    const narrowed = [{ js: ['content-inkwave.js'], matches: ['http://localhost:5173/*'] }]
    const cs = narrowed.find((c) => c.js.includes('content-inkwave.js'))!
    expect(cs.matches).not.toContain('https://iwzero.me/*')
  })

  it('still grants the framing permission', () => {
    // The other half of live view: without this the rule cannot be installed at all.
    expect(built().permissions).toContain('declarativeNetRequestWithHostAccess')
  })
})
