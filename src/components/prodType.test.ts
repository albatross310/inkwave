// THE iOS ZOOM TRAP, AS A GUARD (Peter, 2026-07-17 — "every font proportionally up").
//
// ─── WHY THIS TEST EXISTS — AND WHAT IS ACTUALLY TRUE ────────────────────────────────────────
// iOS Safari zooms the page into ANY focused text control whose computed font is under 16px, and
// STAYS zoomed after blur. Three panels shipped 13px inputs (`GoalsSection`, `ReflectionPrompt`,
// `ClockMenu`) and the received story was that Peter's iPhone was lurching mid-sentence because of it.
//
// THAT STORY IS FALSE, and it was worth measuring before writing a guard against it.
// `scripts/cssfloor.prove.mjs` loads the REAL built stylesheet in a REAL engine under iPhone 12
// emulation: index.css's `input, select, textarea { font-size: max(16px, 1em) !important }` (inside
// `@media (pointer: coarse) and (hover: none)`) computes those 13px inputs to 16px. Tailwind's
// `@layer base` is a build-time directive, not a native cascade layer — the built CSS has zero
// `@layer` — so that !important is plain author-important and outranks a normal inline style. The
// probe's known-negative fires: the same input on desktop stays 13px. The trap was BACKSTOPPED.
//
// So this guard is NOT "stop the phone zooming" — that was already handled, invisibly. It is:
//  1. The backstop is phone-ONLY. A coarse device the media query misses gets the authored size.
//  2. The authored size should BE the shipped size. A component whose 13px is silently rewritten by
//     a distant stylesheet on one device class is a number nobody can reason about at the call site.
//  3. Peter asked for the whole panel bigger regardless; the floor is the ramp's floor.
// Guarding the AUTHORED value is the point, which is also why it reads source and not a rendering.
//
// ─── WHAT IT READS, AND WHY NOT jsdom ───────────────────────────────────────────────────────
// It reads the SOURCE FILES FROM DISK and resolves them against the REAL `TYPE` object — the same
// shape as `music/theme.test.ts`, and for the same reason recorded there: jsdom does not resolve
// custom properties or stylesheet rules, so a test that mounted these panels and asked
// `getComputedStyle(input).fontSize` would report jsdom's 16px default and pass no matter what the
// component authored. That is this house's disease — an instrument that cannot report its own
// failure. The authored value is the thing under test, so the authored value is what gets read.
//
// It does NOT re-type the numbers. `TYPE` is imported and the floor is DERIVED from it
// (`Math.min(...Object.values(TYPE))`), so if someone lowers a step in `typeScale.ts` this test
// fails there rather than quietly certifying a smaller ramp. A hard-coded `expect(20)` here would
// be a second copy of the scale — the exact fork the ramp exists to prevent.
//
// ─── WHAT IT DOES NOT PROVE ──────────────────────────────────────────────────────────────────
// That iOS actually stops zooming. That needs Peter's phone. What it proves is the CONDITION iOS
// documents (computed font ≥16px on a focusable text control) holds for every control these panels
// author — and, separately, that the CSS backstop agrees with the ramp.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TYPE } from '../music/typeScale'

/** The productivity panels. Every one renders inside, or beside, the clock drop-up. */
const PANELS = ['ClockMenu.tsx', 'GoalsSection.tsx', 'ReflectionPrompt.tsx'] as const

/**
 * The floor iOS imposes. NOT a constant of this repo's choosing — it is Safari's behaviour — so it
 * is written here as the literal it is, and the RAMP is then checked against it below. This is the
 * one number in this file that is allowed to be literal, because it is not ours.
 */
const IOS_ZOOM_FLOOR = 16

const sourceOf = (f: string): string => readFileSync(resolve(__dirname, f), 'utf8')

/**
 * Controls iOS zooms into: the ones you can type in. A checkbox/radio/button renders no text and
 * takes no keyboard, so the rule does not bind it — exempting them is honest, not a loophole. (Their
 * TAP-target size is a different rule, guarded by TOUCH_MIN at the call sites.)
 */
const EXEMPT_TYPES = /type=["'](checkbox|radio|button|submit|reset|range|color|hidden|file)["']/

type Control = { tag: string; file: string; line: number; text: string }

/**
 * Pull every form-control JSX element out of a source file.
 *
 * Walks the tag tracking BRACE DEPTH, and ends it at the first `>` seen at depth 0.
 *
 * The naive version — scan to the first `>` — was written first and this suite caught it: an
 * `onChange={(e) => setNote(…)}` handler contains a bare `>` in its ARROW, so the tag was cut off at
 * the arrow and a textarea that plainly authored `fontSize: TYPE.body` was reported as authoring
 * none. Scanning to the first `/>` instead fails the other way (it runs past a `<textarea …>` that
 * closes with a plain `>` and swallows the next element whole). Depth tracking is what actually
 * distinguishes them: a `>` inside `{…}` is expression syntax, a `>` at depth 0 ends the tag.
 */
function controlsIn(file: string): Control[] {
  const src = sourceOf(file)
  const out: Control[] = []
  const re = /<(input|textarea|select)\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    let depth = 0
    let stop = m.index
    for (let i = m.index; i < src.length; i++) {
      const ch = src[i]
      if (ch === '{') depth++
      else if (ch === '}') depth--
      else if (ch === '>' && depth === 0) { stop = i + 1; break }
    }
    out.push({
      tag: m[1],
      file,
      line: src.slice(0, m.index).split('\n').length,
      text: src.slice(m.index, stop),
    })
  }
  return out
}

/** The authored `fontSize:` on an element, as written. `null` when it authors none. */
function fontSizeExpr(text: string): string | null {
  const m = /fontSize:\s*([^,}\n]+)/.exec(text)
  return m ? m[1].trim() : null
}

/** Resolve `TYPE.body` → 20 against the REAL ramp. Bare numbers resolve to themselves. */
function resolveSize(expr: string): number | null {
  const step = /^TYPE\.(\w+)$/.exec(expr)
  if (step) return (TYPE as Record<string, number>)[step[1]] ?? null
  const n = /^(\d+(?:\.\d+)?)(?:px)?$/.exec(expr)
  return n ? Number(n[1]) : null
}

const typedControls = (): Control[] =>
  PANELS.flatMap(controlsIn).filter((c) => !EXEMPT_TYPES.test(c.text))

describe('the ramp itself clears the floor iOS imposes', () => {
  it('has no step below 16px — the trap is unreachable by construction', () => {
    // The ramp's own promise ("Every step here is ≥16, so the iOS trap is unreachable by
    // construction"). If a step ever drops, EVERY panel using it becomes a trap at once, so the
    // failure belongs here — at the source — and not scattered across ten call sites.
    for (const [step, px] of Object.entries(TYPE)) {
      expect(px, `TYPE.${step} is below the iOS zoom floor`).toBeGreaterThanOrEqual(IOS_ZOOM_FLOOR)
    }
  })
})

describe('every typed control in the productivity panels clears 16px', () => {
  it('finds every control (the scanner is not silently matching nothing)', () => {
    // Without this, every assertion below could pass by iterating an empty list — the vacuous-guard
    // failure this repo has already been bitten by. These counts are deliberately brittle: adding a
    // control should make you look at this file.
    expect(controlsIn('ClockMenu.tsx').map((c) => c.tag)).toEqual(['textarea', 'textarea', 'input', 'input'])
    // GoalsSection leads with the overarching-goal textarea (setGoal), then the add-milestone
    // text+date inputs, the rough-plan textarea, and the GoalRow edit text+date inputs.
    expect(controlsIn('GoalsSection.tsx').map((c) => c.tag)).toEqual(['textarea', 'input', 'input', 'textarea', 'input', 'input'])
    expect(controlsIn('ReflectionPrompt.tsx').map((c) => c.tag)).toEqual(['input'])
    // One checkbox is exempt; everything else is a typed control and must be checked.
    expect(typedControls()).toHaveLength(10)
  })

  it('authors a fontSize on every typed control', () => {
    // An input with NO authored fontSize inherits — and what it inherits is not knowable from here.
    // On phone `index.css` would still floor it, but a control whose size depends on a media query
    // holding is not one you can reason about; the panels author it explicitly.
    for (const c of typedControls()) {
      expect(fontSizeExpr(c.text), `${c.file}:${c.line} <${c.tag}> authors no fontSize`).toBeTruthy()
    }
  })

  it('sizes every typed control from the shared ramp, never a bare number', () => {
    // The stronger property, and the one that actually keeps this true: `fontSize: 16` would pass
    // the floor check below while being a second scale in disguise. Only `TYPE.<step>` is allowed.
    for (const c of typedControls()) {
      const expr = fontSizeExpr(c.text) ?? ''
      expect(expr, `${c.file}:${c.line} <${c.tag}> must size from TYPE, not "${expr}"`).toMatch(/^TYPE\.\w+$/)
    }
  })

  it('resolves every typed control to ≥16px against the real ramp', () => {
    // THE HEADLINE. Resolved through the imported TYPE, so it reads what ships.
    for (const c of typedControls()) {
      const expr = fontSizeExpr(c.text) ?? ''
      const px = resolveSize(expr)
      expect(px, `${c.file}:${c.line} <${c.tag}> has an unresolvable fontSize "${expr}"`).not.toBeNull()
      expect(px, `${c.file}:${c.line} <${c.tag}> is ${px}px — iOS will zoom and STAY zoomed`)
        .toBeGreaterThanOrEqual(IOS_ZOOM_FLOOR)
    }
  })

  it('carries no Tailwind text-* class on a typed control (the old vocabulary is gone)', () => {
    // How both real bugs were authored: `className="… text-[13px]"`. A `text-*` class alongside an
    // inline fontSize also silently loses to it, so this keeps one vocabulary rather than two.
    for (const c of typedControls()) {
      expect(c.text, `${c.file}:${c.line} <${c.tag}> still carries a text-* size class`)
        .not.toMatch(/className=[^>]*\btext-(xs|sm|base|lg|\[\d)/)
    }
  })

  it('PROVES the scanner and the resolver can FAIL (the known-negative fires)', () => {
    // A guard nobody has watched fail is archaeology, not a guard. Every mechanism this suite
    // depends on is shown catching a synthetic mutant of the exact bug it is for.
    const mutant = `<input value={x} className="w-full text-[13px]" style={{ fontSize: 13 }} />`
    expect(fontSizeExpr(mutant)).toBe('13')
    expect(resolveSize('13')).toBe(13)
    expect(resolveSize('13')! >= IOS_ZOOM_FLOOR).toBe(false)     // the floor check would fail
    expect(/^TYPE\.\w+$/.test('13')).toBe(false)                  // the ramp check would fail
    expect(mutant).toMatch(/className=[^>]*\btext-(xs|sm|base|lg|\[\d)/) // the class check would fail
    // And the resolver really is reading the ramp, not echoing a literal back.
    expect(resolveSize('TYPE.body')).toBe(TYPE.body)
    expect(resolveSize('TYPE.not_a_step')).toBeNull()
  })
})

describe('index.css — the phone backstop agrees with the ramp (derived, not copied)', () => {
  // `index.css` floors every form control at 16px inside `@media (pointer: coarse) and (hover: none)`
  // with an `!important` that beats a component's inline style — MEASURED, not assumed
  // (`scripts/cssfloor.prove.mjs`). So the panels have BELT AND BRACES on phone.
  //
  // But that 16 is a SECOND COPY of the ramp's floor, stated in another language — the same shape as
  // the toolbar's phone circles hard-coding 8 slots. It is not deleted: it is the only thing covering
  // form controls in files this test does not read. It is TIED to the ramp instead, so the two
  // statements of one rule cannot drift apart silently.
  const css = readFileSync(resolve(__dirname, '../styles/index.css'), 'utf8')

  /** The rule's VALUE, with `!important` stripped — that flag is asserted separately below. */
  const floorRule = (): string | null => {
    const m = /input,\s*select,\s*textarea\s*\{\s*font-size:\s*([^;]+);/.exec(css)
    return m ? m[1].replace(/!important/, '').trim() : null
  }

  it('still has the phone floor rule', () => {
    expect(floorRule(), 'the phone form-control floor vanished from index.css').toBeTruthy()
  })

  it('floors at exactly the ramp\'s smallest step', () => {
    // DERIVED: the CSS says `max(16px, 1em)`; 16 must be the bottom of the ramp, not a coincidence.
    // If someone raises TYPE.meta to 18 and leaves the CSS at 16, that is a real (if benign) drift
    // between two statements of one rule, and it should be noticed here.
    const rampFloor = Math.min(...Object.values(TYPE))
    expect(floorRule()).toBe(`max(${rampFloor}px, 1em)`)
  })

  it('scopes the floor to phone — and PROVES the probe reads the real rule', () => {
    // The rule only helps where the media query holds. Stated as a test so nobody mistakes it for a
    // universal guarantee and stops authoring sizes in the components.
    expect(css).toMatch(/@media \(pointer: coarse\) and \(hover: none\)/)
    expect(/input,\s*select,\s*textarea\s*\{[^}]*!important/.test(css)).toBe(true)
    // The known-negative: the probe misses a rule that is not there.
    expect(/output,\s*meter\s*\{\s*font-size:\s*([^;]+);/.exec(css)).toBeNull()
  })
})
