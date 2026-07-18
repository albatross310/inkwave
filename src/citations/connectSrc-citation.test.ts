// ─── The citation network layer must fetch NO host the browser's CSP would block ────────────────
//
// ADOPTED + TURNED GREEN from the standing auditor's RED guard (feat/audit-a, 5b37809). The finding:
// "the citation styles other than APA" — Chicago / MLA / Vancouver / Harvard, a LIVE unflagged
// feature — lazy-loaded from `cdn.jsdelivr.net`, which is NOT in `middleware.ts`'s CSP `connect-src`.
// The CSP is a Vercel EDGE middleware, so `pnpm dev`/`pnpm test` never run it: the four styles worked
// on every dev machine and in every test and were blocked ONLY in production, where `ensureStyle`
// threw, `bibFormat.ts` caught it, and the writer silently got a plain author-year list.
//
// THE FIX SHIPPED: the four styles are now BUNDLED (vendored `.csl` XML under `styles/`, lazy chunks)
// — there is NO runtime CDN fetch, so there is no host to list. This guard keeps it that way:
//   1. GENERAL — every external host the citation network layer (`styles.ts` + `lookup.ts`) actually
//      fetches must be covered by connect-src. A future lane that adds `fetch('https://new-api…')`
//      and forgets the CSP trips here. (Reintroducing the jsdelivr style fetch trips here too: the
//      host reappears in `styles.ts` and is uncovered — the mutation the fix was proved against.)
//   2. SPECIFIC — `styles.ts` must reference NO CDN style host at all, and the four vendored files
//      must exist carrying their CC-BY-SA attribution. This pins the bundling directly, so a revert
//      to a CDN fetch fails even if someone were to also add the host to connect-src.
//
// SCOPE, STATED (from the auditor): the allowlist and fetch hosts are read from source. That the
// browser BLOCKS a non-listed connect-src host is the CSP spec, not something this test executes — it
// needs no browser precisely because the allowlist is declarative. ~5ms, in the gate.

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO = resolve(__dirname, '..', '..')

/** The connect-src hosts the browser is actually served, parsed from the middleware that sets it. */
function connectSrcHosts(): string[] {
  const mw = readFileSync(join(REPO, 'middleware.ts'), 'utf8')
  const m = mw.match(/"connect-src ([^"]*)"/)
  if (!m) throw new Error('connect-src directive not found in middleware.ts')
  return m[1].split(/\s+/).filter(t => t.startsWith('https://')).map(t => t.replace('https://', ''))
}

/** connect-src coverage, honouring a leading `*.` wildcard exactly as a browser does. */
function isCovered(host: string, allowed: string[]): boolean {
  return allowed.some(a => a === host || (a.startsWith('*.') && host.endsWith(a.slice(1))))
}

/**
 * Every external host fetched by the citation NETWORK layer. These two files are the whole layer —
 * `styles.ts` (was the CSL style CDN; now bundled) and `lookup.ts` (identifier → CSLItem APIs).
 * `capture.ts`'s doi.org / arxiv.org / pubmed literals are deliberately NOT here: they build
 * href/display URLs, never fetch.
 */
function citationFetchHosts(): { host: string; file: string }[] {
  const out: { host: string; file: string }[] = []
  for (const file of ['src/citations/styles.ts', 'src/citations/lookup.ts']) {
    const src = readFileSync(join(REPO, file), 'utf8')
    for (const m of src.matchAll(/https:\/\/([a-zA-Z0-9.-]+)/g)) {
      out.push({ host: m[1], file })
    }
  }
  return out
}

describe('connect-src covers the citation layer’s fetch hosts', () => {
  const allowed = connectSrcHosts()
  const hosts = citationFetchHosts()

  it('VOID GUARD: the layer really was scanned and has hosts', () => {
    // An empty extraction passing is the failure mode this repo keeps finding. lookup.ts alone
    // fetches ≥5 identifier APIs, so a zero here means the scan silently read nothing.
    expect(hosts.length).toBeGreaterThanOrEqual(5)
    expect(allowed.length).toBeGreaterThanOrEqual(10)
  })

  it('KNOWN-POSITIVE: the coverage check can actually say NO', () => {
    // Without this, `isCovered` could return true always and every assertion below would pass blind.
    expect(isCovered('cdn.jsdelivr.net', ['https-nonsense'])).toBe(false)
    expect(isCovered('graph.microsoft.com', allowed)).toBe(true)             // a real listed host
    expect(isCovered('foo.microsoftpersonalcontent.com', allowed)).toBe(true) // the *. wildcard works
  })

  it.each([...new Set(hosts.map(h => h.host))])('connect-src allows %s', host => {
    const where = hosts.find(h => h.host === host)!.file
    expect(
      isCovered(host, allowed),
      `${host} is fetched by ${where} but is NOT in middleware.ts connect-src, so the browser blocks ` +
        `it in production (the CSP is enforced only there — dev and tests never see it). This is a ` +
        `SILENT prod failure. Fix: add it to connect-src, bundle it, or stop fetching it.`,
    ).toBe(true)
  })
})

// ─── The CSL styles are bundled, not fetched (the specific regression this fix removes) ──────────
// MENTION vs USE (the trap this repo keeps re-learning): a guard that greps RAW source fires on the
// comment that documents the very thing it forbids — styles.ts's header names `cdn.jsdelivr.net`
// precisely to explain why the fetch is gone. So we judge the CODE: comments are stripped first, and
// deleting the explanatory comment is not how you make this pass.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')     // block comments
    .replace(/(^|[^:])\/\/.*$/gm, '$1')   // line comments — the `[^:]` spares `://` inside a URL
}

describe('CSL styles are bundled, not fetched from a CDN', () => {
  const STYLES_CODE = stripComments(readFileSync(join(REPO, 'src/citations/styles.ts'), 'utf8'))

  it('styles.ts references NO external host — nothing to be blocked in production', () => {
    const hosts = [...STYLES_CODE.matchAll(/https:\/\/([a-zA-Z0-9.-]+)/g)].map(m => m[1])
    expect(
      hosts,
      `styles.ts must not reference any runtime fetch host (it should import vendored .csl instead). ` +
        `Found: ${hosts.join(', ')}`,
    ).toEqual([])
    // Belt and braces: the specific host the bug shipped, and any runtime style fetch.
    expect(STYLES_CODE).not.toMatch(/jsdelivr/)
    expect(STYLES_CODE).not.toMatch(/fetch\s*\(/)
  })

  it('the four non-APA styles are vendored and self-contained, with attribution preserved', () => {
    for (const id of ['chicago-author-date', 'modern-language-association', 'vancouver', 'harvard-cite-them-right']) {
      const xml = readFileSync(join(REPO, 'src/citations/csl', `${id}.csl`), 'utf8')
      expect(xml.length, `${id}.csl looks empty/truncated`).toBeGreaterThan(2000)
      // Self-contained: an independent-parent link would mean the style fetches its parent at runtime.
      expect(xml, `${id}.csl is a DEPENDENT style — it would fetch its parent at runtime`).not.toMatch(/independent-parent/)
      // CC-BY-SA attribution header must survive vendoring.
      expect(xml, `${id}.csl lost its <rights> attribution (CC-BY-SA)`).toMatch(/<rights\b/)
    }
  })
})
