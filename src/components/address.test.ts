import { describe, it, expect } from 'vitest'
import { addressToUrl, unwrapRedirect, mustUseReader, embeddableUrl, isPlayable, stripTracking, SEARCH_URL, GOOGLE_SEARCH_URL, searchUrlFor } from './SourceBrowser'

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

describe('stripTracking', () => {
  it('drops the campaign tag a link arrived with', () => {
    // Peter saw `?utm_source=chatgpt.com` in the address bar — added by whoever gave him the link.
    expect(stripTracking('https://plato.sydney.edu.au/entries/identity-time/?utm_source=chatgpt.com'))
      .toBe('https://plato.sydney.edu.au/entries/identity-time/')
    expect(stripTracking('https://x.com/a?fbclid=123&gclid=456')).toBe('https://x.com/a')
  })
  it('keeps parameters the page actually needs', () => {
    // A search query, an article id, a page number — stripping these would break the link.
    expect(stripTracking('https://html.duckduckgo.com/html/?q=identity')).toBe('https://html.duckduckgo.com/html/?q=identity')
    expect(stripTracking('https://example.com/a?id=7&page=3')).toBe('https://example.com/a?id=7&page=3')
  })
  it('leaves a clean URL byte-identical, and never throws on rubbish', () => {
    const u = 'https://plato.stanford.edu/entries/identity/'
    expect(stripTracking(u)).toBe(u)
    expect(stripTracking('not a url')).toBe('not a url')
  })
})

// ── SEARCH TAKES THE PATH THAT CAN ACTUALLY SERVE IT (2026-08-30) ────────────────────────────────
// Peter asked for Google. The reason it was refused before was measured — its results are
// JavaScript-rendered, so a server fetch returns one block and "click here" — and half of that
// reasoning stopped being true when the extension shipped: an extension strips X-Frame-Options, so
// Google can run its own JavaScript inside the live frame. The choice is therefore a function of
// the CAPABILITY, and these tests exist so a later edit cannot quietly collapse it back to one
// engine and reintroduce either the empty page or the refusal.
describe('search endpoint follows the capability', () => {
  it('without framing: DuckDuckGo, which a server fetch can actually read', () => {
    expect(searchUrlFor(false)).toBe(SEARCH_URL)
    expect(addressToUrl('metaphysics of identity', false)).toBe(`${SEARCH_URL}metaphysics%20of%20identity`)
  })

  it('WITH framing: still DuckDuckGo — Google answers a framed search with a CAPTCHA', () => {
    // ⚠ MEASURED, and it reverses the same day's earlier change. Framing google.com/search works —
    // and Google then redirects ITSELF to /sorry/index. It declines to serve a search in a frame;
    // no header we strip changes that. So the engine must not follow the capability even though
    // the MODE does.
    expect(searchUrlFor(true)).toBe(SEARCH_URL)
    expect(addressToUrl('metaphysics of identity', true)).toBe(`${SEARCH_URL}metaphysics%20of%20identity`)
  })

  it('GOOGLE_SEARCH_URL is not used as a search endpoint by any path', () => {
    // Kept as a named constant (isSearch and the copy both reason about Google), but a regression
    // that quietly re-points search at it would show up here rather than as a CAPTCHA on Peter's
    // screen — which is exactly how this was found.
    expect(searchUrlFor(true)).not.toBe(GOOGLE_SEARCH_URL)
    expect(searchUrlFor(false)).not.toBe(GOOGLE_SEARCH_URL)
  })

  it('an engine is reader-only ONLY while we cannot frame it', () => {
    expect(mustUseReader('https://www.google.com/search?q=x')).toBe(true)          // no extension
    expect(mustUseReader('https://www.google.com/search?q=x', false)).toBe(true)
    expect(mustUseReader('https://www.google.com/search?q=x', true)).toBe(false)   // extension
    // An ordinary page is never reader-only either way — the flag must not become a mode switch.
    expect(mustUseReader('https://plato.stanford.edu/entries/identity/', true)).toBe(false)
    expect(mustUseReader('https://plato.stanford.edu/entries/identity/', false)).toBe(false)
  })

  it('defaults to the conservative answer, so an un-updated caller cannot get an empty page', () => {
    // Every pre-existing call site passes one argument. If the default were `true`, they would all
    // silently start sending Google into a reader that cannot render it.
    expect(addressToUrl('wittgenstein')).toBe(`${SEARCH_URL}wittgenstein`)
    expect(mustUseReader('https://duckduckgo.com/?q=x')).toBe(true)
  })
})
