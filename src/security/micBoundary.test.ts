import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { CAMERA_CAPABLE, MIC_CAPABLE, MIC_PATTERN, PATTERN_CARRIER, isCameraOnly, micPolicyAllows } from './micBoundary'

// The firebreak under test (micBoundary.ts has the argument). Two layers:
//   1. `Permissions-Policy: microphone=()` in vercel.json — the platform chokepoint, already live.
//   2. A source allow-list — which module may name a capture API — swept over the whole of src/.
//
// ─── THE LAYER THAT CAME OFF, AND WHY THAT IS NOT A WEAKENING ────────────────────────────────
//
// There was a third: an IMPORT-GRAPH firebreak asserting that nothing reachable from
// `src/music/lesson/` was mic-capable, walked rather than grepped, because the moment §A5 puts
// getUserMedia behind a helper a grep of a directory's OWN files passes while that directory
// imports the helper. The argument was right and it is not retracted. Its SUBJECT is what went:
// the lesson layer was ripped out on 2026-09-18, and a protected directory that does not exist
// makes "nothing reachable from it is mic-capable" true of the empty set — passing forever, meaning
// nothing, exactly the empty-list disease this repo keeps paying for. So it came off WITH the
// feature rather than being left as decoration.
//
// ⚠ WHAT THE SWEEP CANNOT DO, SO IT IS SAID HERE: while `MIC_CAPABLE` is empty, the repo-wide sweep
// below is strictly STRONGER than any reachability claim — nothing in src/ names a capture API at
// all, so nothing can reach one. That equivalence ENDS the day `MIC_CAPABLE` gains an entry. At
// that moment the sweep starts PERMITTING a module, cannot say who may import it, and the import
// walk has to come back (it is in this file's git history, with its empty-list probe intact).

// ⚠ DEPTH-SENSITIVE, and it bit on the move out of `src/music/lesson/`: this was `'../../..'` and
// silently pointed one directory above the repo. It failed LOUDLY (ENOENT on vercel.json) only
// because layer 1 reads a real file — the sweep below would have gone quiet instead.
const REPO = resolve(__dirname, '../..')
const SRC = join(REPO, 'src')

// ─── The instruments ─────────────────────────────────────────────────────────

/** Strip comments so a module may DISCUSS a capture API (this one does, at length) without being
 *  flagged. A guard that cannot survive its own documentation gets disabled. */
function stripComments(src: string): string {
  return src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
}

const MIC_RE = MIC_PATTERN

/** Does this file's CODE (not its prose) name a capture API? */
function isMicCapable(file: string): boolean {
  return MIC_RE.test(stripComments(readFileSync(file, 'utf8')))
}

function allSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...allSourceFiles(p))
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

/** Resolve a relative import specifier to a real file, the way the bundler would. */
function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null // bare specifier → node_modules; see the scope note below
  const base = resolve(dirname(fromFile), spec)
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand
  }
  return null
}

function importsOf(file: string): string[] {
  const code = stripComments(readFileSync(file, 'utf8'))
  const specs: string[] = []
  const re = /(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) specs.push(m[1])
  return specs
}

const rel = (f: string) => relative(REPO, f).replace(/\\/g, '/')

// ─── 0. Prove the instruments ────────────────────────────────────────────────

describe('instrument — the capture-API scanner fires', () => {
  it('detects each capture API in code', () => {
    expect(MIC_RE.test('await navigator.mediaDevices.getUserMedia({ audio: true })')).toBe(true)
    expect(MIC_RE.test('const r = new MediaRecorder(stream)')).toBe(true)
    expect(MIC_RE.test('ctx.createMediaStreamSource(stream)')).toBe(true)
    expect(MIC_RE.test('const n = new AudioWorkletNode(ctx, "x")')).toBe(true)
  })

  it('CONSTRUCTING a recogniser fires; merely NAMING one does not', () => {
    // The distinction stt.ts depends on: feature-detection captures no audio, and a guard that
    // could not tell the difference would force this lane's own finding off the record.
    expect(MIC_RE.test('const r = new webkitSpeechRecognition()')).toBe(true)
    expect(MIC_RE.test('new SpeechRecognition()')).toBe(true)
    expect(MIC_RE.test("typeof g.webkitSpeechRecognition !== 'undefined'")).toBe(false)
    expect(MIC_RE.test('const ctor = g.SpeechRecognition ?? g.webkitSpeechRecognition')).toBe(false)
  })

  it('ignores a MENTION in a comment but not a call', () => {
    expect(MIC_RE.test(stripComments('// we never call getUserMedia here'))).toBe(false)
    expect(MIC_RE.test(stripComments('const s = getUserMedia()'))).toBe(true)
  })

  it('does not fire on ordinary code (not always-true)', () => {
    expect(MIC_RE.test('const x = notes.map((n) => n.snippet)')).toBe(false)
  })
})

// ─── 1. Layer 1 — the HTTP header (the real chokepoint) ──────────────────────

describe('layer 1 — Permissions-Policy is the line', () => {
  const vercel = JSON.parse(readFileSync(join(REPO, 'vercel.json'), 'utf8'))
  const policy: string = vercel.headers
    .flatMap((h: { headers: { key: string; value: string }[] }) => h.headers)
    .find((h: { key: string }) => h.key === 'Permissions-Policy')?.value ?? ''

  it('the header exists and is served for every path', () => {
    // A policy that isn't served is not a firebreak. Assert the SOURCE matches everything.
    expect(policy, 'no Permissions-Policy in vercel.json').toMatch(/microphone/)
    const src = vercel.headers.find((h: { headers: { key: string }[] }) =>
      h.headers.some((x) => x.key === 'Permissions-Policy'),
    ).source
    expect(src).toBe('/(.*)')
  })

  it('the microphone is disabled for this origin TODAY', () => {
    expect(micPolicyAllows(policy), `policy: ${policy}`).toBe(false)
  })

  it('the policy parser fires both ways (a parser that always says "off" proves nothing)', () => {
    expect(micPolicyAllows('camera=(), microphone=(), geolocation=()')).toBe(false)
    expect(micPolicyAllows('camera=(), microphone=(self), geolocation=()')).toBe(true)
    expect(micPolicyAllows('microphone=*')).toBe(true)
    // An ABSENT directive means the feature defaults to self-allowed — it must read as ALLOWED.
    // Reading absence as "off" would report a firebreak the platform is not enforcing.
    expect(micPolicyAllows('camera=(), geolocation=()')).toBe(true)
  })

})

// ─── 2. Layer 2 — the source allow-list ──────────────────────────────────────

describe('layer 2 — only allow-listed modules may name a capture API', () => {
  const files = allSourceFiles(SRC)

  it('the sweep sees a real repo (an empty sweep must fail, never pass)', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('no module outside MIC_CAPABLE reaches for a microphone', () => {
    const offenders = files
      .filter((f) => rel(f) !== PATTERN_CARRIER) // the carrier names every API in order to forbid them
      .filter((f) => !MIC_CAPABLE.some((prefix) => rel(f).startsWith(prefix)))
      // A CAMERA module names `getUserMedia` too (camera-or-mic), so it matches MIC_PATTERN — but it
      // reaches for a camera, not a microphone (see isCameraOnly / CAMERA_CAPABLE). It is exempt ONLY
      // while it names no audio-specific API; the mic guarantee is held by the untouched header.
      .filter((f) => !isCameraOnly(rel(f), stripComments(readFileSync(f, 'utf8'))))
      .filter(isMicCapable)
      .map(rel)
    expect(
      offenders,
      `these files name a capture API but are not in MIC_CAPABLE (micBoundary.ts). ` +
        `Adding one there is a DECISION: it also needs vercel.json's Permissions-Policy, /privacy, ` +
        `and any "we don't record" copy changed in the same commit.`,
    ).toEqual([])
  })

  it('MIC_CAPABLE is empty today — nothing in Inkwave opens a microphone', () => {
    // Not a tautology: the sweep above is what makes this a measurement rather than a declaration.
    expect(MIC_CAPABLE).toEqual([])
  })
})

// ─── 2b. The camera exemption — getUserMedia for a CAMERA, and the mic held intact ────────────

describe('the camera exemption is real, discriminates, and cannot hide a microphone', () => {
  const CAMERA_FILE = 'src/media/camera.ts'
  const codeOf = (rel: string) => stripComments(readFileSync(join(REPO, rel), 'utf8'))

  it('the declared camera module exists and names getUserMedia (so the exemption has a subject)', () => {
    expect(CAMERA_CAPABLE).toContain(CAMERA_FILE)
    expect(existsSync(join(REPO, CAMERA_FILE)), 'the declared camera module is missing').toBe(true)
    // If it did not match MIC_PATTERN, the exemption would be exempting nothing — a decoration.
    expect(MIC_RE.test(codeOf(CAMERA_FILE)), 'camera.ts no longer names a capture API').toBe(true)
  })

  it('camera.ts is treated as camera-only (it names no audio-specific API)', () => {
    expect(isCameraOnly(CAMERA_FILE, codeOf(CAMERA_FILE))).toBe(true)
  })

  it('KNOWN-NEGATIVE: a camera-declared file that ALSO names an audio API is NOT exempt', () => {
    // The exemption covers getUserMedia ONLY. Smuggling a microphone into the camera module — a
    // MediaRecorder, a Web Audio graph, a recogniser — must NOT be laundered by the declaration.
    // If it were, "the camera is exempt" would silently mean "any capture API in camera.ts is exempt".
    for (const audio of [
      'const r = new MediaRecorder(stream)',
      'ctx.createMediaStreamSource(stream)',
      'const n = new AudioWorkletNode(ctx, "x")',
      'const s = new webkitSpeechRecognition()',
    ]) {
      expect(
        isCameraOnly(CAMERA_FILE, `navigator.mediaDevices.getUserMedia({video:true})\n${audio}`),
        `an audio API (${audio}) leaked through the camera exemption`,
      ).toBe(false)
    }
  })

  it('KNOWN-NEGATIVE: a camera file that REQUESTS audio in its constraints is NOT exempt', () => {
    // getUserMedia({audio:true}) IS a microphone — the most DIRECT smuggle, and the one the bare-token
    // exemption missed until AUDIO_ONLY_PATTERN gained `audio:true` (auditor A, PROBED on the real
    // sweep: flipping camera.ts audio:false→audio:true opened the mic with every test still green,
    // because isCameraOnly never read the constraint). The literal is not ambiguous, so it is caught.
    expect(
      isCameraOnly(CAMERA_FILE, 'navigator.mediaDevices.getUserMedia({ video: true, audio: true })'),
      'a camera file requesting audio:true slipped through the exemption',
    ).toBe(false)
    // …and the honest video-only form is STILL exempt — the fix must not break the feature it guards.
    expect(
      isCameraOnly(CAMERA_FILE, 'navigator.mediaDevices.getUserMedia({ video: true, audio: false })'),
    ).toBe(true)
  })

  it('the exemption is by DECLARATION — an undeclared file naming getUserMedia stays flagged', () => {
    // A random module cannot claim to be a camera. Only paths in CAMERA_CAPABLE are exempt; the mic
    // guarantee for everyone else is unchanged.
    expect(isCameraOnly('src/components/SomethingElse.tsx', 'navigator.mediaDevices.getUserMedia({video:true})')).toBe(false)
    expect(isCameraOnly('src/media/notcamera.ts', 'navigator.mediaDevices.getUserMedia({audio:true})')).toBe(false)
  })

  it('the mic firebreak still SEES camera.ts (exemption is a filter on the sweep, not blindness)', () => {
    // isMicCapable — the raw scanner — must still fire on camera.ts. The exemption lives in the
    // OFFENDER filter, so the scanner keeps its eyes; a future audio API added here would be caught
    // by the known-negative above. If the scanner itself went blind, that safety net would be gone.
    expect(isMicCapable(join(REPO, CAMERA_FILE))).toBe(true)
  })
})

describe('the carrier exclusion cannot become a hole', () => {
  it('micBoundary.ts is imported by TEST FILES ONLY', () => {
    // The exemption above is safe ONLY while this file is inert data. If production code imports
    // it, the exclusion starts covering a live code path — an excluded file that nothing checks is
    // exactly where a microphone would hide. Same guard `src/copy/claims.test.ts` puts on
    // claimMatchers.ts, for the same reason.
    const importers = allSourceFiles(SRC).filter((f) =>
      importsOf(f).some((spec) => resolveImport(f, spec) === join(SRC, 'security', 'micBoundary.ts')),
    )
    expect(importers.map(rel), 'production code imports the pattern carrier').toEqual([])
  })

  it('and it IS imported by the tests (an exclusion nothing uses proves nothing)', () => {
    // If no test imported it, the "tests only" assertion above would pass vacuously on a file that
    // had simply fallen out of use — and MIC_PATTERN would be guarding nothing at all.
    const testFiles = readdirSync(join(SRC, 'security')).filter((f) => /\.test\.tsx?$/.test(f))
    const importers = testFiles.filter((f) =>
      readFileSync(join(SRC, 'security', f), 'utf8').includes("from './micBoundary'"),
    )
    expect(importers.length).toBeGreaterThanOrEqual(1)
  })
})

// SCOPE, STATED: layer 2 sweeps `src/` only, so a microphone reached through an npm package would
// not be seen here. That is a real hole and it is named rather than implied. Layer 1 covers it
// anyway — `Permissions-Policy: microphone=()` blocks the platform API no matter who calls it. A
// dependency that opens a mic would need the header changed to work at
// all, which is the decision point this whole file routes through.
