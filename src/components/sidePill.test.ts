import { describe, expect, it } from 'vitest'
import { SIDE_PILL_H, SIDE_PILL_TALL_H, sidePillBottom } from './sidePill'

describe('side pill alignment', () => {
  it('uses ordinary CSS-pixel geometry with no zoom compensation', () => {
    expect(sidePillBottom()).toBe(
      'calc(13px + (var(--iw-toolbar-h, 56px) / 2) - 15.00px + var(--iw-pdf-room-bottom, 0px))',
    )
    expect(sidePillBottom(SIDE_PILL_H)).toBe(sidePillBottom())
    expect(sidePillBottom(SIDE_PILL_TALL_H)).toContain('- 21.00px')
  })
})
