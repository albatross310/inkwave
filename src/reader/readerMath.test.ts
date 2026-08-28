import { describe, it, expect } from 'vitest'
import { splitMath, hasMath } from './readerMath'

describe('splitMath', () => {
  it('pulls display maths out of prose — the SEP case, verbatim', () => {
    const src = 'Consider the property version of Leibniz’s Law. \\[\\tag{LL} \\forall x\\forall y[x=y \\rightarrow \\forall F(Fx \\rightarrow Fy)] \\] The relation of identity'
    const segs = splitMath(src)
    expect(segs.map((s) => s.kind)).toEqual(['text', 'math', 'text'])
    expect(segs[1].display).toBe(true)
    expect(segs[1].value).toContain('\\forall x\\forall y')
    expect(segs[2].value.trim()).toBe('The relation of identity')
  })

  it('handles inline \\( \\) and $$ $$', () => {
    expect(splitMath('a \\(x=y\\) b').map((s) => s.kind)).toEqual(['text', 'math', 'text'])
    expect(splitMath('a $$x=y$$ b')[1].display).toBe(true)
    expect(splitMath('a \\(x=y\\) b')[1].display).toBe(false)
  })

  it('REFUSES single $ — money is commoner than inline TeX', () => {
    // A mis-split here renders a whole sentence as a formula. "$5 to $10" must stay prose.
    const segs = splitMath('It cost $5 to $10 in 1990.')
    expect(segs.length).toBe(1)
    expect(segs[0].kind).toBe('text')
  })

  it('an UNBALANCED delimiter is prose about LaTeX, not LaTeX', () => {
    const segs = splitMath('The \\[ notation is used for display maths.')
    expect(segs.map((s) => s.kind)).toEqual(['text'])
  })

  it('empty delimiters are left alone', () => {
    expect(splitMath('a \\[\\] b').map((s) => s.kind)).toEqual(['text'])
  })

  it('several formulas in one block', () => {
    const segs = splitMath('\\(a\\) then \\(b\\) then \\(c\\)')
    expect(segs.filter((s) => s.kind === 'math').map((s) => s.value)).toEqual(['a', 'b', 'c'])
  })

  it('conserves every character of the original', () => {
    // Nothing may be dropped: a formula that vanishes takes an argument's key step with it.
    const src = 'before \\[x = y\\] middle \\(p \\land q\\) after'
    const back = splitMath(src).map((s) => (s.kind === 'text' ? s.value : '')).join('')
    expect(back).toBe('before  middle  after')
    expect(splitMath(src).filter((s) => s.kind === 'math').length).toBe(2)
  })

  it('hasMath is a cheap gate that agrees with the splitter', () => {
    expect(hasMath('plain prose')).toBe(false)
    expect(hasMath('a \\[x\\] b')).toBe(true)
    expect(hasMath('$5 only')).toBe(false)
  })
})
