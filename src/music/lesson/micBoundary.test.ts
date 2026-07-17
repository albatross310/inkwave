import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { MIC_CAPABLE, MIC_FORBIDDEN, MIC_PATTERN, PATTERN_CARRIER, micPolicyAllows } from './micBoundary'
import * as copy from './copy'

// The firebreak under test (micBoundary.ts has the argument). Three layers:
//   1. `Permissions-Policy: microphone=()` in vercel.json — the platform chokepoint, already live.
//   2. A source allow-list — which module may name a capture API.
//   3. An import-graph firebreak — nothing REACHABLE from src/music/lesson/ may be mic-capable.
//
// ─── WHY LAYER 3 IS FOLLOWED RATHER THAN GREPPED ─────────────────────────────────────────────
//
// `copy.test.ts` already asserts no capture API appears in `lesson/`'s own files. That assertion is
// true and will KEEP being true after it stops meaning anything: the moment §A5 puts getUserMedia
// behind `src/music/recording/recorder.ts`, `lesson/` can `import { openMic }` and the grep still
// passes. A firebreak whose instrument cannot see the thing that breaks it is the house disease
// wearing the exact costume it wore in `canvasShapingMatchesEditor`. So the import graph is walked.
//
// ─── AND WHY THE WALK ITSELF IS PROVED FIRST ─────────────────────────────────────────────────
//
// "Nothing reachable from lesson/ is mic-capable" passes trivially if the resolver reaches NOTHING
// — a broken extension guess, a bad path join, and the reachable set is just the start files. That
// is the empty-list probe CLAUDE.md records. So the walk must first be shown to CROSS A MODULE
// BOUNDARY it is known to cross (lesson/session.ts → ../types.ts, a real import), before any
// verdict about what it did not find is read.

const REPO = resolve(__dirname, '../../..')
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

/** Every file reachable from `roots` by following relative imports, transitively. */
function reachableFrom(roots: string[]): Set<string> {
  const seen = new Set<string>()
  const stack = [...roots]
  while (stack.length) {
    const f = stack.pop()!
    if (seen.has(f)) continue
    seen.add(f)
    for (const spec of importsOf(f)) {
      const r = resolveImport(f, spec)
      if (r && !seen.has(r)) stack.push(r)
    }
  }
  return seen
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

describe('instrument — the import walk actually CROSSES MODULE BOUNDARIES', () => {
  // THE CONTROL THAT MAKES LAYER 3 MEAN ANYTHING. If this fails, "nothing mic-capable is
  // reachable" is a statement about an empty set.
  const lessonRoots = allSourceFiles(join(SRC, 'music', 'lesson'))
  const reach = reachableFrom(lessonRoots)

  it('finds the lesson module itself', () => {
    expect(lessonRoots.length).toBeGreaterThanOrEqual(5)
  })

  it('REACHES ../types.ts — a real import, outside the lesson directory', () => {
    // session.ts → './types' → '../types' (the §1 Piece contract). If the resolver cannot follow
    // that, it cannot follow lesson/ → recording/ either, and the firebreak is decoration.
    const reached = [...reach].map(rel)
    expect(reached, 'the walk never left src/music/lesson/').toContain('src/music/types.ts')
  })

  it('reaches strictly MORE than the roots (it traverses, it does not just echo)', () => {
    expect(reach.size).toBeGreaterThan(lessonRoots.length)
  })

  it('resolveImport handles the real extensions', () => {
    const session = join(SRC, 'music', 'lesson', 'session.ts')
    expect(resolveImport(session, './types')).toBe(join(SRC, 'music', 'lesson', 'types.ts'))
    expect(resolveImport(session, '../types')).toBe(join(SRC, 'music', 'types.ts'))
    expect(resolveImport(session, 'uuid')).toBeNull() // bare → not followed; see the scope note
  })
})

// ─── 1. Layer 1 — the HTTP header (the real chokepoint) ──────────────────────

describe('layer 1 — Permissions-Policy is the line, and the copy is bound to it', () => {
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

  it('THE BINDING: while the mic is disabled, the lesson may claim it cannot record', () => {
    // The claim and the policy move together or this test fails. Flip the header to
    // `microphone=(self)` for §A5's recordings and THIS FIRES — which is the prompt to rewrite the
    // copy, /privacy, and this assertion, deliberately, in one commit.
    const claimsNoMic = /does not record audio|cannot record audio|not recording/i.test(
      Object.values(copy).filter((v) => typeof v === 'string').join(' '),
    )
    if (!micPolicyAllows(policy)) {
      expect(claimsNoMic, 'mic is off but no copy says so — the reassurance is missing').toBe(true)
    } else {
      expect(
        claimsNoMic,
        'THE MIC IS NOW ENABLED but the lesson copy still says Inkwave cannot record. ' +
          'Rewrite the copy and /privacy before shipping this header.',
      ).toBe(false)
    }
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

// ─── 3. Layer 3 — the import-graph firebreak (the one that survives a helper) ─

describe('layer 3 — the lesson path cannot REACH a microphone, transitively', () => {
  for (const protectedDir of MIC_FORBIDDEN) {
    it(`nothing reachable from ${protectedDir} is mic-capable`, () => {
      const roots = allSourceFiles(join(REPO, protectedDir))
      const reach = [...reachableFrom(roots)]
      const capable = reach.filter(isMicCapable).map(rel).filter((f) => f !== PATTERN_CARRIER)
      expect(
        capable,
        `${protectedDir} can reach a microphone. §A3's promise to the teacher is that this ` +
          `screen cannot. If that is now intended, the guarantee CHANGES SHAPE and the copy must ` +
          `say so — do not simply delete this test.`,
      ).toEqual([])
    })
  }

  it('KNOWN-NEGATIVE: the firebreak FIRES when the lesson imports a mic-capable module', () => {
    // THE REAL EROSION PATH, SIMULATED WHERE IT WILL ACTUALLY HAPPEN. §A5's practice recordings
    // land in the media lane (`src/media/` — importMedia/mediaStore are LIVE as of 2026-07-17 and
    // are that feature's prerequisite), and the lesson panel has every innocent reason to import
    // from there one day: an attachment, a thumbnail, a type. The moment that lane gains
    // `getUserMedia`, THIS is the import that hands the lesson path a microphone.
    //
    // The fixture is CROSS-DIRECTORY on purpose. A same-directory fixture would have proved only
    // that the walk resolves './x' — it would not prove the walk LEAVES the lesson module, which is
    // the entire claim. (copy.test.ts's grep of lesson/'s own files stays green through all of
    // this, which is why that guard is not the one doing the work here.)
    const fakeRecorder = join(SRC, 'media', '__fake_recorder_fixture.ts')
    const fakeLessonFile = join(SRC, 'music', 'lesson', '__fake_importer_fixture.ts')
    const { writeFileSync, rmSync } = require('node:fs') as typeof import('node:fs')
    try {
      writeFileSync(fakeRecorder, 'export const open = () => navigator.mediaDevices.getUserMedia({ audio: true })\n')
      writeFileSync(fakeLessonFile, "import { open } from '../../media/__fake_recorder_fixture'\nexport const go = open\n")
      const roots = allSourceFiles(join(SRC, 'music', 'lesson'))
      const reach = [...reachableFrom(roots)]
      const capable = reach.filter(isMicCapable).map(rel).filter((f) => f !== PATTERN_CARRIER)
      expect(
        capable,
        'the walk did not follow lesson/ → src/media/ — the firebreak cannot see the §A5 path',
      ).toContain('src/media/__fake_recorder_fixture.ts')
      // And prove the IMPORT is what carried it — the importer itself names no API, so a
      // file-local grep would call this clean.
      expect(isMicCapable(fakeLessonFile)).toBe(false)
      // Layer 2 must catch it too, from the other direction: an unlisted mic-capable module.
      const offenders = allSourceFiles(SRC)
        .filter((f) => rel(f) !== PATTERN_CARRIER)
        .filter((f) => !MIC_CAPABLE.some((p) => rel(f).startsWith(p)))
        .filter(isMicCapable)
        .map(rel)
      expect(offenders).toContain('src/media/__fake_recorder_fixture.ts')
    } finally {
      rmSync(fakeRecorder, { force: true })
      rmSync(fakeLessonFile, { force: true })
    }
  })

  it('the media lane is REACHED by the sweep at all (an unswept lane cannot be judged)', () => {
    // §A5's recordings will live in `src/media/`. If layer 2's sweep never walks that directory,
    // "no module outside MIC_CAPABLE reaches for a microphone" would be true of a set that does not
    // include the one lane most likely to break it — the empty-list probe, one directory over.
    const swept = allSourceFiles(SRC).map(rel)
    expect(swept).toContain('src/media/mediaStore.ts')
  })

  it('and the firebreak is CLEAN again once the fixture is gone', () => {
    // Proves the previous test's failure was the fixture and not a permanent state — a negative
    // that leaves the suite red forever would be indistinguishable from a real break.
    const roots = allSourceFiles(join(SRC, 'music', 'lesson'))
    const capable = [...reachableFrom(roots)].filter(isMicCapable).map(rel)
      .filter((f) => f !== PATTERN_CARRIER)
    expect(capable).toEqual([])
  })
})

describe('the carrier exclusion cannot become a hole', () => {
  it('micBoundary.ts is imported by TEST FILES ONLY', () => {
    // The exemption above is safe ONLY while this file is inert data. If production code imports
    // it, the exclusion starts covering a live code path — an excluded file that nothing checks is
    // exactly where a microphone would hide. Same guard `src/copy/claims.test.ts` puts on
    // claimMatchers.ts, for the same reason.
    const importers = allSourceFiles(SRC).filter((f) =>
      importsOf(f).some((spec) => resolveImport(f, spec) === join(SRC, 'music', 'lesson', 'micBoundary.ts')),
    )
    expect(importers.map(rel), 'production code imports the pattern carrier').toEqual([])
  })

  it('and it IS imported by the tests (an exclusion nothing uses proves nothing)', () => {
    // If no test imported it, the "tests only" assertion above would pass vacuously on a file that
    // had simply fallen out of use — and MIC_PATTERN would be guarding nothing at all.
    const testFiles = readdirSync(join(SRC, 'music', 'lesson')).filter((f) => /\.test\.tsx?$/.test(f))
    const importers = testFiles.filter((f) =>
      readFileSync(join(SRC, 'music', 'lesson', f), 'utf8').includes("from './micBoundary'"),
    )
    expect(importers.length).toBeGreaterThanOrEqual(2)
  })
})

// SCOPE, STATED: bare specifiers are not followed, so a microphone reached through an npm package
// would not be seen. That is a real hole and it is named rather than implied. Layer 1 covers it
// anyway — `Permissions-Policy: microphone=()` blocks the platform API no matter who calls it — and
// layer 2 sweeps `src/`. A dependency that opens a mic would need the header changed to work at
// all, which is the decision point this whole file routes through.
