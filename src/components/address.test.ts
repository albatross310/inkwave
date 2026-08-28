import { describe, it, expect } from 'vitest'
import { addressToUrl, unwrapRedirect, mustUseReader, embeddableUrl, isPlayable, SEARCH_URL } from './SourceBrowser'

describe('addressToUrl', () => {
  it('a URL is a URL', () => {
    expect(addressToUrl('https://plato.stanford.edu/entries/identity/')).toBe('https://plato.stanford.edu/entries/identity/')
    expect(addressToUrl('http://example.com')).toBe('http://example.com')
  })
  it('a bare host gets https', () => {
    expect(addressToUrl('plato.stanford.edu/entries/identity/')).toBe('https://plato.stanford.edu/entries/identity/')
    expect(addressToUrl('en.wikipedia.org')).toBe('https://en.wikipedia.org')
  })
  it('words are a SEARCH — a reader who types words expects to find something', () => {
    expect(addressToUrl('metaphysics of identity')).toBe(`${SEARCH_URL}metaphysics%20of%20identity`)
    expect(addressToUrl('wittgenstein')).toBe(`${SEARCH_URL}wittgenstein`)   // no dot ⇒ not a host
  })
  it('empty is nothing, not a search for nothing', () => {
    expect(addressToUrl('   ')).toBeNull()
  })
})

describe('unwrapRedirect', () => {
  it('unwraps a DuckDuckGo result so a click lands on the SITE', () => {
    // Every result on the HTML endpoint is wrapped; without this, following one lands on a
    // redirector the reader has nothing to extract from.
    const wrapped = 'https://duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FIdentity&rut=x'
    expect(unwrapRedirect(wrapped)).toBe('https://en.wikipedia.org/wiki/Identity')
  })
  it('leaves anything else exactly alone', () => {
    const u = 'https://plato.stanford.edu/entries/identity/'
    expect(unwrapRedirect(u)).toBe(u)
    expect(unwrapRedirect('not a url')).toBe('not a url')
  })
  it('refuses a non-http target hidden in the redirect', () => {
    const evil = 'https://duckduckgo.com/l/?uddg=javascript%3Aalert(1)'
    expect(unwrapRedirect(evil)).toBe(evil)   // unchanged ⇒ the caller's http(s) check still rejects it
  })
})

describe('mustUseReader', () => {
  it('MEASURED: no search engine can be framed, so searching must open the reader', () => {
    // google/duckduckgo/bing all send X-Frame-Options or frame-ancestors 'self' — checked directly.
    expect(mustUseReader('https://html.duckduckgo.com/html/?q=x')).toBe(true)
    expect(mustUseReader('https://www.google.com/search?q=x')).toBe(true)
    expect(mustUseReader('https://www.bing.com/search?q=x')).toBe(true)
  })
  it('an ordinary source is left to whichever mode the reader chose', () => {
    expect(mustUseReader('https://plato.stanford.edu/entries/identity/')).toBe(false)
    expect(mustUseReader('https://en.wikipedia.org/wiki/Identity')).toBe(false)
  })
})

describe('embeddableUrl', () => {
  // MEASURED: youtube.com/watch sends X-Frame-Options; youtube.com/embed and
  // youtube-nocookie.com/embed send NONE (checked directly, 200 with no framing header). That is
  // the whole reason a video can play here while youtube.com itself cannot be shown.
  it('a watch link becomes the player', () => {
    expect(embeddableUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'))
      .toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
  })
  it('short links, /shorts and /live too — every shape a YouTube link arrives in', () => {
    expect(embeddableUrl('https://youtu.be/dQw4w9WgXcQ')).toContain('/embed/dQw4w9WgXcQ')
    expect(embeddableUrl('https://www.youtube.com/shorts/abc123XYZ')).toContain('/embed/abc123XYZ')
    expect(embeddableUrl('https://www.youtube.com/live/abc123XYZ')).toContain('/embed/abc123XYZ')
  })
  it('keeps a start time', () => {
    expect(embeddableUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s')).toContain('?start=42')
  })
  it('vimeo gets its player', () => {
    expect(embeddableUrl('https://vimeo.com/76979871')).toBe('https://player.vimeo.com/video/76979871')
  })
  it('leaves an ordinary page completely alone', () => {
    const u = 'https://plato.stanford.edu/entries/identity/'
    expect(embeddableUrl(u)).toBe(u)
    expect(isPlayable(u)).toBe(false)
  })
  it('KNOWN-NEGATIVE: youtube.com itself is NOT playable — only a video is', () => {
    // The home page and the search results are top-level pages that refuse framing, and no rewrite
    // makes them embeddable. Claiming otherwise would be the overclaim.
    expect(isPlayable('https://www.youtube.com/')).toBe(false)
    expect(isPlayable('https://www.youtube.com/results?search_query=cats')).toBe(false)
    expect(embeddableUrl('https://www.youtube.com/')).toBe('https://www.youtube.com/')
  })
  it('a video is recognised as playable both before and after rewriting', () => {
    expect(isPlayable('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true)
    expect(isPlayable('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).toBe(true)
  })
})
