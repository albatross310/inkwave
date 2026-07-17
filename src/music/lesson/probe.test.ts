import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// The whisper probe (`public/whisper-probe.html`) is a standalone document Peter loads on his
// iPhone 12 to decide WHICH MODEL and THREADED OR NOT. It is plain HTML, so nothing else in the
// gate looks at it — typecheck ignores it and vitest would never touch it. These are the invariants
// that, if they broke, would make the probe report a CONFIDENT WRONG ANSWER rather than fail.
//
// That is the only reason this file exists: a probe that lies is worse than no probe, because its
// number gets quoted in a decision months later.

const REPO = resolve(__dirname, '../../..')
const PROBE = join(REPO, 'public/whisper-probe.html')
const html = () => readFileSync(PROBE, 'utf8')

describe('the whisper probe cannot silently lie', () => {
  it('exists and is served from public/ as a REAL separate document', () => {
    // Not a route: COOP/COEP are per-document and this app is an SPA where a route is not a
    // document — a client-side <Link> keeps the entry document's headers, so an "isolated route"
    // is isolated on a hard load and silently not isolated when navigated to.
    expect(html().length).toBeGreaterThan(2000)
  })

  it('vercel.json grants the probe cross-origin isolation — without it threads CANNOT run', () => {
    // If this header is dropped, SharedArrayBuffer disappears, ORT silently falls back to one
    // thread, and every "threaded" row becomes a measurement of a fiction. The probe detects that
    // at runtime and reports N/A — but the header is what makes the measurement possible at all.
    const vercel = JSON.parse(readFileSync(join(REPO, 'vercel.json'), 'utf8'))
    const rule = vercel.headers.find((h: { source: string }) => h.source === '/whisper-probe.html')
    expect(rule, 'no header rule for /whisper-probe.html').toBeTruthy()
    const keys = rule.headers.map((h: { key: string; value: string }) => `${h.key}: ${h.value}`)
    expect(keys).toContain('Cross-Origin-Opener-Policy: same-origin')
    expect(keys).toContain('Cross-Origin-Embedder-Policy: require-corp')
  })

  it('the probe grants NO microphone — a latency benchmark does not need one', () => {
    // The mic stays off for the whole origin (`microphone=()`); that change belongs with the real
    // capture feature and /privacy, in one commit, not smuggled in behind a benchmark.
    const vercel = JSON.parse(readFileSync(join(REPO, 'vercel.json'), 'utf8'))
    const rule = vercel.headers.find((h: { source: string }) => h.source === '/whisper-probe.html')

    // Judge the HEADERS THIS RULE SENDS — not the JSON blob around them. The first cut regexed
    // JSON.stringify(rule) and failed on the rule's OWN `"//"` note, which says the probe grants no
    // microphone: a mention read as a use. That is the third time tonight this exact confusion has
    // bitten (micBoundary's first cut flagged stt.ts; claims.test.ts read a cited filename as an
    // import). A guard must look at what the thing DOES, never at prose about it.
    const sends = (rule.headers as { key: string; value: string }[])
      .map((h) => `${h.key}: ${h.value}`)
      .join('\n')
    expect(sends, 'the probe rule sends a Permissions-Policy').not.toMatch(/microphone/i)

    // And the origin-wide policy still denies the mic to everyone, probe included.
    const global = vercel.headers.find((h: { source: string }) => h.source === '/(.*)')
    const pp = (global.headers as { key: string; value: string }[])
      .find((h) => h.key === 'Permissions-Policy')!.value
    expect(pp).toMatch(/microphone=\(\)/)

    expect(html()).not.toMatch(/getUserMedia|MediaRecorder/)
  })

  it('transformers.js is PINNED to the v3 line — 4.x cannot load these models at all', () => {
    // PROBED headless: 4.2.0 fails to create an ORT session — "TransposeDQWeightsForMatMulNBits
    // Missing required scale" — identically across tiny/base and every dtype, which is what ruled
    // out the model and the dtype and left the runtime. A silent bump to 4.x turns the probe into
    // an error page.
    const v = /@huggingface\/transformers@(\d+)\.(\d+)\.(\d+)/.exec(html())
    expect(v, 'no pinned transformers.js version').toBeTruthy()
    expect(Number(v![1]), 'transformers.js 4.x cannot create an ORT session for whisper').toBe(3)
  })

  it('it measures MORE THAN ONE chunk size — a single size bakes in the answer', () => {
    // The finding that makes this probe honest: Whisper's encoder always processes a padded 30s
    // window, so cost is nearly flat in chunk length. Measured on desktop, the SAME model in the
    // SAME run scored RTF 4.97 at 5s and 0.40 at 30s — a 12x swing from chunk size alone. A 5s-only
    // probe would have reported FAIL for everything and killed a feature that works.
    expect(html()).toMatch(/const CHUNKS = \[\s*5\s*,\s*30\s*\]/)
  })

  it('a threaded run that spawned no workers is reported N/A, not as a number', () => {
    // The positive control. Desktop validation showed "threaded" only ~16% faster than single —
    // a reading that could mean threads-do-not-help OR numThreads-was-ignored, indistinguishable
    // by construction. Counting Worker constructions distinguishes them (proved: 0 vs 7).
    const h = html()
    expect(h).toMatch(/workers\+\+/)
    expect(h).toMatch(/spawned 0 workers/)
  })

  it('it reads crossOriginIsolated at RUNTIME rather than inferring it', () => {
    expect(html()).toMatch(/globalThis\.crossOriginIsolated === true/)
  })

  it('it states the limits it cannot measure instead of fabricating them', () => {
    const h = html()
    // Peak memory is not measurable on iOS Safari (performance.memory is Chrome-only;
    // measureUserAgentSpecificMemory is unimplemented). The breadcrumb is the honest instrument.
    expect(h).toMatch(/iw:whisperProbe:running/)
    expect(h).toMatch(/DIED/)
    // And the sample is a clean studio clip — a real lesson room is harder, so it is a LOWER BOUND.
    expect(h).toMatch(/LOWER BOUND/)
  })
})
