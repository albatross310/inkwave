import { describe, it, expect } from 'vitest'
import { addressToUrl, unwrapRedirect, mustUseReader, embeddableUrl, isPlayable, stripTracking, SEARCH_URL, GOOGLE_SEARCH_URL, LIVE_SEARCH_URL, ECOSIA_SEARCH_URL, searchUrlFor, isInkwaveItself, isSearch, queryOf, SEARCH_ENGINES, SEARCH_REFUSED, nextSearchEngine, searchLooksEmpty } from './address'
import { APP_INITIATORS } from './framingRule'

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

  it('WITH framing: the REAL duckduckgo.com, which renders in full inside a frame', () => {
    // ⚠ THE ENGINE DOES NOT FOLLOW THE CAPABILITY; THE ENDPOINT DOES. Framing google.com/search
    // works and Google then redirects ITSELF to /sorry/index — it declines to serve a search in a
    // frame, and no header we strip changes that. But MEASURED the same day: the real
    // duckduckgo.com framed renders 5,993 characters and 34 result links, i.e. a proper search
    // engine with its own styling rather than the bare html.duckduckgo.com transcript.
    expect(searchUrlFor(true)).toBe(LIVE_SEARCH_URL)
    expect(addressToUrl('metaphysics of identity', true)).toBe(`${LIVE_SEARCH_URL}metaphysics%20of%20identity`)
    // …and it is still recognised as a search, or `go` would not switch it into live view.
    expect(mustUseReader(`${LIVE_SEARCH_URL}x`, true)).toBe(false)
  })

  it('ECOSIA is refused on measurement, in both directions', () => {
    // Peter asked for it ("more sexy"). Measured: a server/extension fetch gets 403 (Cloudflare),
    // and FRAMED it renders "Just a moment…" — a challenge page, 147 characters, 0 links. The
    // constant is kept because the reasoning is worth keeping; no path may use it as an endpoint.
    expect(searchUrlFor(true)).not.toBe(ECOSIA_SEARCH_URL)
    expect(searchUrlFor(false)).not.toBe(ECOSIA_SEARCH_URL)
    expect(addressToUrl('metaphysics of identity', true)?.startsWith(ECOSIA_SEARCH_URL)).toBe(false)
    expect(addressToUrl('metaphysics of identity', false)?.startsWith(ECOSIA_SEARCH_URL)).toBe(false)
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


// ── INKWAVE MAY NOT OPEN INKWAVE (2026-08-30) ───────────────────────────────────────
// Peter loaded iwzero.me in the panel and got Chrome's broken-page icon — the app sends
// X-Frame-Options: DENY. That is NOT why this is refused: the extension strips that header, so
// without this check it would start working, and working means a second editor claiming the same
// document lock as the outer one. The tab would fight itself.
describe('isInkwaveItself', () => {
  it('recognises every origin the extension scopes its own rule to', () => {
    // The SAME list, imported — a private copy here is how a rename puts a guard quietly to sleep.
    expect(APP_INITIATORS.length).toBeGreaterThan(0)
    for (const d of APP_INITIATORS) {
      expect(isInkwaveItself(`https://${d}/`), d).toBe(true)
      expect(isInkwaveItself(`https://${d}/?doc=abc`), d).toBe(true)
      expect(isInkwaveItself(`https://www.${d}/entries/x`), d).toBe(true)   // subdomains too
    }
    expect(isInkwaveItself('http://localhost:5173/')).toBe(true)
  })
  it('DISCRIMINATES — an ordinary source is not us', () => {
    // Without this arm, "we refused something" says nothing about whether the check can tell.
    for (const u of [
      'https://plato.stanford.edu/entries/identity-time/',
      'https://en.wikipedia.org/wiki/Identity',
      'https://duckduckgo.com/?q=x',
      'https://notiwzero.me.example.com/',   // the substring trap
      'https://iwzero.me.evil.test/',        // …and its mirror image
    ]) expect(isInkwaveItself(u), u).toBe(false)
  })
  it('rubbish is not us either — it must never throw in front of the writer', () => {
    expect(isInkwaveItself('not a url')).toBe(false)
    expect(isInkwaveItself('')).toBe(false)
  })
})

// ── THE READER'S ENGINE MUST BE ONE OUR SERVER CAN REACH (2026-08-31) ────────────────────────────
// Peter reported "not searching anything" five times in one evening. The cause was not routing —
// which I kept fixing — but the DESTINATION: `html.duckduckgo.com` answers our deployed function
// with a 502 and zero blocks, so the reader path (the one that runs with NO extension) had never
// worked and could never have worked. It was a fallback to a wall.
//
// This is a guard against a plausible future edit, not against today's code: "put DuckDuckGo back,
// it's the better-known engine" is a reasonable-sounding change that silently restores a search box
// that returns nothing for anyone without the extension.
describe('the reader search endpoint is server-fetchable', () => {
  it('is NOT an endpoint measured to refuse our server', () => {
    // Each of these returned 502 / 0 blocks through the deployed /api/reader, same minute, same
    // query. They may be framed live (LIVE_SEARCH_URL is one), but they cannot be READ.
    for (const blocked of ['html.duckduckgo.com', 'lite.duckduckgo.com', 'mojeek.com']) {
      expect(SEARCH_URL).not.toContain(blocked)
    }
  })

  it('still RECOGNISES the old endpoint, so saved URLs keep behaving as searches', () => {
    // A writer's history and any stored address predate the change; `isSearch` drives the reader-only
    // rule and the search-specific error card, and losing that would degrade quietly.
    expect(isSearch('https://html.duckduckgo.com/html/?q=x')).toBe(true)
    expect(isSearch(SEARCH_URL + 'x')).toBe(true)
  })

  it('recovers the query from BOTH endpoints — they use different parameter names', () => {
    // marginalia uses ?query=, duckduckgo ?q=. The refused-search fallback re-issues the query, so
    // reading it back wrongly turns a failed search into an empty one.
    expect(queryOf(SEARCH_URL + encodeURIComponent('ship of theseus'))).toBe('ship of theseus')
    expect(queryOf('https://html.duckduckgo.com/html/?q=ship%20of%20theseus')).toBe('ship of theseus')
  })

  it('is reader-only, so it is never handed to the live frame', () => {
    expect(mustUseReader(SEARCH_URL + 'x')).toBe(true)
  })
})

// ── THE SEARCH CHAIN (2026-08-31) ────────────────────────────────────────────────────────────────
// One engine is measurably not enough: called four times in a row through the deployed /api/reader
// with a single query, old-search.marginalia.nu answered 170 / 170 / 3 / 3 blocks. A search box
// that is empty half the time is what Peter reported five separate times as "not searching
// anything", so the fix is a chain and these pin its shape.
describe('the search engine chain', () => {
  it('has more than one engine — a single one has been measured to fail intermittently', () => {
    expect(SEARCH_ENGINES.length).toBeGreaterThan(1)
  })

  it('contains none of the engines measured to refuse our server', () => {
    // These answered 502 or a challenge page through the deployed function. They may still be
    // FRAMED live (duckduckgo.com is), which is why this list is about reading, not about the site.
    for (const e of SEARCH_ENGINES) {
      for (const bad of SEARCH_REFUSED) expect(e.url).not.toContain(bad)
    }
  })

  it('walks forward and then stops — it must not cycle', () => {
    // A chain that wrapped would retry the first engine for ever on a genuinely empty query, which
    // is a loop the writer sees as a flickering panel.
    const first = SEARCH_ENGINES[0], last = SEARCH_ENGINES[SEARCH_ENGINES.length - 1]
    expect(nextSearchEngine(first.url + 'x')?.url).toBe(SEARCH_ENGINES[1].url)
    expect(nextSearchEngine(last.url + 'x')).toBeNull()
    expect(nextSearchEngine('https://example.com/not-a-search')).toBeNull()
  })

  it('every engine is recognised as a search, so the reader-only rule applies to all of them', () => {
    // If a later engine were not recognised, `mustUseReader` would let it into the live frame and
    // `queryOf` would not recover the query for the retry — the failure would look like the search
    // silently doing nothing, which is the bug being fixed.
    for (const e of SEARCH_ENGINES) {
      expect(isSearch(e.url + 'x')).toBe(true)
      expect(mustUseReader(e.url + 'x')).toBe(true)
      expect(queryOf(e.url + encodeURIComponent('ship of theseus'))).toBe('ship of theseus')
    }
  })

  it('"looks empty" counts LINKS, not blocks — a challenge page answers 200 with prose', () => {
    expect(searchLooksEmpty(0)).toBe(true)
    expect(searchLooksEmpty(2)).toBe(true)      // measured: marginalia's bad runs, and searx.be
    expect(searchLooksEmpty(66)).toBe(false)    // measured: searxng.site
    expect(searchLooksEmpty(90)).toBe(false)    // measured: marginalia's good runs
  })
})
