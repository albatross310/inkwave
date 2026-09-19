import { describe, expect, it } from 'vitest'
import { FONT_PRELOAD } from '../app/fontPreload'

describe('critical font preload budget', () => {
  it('preloads only the default EB Garamond Latin face', () => {
    expect(FONT_PRELOAD).toEqual(['/fonts/eb-garamond-400-normal-131.woff2'])
  })
})
