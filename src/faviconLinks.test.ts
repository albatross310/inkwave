import { describe, expect, it } from 'vitest'
import { faviconLinks } from '../app/faviconLinks'

describe('favicon environment split', () => {
  it('uses only black-backed local assets in development', () => {
    const links = faviconLinks(true)
    expect(links).toHaveLength(5)
    expect(links.every((link) => link.href.startsWith('/fav-local-'))).toBe(true)
  })

  it('leaves every production favicon URL unchanged', () => {
    expect(faviconLinks(false).map((link) => link.href)).toEqual([
      '/fav-32.png?v=20',
      '/fav-16.png?v=20',
      '/fav-128.png?v=20',
      '/favicon.ico?v=20',
      '/favicon.ico?v=20',
    ])
  })
})
