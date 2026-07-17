// THE BAR-LABEL COERCION GUARD — a keeper for a bug that was live and will come back.
//
// `LessonPanel` used to do `Number(bar)` on the value a teacher types and gate on
// `Number.isFinite(barNum) && barNum > 0`. That SILENTLY DROPPED the anchor for the two bar numbers
// a real score is most likely to have: '8a' (a repeat ending) → NaN → no anchor, and '0' (a pickup)
// → not > 0 → no anchor. The note attached to nothing, with no error anywhere.
//
// WHY THIS FILE EXISTS AT ALL (CLAUDE.md's headline: a green gate is not a guard). The fix lives in
// a UI event handler, so nothing in the gate could feel it — the bug was found by reading, and a
// proof that ran once is indistinguishable six weeks later from one that never ran. `Number(x)` on a
// bar number is exactly the "tidy-up" a future reader makes in good faith, because '24' looks like a
// number. This is the cheap thing that stops it: no browser, no jsdom, ~1ms.
//
// It tests the RULE, not the component. `barAnchorFromInput` is the extracted decision — the panel
// calls it, so a regression in the panel is a regression here. Testing it through a rendered
// component would need jsdom + a mocked session and would still only prove the same rule.

import { describe, expect, it } from 'vitest'
import { barAnchorFromInput } from './LessonPanel'

describe('what a teacher types is a LABEL, never a number', () => {
  it('keeps an ordinary bar number verbatim, as a string', () => {
    expect(barAnchorFromInput('24')).toEqual({ kind: 'bar', bar_label: '24' })
  })

  // ─── THE TWO THE OLD RULE DROPPED ──────────────────────────────────────────
  // These are the regression. Both were live, both were silent, and both are ordinary engraving.

  it('a repeat ending ("8a") anchors — Number() made it NaN and the note attached to nothing', () => {
    expect(barAnchorFromInput('8a')).toEqual({ kind: 'bar', bar_label: '8a' })
  })

  it('a pickup bar ("0") anchors — the old `> 0` gate silently discarded it', () => {
    expect(barAnchorFromInput('0')).toEqual({ kind: 'bar', bar_label: '0' })
  })

  it('never emits bar_index — a photo Piece mid-lesson has no bar model to resolve against', () => {
    // BarRef's rule: carry what you know, resolve later, never fabricate the key. Emitting an
    // ordinal here would invent the join key from a printed label that MusicXML says is ambiguous.
    for (const input of ['24', '8a', '0', '1']) {
      expect(barAnchorFromInput(input)).not.toHaveProperty('bar_index')
    }
  })

  it('an empty or blank box means no anchor — a note about the lesson, not about a bar', () => {
    expect(barAnchorFromInput('')).toBeUndefined()
    expect(barAnchorFromInput('   ')).toBeUndefined()
  })

  it('trims, because a trailing space is a typo and not a different bar', () => {
    expect(barAnchorFromInput('  24 ')).toEqual({ kind: 'bar', bar_label: '24' })
  })
})
