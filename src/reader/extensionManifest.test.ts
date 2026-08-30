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

const OUT = join(process.cwd(), 'extension-src/.output/chrome-mv3')
const MANIFEST = join(OUT, 'manifest.json')
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

// ── THE PERMISSION SHAPE, WHICH IS A PRODUCT DECISION AND NOT A DETAIL ─────────────────────────
// Everything below guards a choice argued at length in wxt.config.ts, where the ARGUMENT lives and
// nothing checks it. Each is one careless edit away, and each edit is silent: the extension keeps
// working for the developer who made it and changes what every installed copy prompts for.
describe.skipIf(!existsSync(MANIFEST))('the built manifest keeps page fetching OPTIONAL', () => {
  it('offers <all_urls> as an OPTIONAL host permission', () => {
    // Firefox (MV2) spells the same grant `optional_permissions`; this is the Chrome build.
    expect(built().optional_host_permissions).toContain('<all_urls>')
  })

  it('KEEPER: <all_urls> is NOT required, in either list', () => {
    // The whole of wxt.config.ts's argument. A REQUIRED `<all_urls>` rewrites the install prompt
    // for every user into "Read and change all your data on all websites" — including the users who
    // only ever press Alt+Shift+C on a DOI page — and Chrome DISABLES existing installs pending
    // re-approval. Promoting it is a one-line edit that a developer who has already granted the
    // permission would never notice.
    const m = built()
    expect(m.permissions ?? [], 'promoted to a required permission').not.toContain('<all_urls>')
    expect(m.host_permissions ?? [], 'promoted to a required host permission').not.toContain('<all_urls>')
    // And no wildcard smuggled in under another spelling.
    for (const p of m.host_permissions ?? []) {
      expect(p, `host_permissions entry is an all-sites wildcard: ${p}`).not.toMatch(/^(\*|<all_urls>|https?:\/\/\*\/\*$)/)
    }
  })

  it('KEEPER: the framing permission is the NARROW form only', () => {
    // `declarativeNetRequestWithHostAccess` installs rules only where host access is already held,
    // so the framing rule inherits the optional grant instead of being a second, broader permission
    // the writer never agreed to — and its install prompt is silent, where the plain form warns
    // about reading browsing activity, which would be a warning about something this extension does
    // not do. `.toContain` on the narrow name passes with BOTH present, so the negative is the
    // assertion that matters.
    const perms: string[] = built().permissions ?? []
    expect(perms).toContain('declarativeNetRequestWithHostAccess')
    expect(perms, 'the broad declarativeNetRequest would warn about browsing activity').not.toContain('declarativeNetRequest')
  })

  it('grants no permission that observes browsing', () => {
    // A tripwire rather than a prediction: these are the names that would change what the extension
    // IS, and adding one should be a decision somebody argues for, not a diff nobody reads.
    const perms: string[] = built().permissions ?? []
    for (const forbidden of ['webRequest', 'webRequestBlocking', 'history', 'cookies', 'tabCapture', 'debugger']) {
      expect(perms, `unexpected permission: ${forbidden}`).not.toContain(forbidden)
    }
  })
})

// ── FILES INJECTED BY NAME ─────────────────────────────────────────────────────────────────────
// The SAME failure class as the missing content_scripts key this file was written for, one level
// along: `background.ts` injects content scripts with `scripting.executeScript({ files: [...] })`,
// i.e. by STRING. WXT names those outputs after the ENTRYPOINT FILENAME, so nothing declarative
// couples the two — renaming `content-source.ts` moves the built file out from under four call
// sites, TypeScript is happy, the build is happy, and citation capture silently stops showing its
// verification panel. Only the artifact can answer this.
describe.skipIf(!existsSync(MANIFEST))('every script the worker injects by name exists in the build', () => {
  const workerSource = () =>
    readFileSync(join(process.cwd(), 'extension-src/entrypoints/background.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')   // comments stripped: they name these files to explain them

  const injected = () => {
    const names = new Set<string>()
    for (const m of workerSource().matchAll(/files:\s*\[([^\]]*)\]/g)) {
      for (const f of m[1].matchAll(/['"]([^'"]+)['"]/g)) names.add(f[1])
    }
    return [...names]
  }

  it('VOID GUARD: the scan finds the injection call sites at all', () => {
    // "Every named file exists" is vacuously true of an empty list, which is exactly what a renamed
    // API or a refactor into a helper would produce.
    expect(injected().length, 'no executeScript file list found in background.ts').toBeGreaterThan(0)
  })

  it('each injected filename is a real file in .output', () => {
    for (const name of injected()) {
      expect(existsSync(join(OUT, name)), `background.ts injects '${name}', which the build does not produce`).toBe(true)
    }
  })

  it('the popup the install-time onboarding opens is really there', () => {
    // `runtime.onInstalled` opens `runtime.getURL('popup.html')` so the optional grant is offered
    // once rather than hidden behind the puzzle-piece icon. If that file is not built, a fresh
    // install opens a blank tab and the reader's whole point stays off with nothing to explain it.
    const popup = built().action?.default_popup
    expect(popup, 'no default_popup declared').toBeTruthy()
    expect(existsSync(join(OUT, popup)), `default_popup '${popup}' is not in the build`).toBe(true)
    expect(workerSource(), 'onboarding no longer opens the popup by that name').toContain(popup)
  })

  it('the background service worker names a file that exists', () => {
    const sw = built().background?.service_worker
    expect(sw, 'no service_worker declared').toBeTruthy()
    expect(existsSync(join(OUT, sw)), `service_worker '${sw}' is not in the build`).toBe(true)
  })
})
