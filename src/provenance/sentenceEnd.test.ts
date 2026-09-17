import { describe, expect, it } from 'vitest'
import { paragraphEndsSentence, sentenceJustCompleted } from './sentenceEnd'

describe('sentenceJustCompleted', () => {
  it('fires on a space after a full stop', () => {
    expect(sentenceJustCompleted('Hello world. ', ' ')).toBe(true)
  })
  it('fires on ! and ?', () => {
    expect(sentenceJustCompleted('Really! ', ' ')).toBe(true)
    expect(sentenceJustCompleted('Really?\n', '\n')).toBe(true)
  })
  it('allows a closing quote or bracket after the terminator', () => {
    expect(sentenceJustCompleted('He said "no." ', ' ')).toBe(true)
    expect(sentenceJustCompleted('(see above.) ', ' ')).toBe(true)
  })
  it('does not fire on the terminator itself', () => {
    expect(sentenceJustCompleted('Hello world.', '.')).toBe(false)
  })
  it('does not fire on a space mid-sentence', () => {
    expect(sentenceJustCompleted('Hello world ', ' ')).toBe(false)
    expect(sentenceJustCompleted('Hello, ', ' ')).toBe(false)
  })
  it('does not fire when the insert is not whitespace', () => {
    expect(sentenceJustCompleted('Hello world. A', 'A')).toBe(false)
  })
  it('does not fire on an empty insert', () => {
    expect(sentenceJustCompleted('Hello.', '')).toBe(false)
  })
})

describe('paragraphEndsSentence', () => {
  it('is true for a terminated paragraph, ignoring trailing spaces', () => {
    expect(paragraphEndsSentence('Done.  ')).toBe(true)
    expect(paragraphEndsSentence('Done?')).toBe(true)
  })
  it('is false for an unterminated paragraph or empty text', () => {
    expect(paragraphEndsSentence('Not yet')).toBe(false)
    expect(paragraphEndsSentence('')).toBe(false)
  })
})
