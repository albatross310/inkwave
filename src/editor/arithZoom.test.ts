import { describe, it, expect } from 'vitest'
import { extractArithBlocks, exactBlockHeightAtZoom } from './arithZoom'
import type { Node as PMNode } from '@tiptap/pm/model'

// Duck-typed PM nodes matching the fields extractArithBlocks reads (type.name, forEach, text, marks).
const mark = (name: string, attrs?: Record<string, unknown>) => ({ type: { name }, attrs: attrs ?? {} })
const text = (t: string, marks: ReturnType<typeof mark>[] = []) => ({ type: { name: 'text' }, text: t, marks })
const atom = (name: string) => ({ type: { name }, marks: [] })
function block(typeName: string, children: unknown[] = []) {
  return { type: { name: typeName }, forEach: (cb: (c: unknown) => void) => children.forEach(cb) }
}
function doc(blocks: unknown[]): PMNode {
  return { forEach: (cb: (b: unknown) => void) => blocks.forEach(cb) } as unknown as PMNode
}

// A deterministic measure: every char is 10px wide at the run's font size / 18 (so scaling by zoom
// scales widths); ignores font family. Enough to exercise wrapping + height scaling.
const measure = (t: string, cssFont: string) => {
  const m = cssFont.match(/(\d+(?:\.\d+)?)px/)
  const size = m ? parseFloat(m[1]) : 18
  return t.length * 10 * (size / 18)
}
const loaded = () => true

describe('extractArithBlocks', () => {
  it('extracts plain text paragraphs as ELIGIBLE with correct runs', () => {
    const d = doc([block('paragraph', [text('hello world')])])
    const info = extractArithBlocks(d, 18)
    expect(info).toHaveLength(1)
    expect(info[0].eligible).toBe(true)
    expect(info[0].arith.runs[0]).toMatchObject({ text: 'hello world', fontSizePx: 18, fontWeight: 400, italic: false })
  })

  it('resolves bold/italic/fontFamily/fontSize marks', () => {
    const d = doc([block('paragraph', [
      text('a', [mark('bold')]),
      text('b', [mark('italic')]),
      text('c', [mark('textStyle', { fontFamily: "'Lora', serif", fontSize: '1.5em' })]),
    ])])
    const r = extractArithBlocks(d, 18)[0].arith.runs
    expect(r[0].fontWeight).toBe(700)
    expect(r[1].italic).toBe(true)
    expect(r[2].fontFamily).toBe("'Lora', serif")
    expect(r[2].fontSizePx).toBeCloseTo(27) // 1.5em × 18
  })

  it('DEFERS a paragraph containing a citation atom (no reflow-free box)', () => {
    const d = doc([block('paragraph', [text('see '), atom('citation')])])
    expect(extractArithBlocks(d, 18)[0].eligible).toBe(false)
  })

  it('DEFERS non-paragraph blocks (heading, list, mathBlock)', () => {
    const d = doc([block('heading', [text('Title')]), block('bulletList'), block('mathBlock')])
    const info = extractArithBlocks(d, 18)
    expect(info.every((b) => !b.eligible)).toBe(true)
  })

  it('DEFERS an uncertified font', () => {
    const d = doc([block('paragraph', [text('x', [mark('textStyle', { fontFamily: 'Comic Sans MS' })])])])
    expect(extractArithBlocks(d, 18)[0].eligible).toBe(false)
  })
})

describe('exactBlockHeightAtZoom', () => {
  const d = doc([block('paragraph', [text('one two three four five six seven eight nine ten')])])
  const info = extractArithBlocks(d, 18)[0]

  it('returns null for a deferred block', () => {
    const def = extractArithBlocks(doc([block('mathBlock')]), 18)[0]
    expect(exactBlockHeightAtZoom(def, 200, 1.618, 1, measure, loaded)).toBeNull()
  })

  it('height GROWS with zoom (bigger font → more wrapped lines / taller lines)', () => {
    const h1 = exactBlockHeightAtZoom(info, 200, 1.618, 1, measure, loaded)!
    const h2 = exactBlockHeightAtZoom(info, 200, 1.618, 2, measure, loaded)!
    expect(h1).toBeGreaterThan(0)
    expect(h2).toBeGreaterThan(h1) // zoom 2 is strictly taller than zoom 1
  })

  it('returns null when a face is not loaded (gate defers rather than mis-measure)', () => {
    expect(exactBlockHeightAtZoom(info, 200, 1.618, 1, measure, () => false)).toBeNull()
  })
})
