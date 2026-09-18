import { describe, expect, it } from 'vitest'
import { enterCompletesUnit, paragraphEndsSentence, sentenceJustCompleted } from './sentenceEnd'

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

describe('enterCompletesUnit (Enter after a paragraph)', () => {
  it('sentence mode: sentence + newline completes', () => {
    expect(enterCompletesUnit('sentence', 'This is a sentence.')).toBe(true)
  })
  it('sentence mode: unpunctuated line + newline still completes', () => {
    expect(enterCompletesUnit('sentence', 'a line with no full stop')).toBe(true)
  })
  it('paragraph mode: any non-empty paragraph completes', () => {
    expect(enterCompletesUnit('paragraph', 'Short.')).toBe(true)
    expect(enterCompletesUnit('paragraph', 'no punctuation')).toBe(true)
  })
  it('a bare Enter on an empty or whitespace paragraph never completes', () => {
    expect(enterCompletesUnit('sentence', '')).toBe(false)
    expect(enterCompletesUnit('sentence', '   ')).toBe(false)
    expect(enterCompletesUnit('paragraph', '')).toBe(false)
  })
})
