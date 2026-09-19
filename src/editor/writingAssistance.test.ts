import { describe, expect, it } from 'vitest'
import { EDITOR_WRITING_ASSISTANCE_ATTRIBUTES } from './writingAssistance'

describe('editor native writing assistance boundary', () => {
  it('prevents WebKit from painting predictive suffixes beyond the real caret', () => {
    expect(EDITOR_WRITING_ASSISTANCE_ATTRIBUTES).toEqual({
      spellcheck: 'false',
      autocomplete: 'off',
      autocorrect: 'off',
      writingsuggestions: 'false',
    })
  })
})
