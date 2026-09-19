// The two rules that decide when a BAR ROW retracts, kept true by reading the source.
//
// Both are Peter's, both were got wrong once, and both fail SILENTLY — the bar simply is not there
// (or is), which looks like a design choice rather than a defect. Neither is reachable from a unit
// test of a pure function: they live in two document-level pointer handlers inside a 4,000-line
// component, so this scans the authored source the way `prodType.test.ts` and `cssBlocks.test.ts`
// already do in this repo.
//
//   1. REVIEW RETRACTS LIKE STYLE, EXCEPT IN SUGGESTION MODE. "Review is also broken, it needs to
//      be a bar like style with same behaviour" (2026-09-18). The exception is not a preference:
//      closing the row turns suggestion mode off (the ✎ toggle lives on the row and nowhere else),
//      and a writer in that mode clicks INTO the paper to use it — which is a tap-away. Unqualified
//      parity therefore switches the mode off at the moment it is about to be used.
//   2. A PICKER'S SCRIM IS PART OF THE PICKER. "Release outside closes only the popup and keeps the
//      style bar." The pickers portal to <body> behind a full-screen scrim, so EVERY click outside
//      one lands on the scrim; without the early return the same click retracted the whole bar.
//
// Comments are stripped before matching, so the paragraphs above can quote the identifiers the
// rules are about without satisfying their own checks.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const EDITOR = strip(readFileSync(resolve(__dirname, 'TiptapEditor.tsx'), 'utf8'))
const STYLEBAR = strip(readFileSync(resolve(__dirname, '../components/StyleBar.tsx'), 'utf8'))

describe('the review row retracts like style, except while suggestion mode is on', () => {
  it('every tap-away close of the review layer is gated on suggestion mode being off', () => {
    const closes = [...EDITOR.matchAll(/^.*closeBarLayer\('review'\).*$/gm)].map(m => m[0])
    expect(closes.length, 'no tap-away close of the review row at all — rule 1 is gone').toBeGreaterThan(0)
    for (const line of closes) {
      expect(line, `an ungated closeBarLayer('review'): ${line.trim()}`).toMatch(/!suggestOn\(\)/)
    }
  })

  it('closes on the same two handlers style does, so the two rows cannot drift apart', () => {
    // If style gains or loses a retract path, review must gain or lose it too — that is the whole
    // content of "same behaviour". Counting is enough: a third handler for one and not the other
    // is exactly the drift this catches.
    const styleCloses = [...EDITOR.matchAll(/closeBarLayer\('style'\)/g)].length
    const reviewCloses = [...EDITOR.matchAll(/closeBarLayer\('review'\)/g)].length
    expect(reviewCloses).toBe(styleCloses - 1) // style is also closed by the ▲ toggle; review is not
  })

  it('still turns suggestion mode off when the row does close (R4)', () => {
    expect(EDITOR).toMatch(/if \(!reviewOpen\) setSuggestOn\(false\)/)
  })

  it('the R trigger reports its state, as the style and music triggers do', () => {
    expect(EDITOR).toMatch(/data-iw-bar="review" aria-pressed=\{reviewOpen\}/)
  })
})

describe("a picker's scrim is part of the picker, not the outside", () => {
  it('every full-screen picker scrim carries the marker', () => {
    const scrims = [...STYLEBAR.matchAll(/className="fixed inset-0 z-\[98\]"/g)].length
    const marked = [...STYLEBAR.matchAll(/data-iw-stylescrim="" className="fixed inset-0 z-\[98\]"/g)].length
    expect(scrims, 'the pickers lost their scrims — this rule has nothing to guard').toBeGreaterThan(0)
    expect(marked, 'an unmarked scrim: clicking it retracts the whole style bar').toBe(scrims)
  })

  it('a scrim is never marked as the popup itself', () => {
    // StyleBar's release-outside rule reads `[data-iw-stylepop]` as "inside the popup". If a scrim
    // ever wore that attribute, releasing outside a picker would leave the picker open instead.
    expect(STYLEBAR).not.toMatch(/data-iw-stylepop[^>]*fixed inset-0 z-\[98\]/)
  })

  it('the editor returns on a scrim BEFORE it retracts any bar', () => {
    const guard = EDITOR.indexOf("t?.closest('[data-iw-stylescrim]')")
    const close = EDITOR.indexOf("closeBarLayer('style')")
    expect(guard, 'the scrim guard is gone — outside-clicks retract the bar again').toBeGreaterThan(-1)
    expect(guard).toBeLessThan(close)
  })
})
