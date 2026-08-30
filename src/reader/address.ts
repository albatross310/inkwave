import { APP_INITIATORS } from './framingRule'

// THE ADDRESS LAYER — what a typed string means, and which mode can serve it.
//
// Pure functions over URLs: no React, no DOM, no fetch, no module state. They were declared inside
// `SourceBrowser.tsx` and exported from it, and `components/address.test.ts` — 28 tests — already
// imported them from there, so the module boundary this file draws was one the tests had assumed
// for some time without it existing.
//
// Keeping them here rather than in the component matters for one reason beyond tidiness: these
// rules decide whether a search becomes Google-in-a-frame or DuckDuckGo-in-the-reader, and that
// decision is read from THREE places in the panel (the address bar, `go()`, and the framing
// effect). A second copy of it is how the address bar and the navigator start disagreeing about
// what the same string means — which is why `canFrameRef` exists in the component. One definition,
// three readers.


// ⚠ SEARCH TAKES WHICHEVER PATH ACTUALLY WORKS, AND THAT NOW DEPENDS ON THE EXTENSION.
// Peter asked for Google twice — "effectively search google", then again on 2026-08-30. The reason
// it was refused before is MEASURED and half of it has since stopped being true:
//   • READING: google.com/search fetched server-side returns ONE block and the words "click here" —
//     its results are JavaScript-rendered, so there is nothing to extract. STILL TRUE, and no
//     extension changes it: fetching from the writer's own address changes WHO ASKS, not what comes
//     back. Google can never be READ here.
//   • FRAMING: every engine sends X-Frame-Options or frame-ancestors 'self'. The old note said this
//     was "not something any code here can change" — and that was right for a web page and WRONG
//     once the extension shipped (2026-08-30), because an extension strips those headers before the
//     browser reads them. PROVED headed, `pnpm prove:framing`: REFUSED → framed.
// So the rule is not "Google or DuckDuckGo", it is "which mode can serve a search at all":
//   with framing  → GOOGLE, in the LIVE frame, where its own JavaScript runs and it is really Google.
//   without       → DuckDuckGo's no-JS HTML endpoint, in the READER, which returns 31 blocks and
//                   123 real result links against a server fetch.
// Falling back rather than failing matters: without the extension, Google in a frame is a refusal
// and Google in the reader is an empty page, so a writer who has not installed it must still get
// results rather than a worse version of the same wall.
export const GOOGLE_SEARCH_URL = 'https://www.google.com/search?q='
// ⚠ THE READER'S SEARCH ENGINE IS THE ONE OUR SERVER CAN ACTUALLY REACH (2026-08-31).
// It was html.duckduckgo.com, and Peter reported "not searching anything" five times in one
// evening. Measured through the DEPLOYED /api/reader, same query, same minute:
//     html.duckduckgo.com   502  0 blocks      lite.duckduckgo.com  502  0 blocks
//     www.mojeek.com        502  0 blocks      search.marginalia.nu 200  119 blocks / 69 links
// Search engines refuse a data centre and serve a person. So the READER path — the one that runs
// with no extension installed — had never worked and could never have worked; it was a fallback to
// a wall. Every "it's broken" was that, and I kept fixing the routing that led to it instead of the
// destination.
//
// Marginalia is not a compromise for this app: it deliberately indexes non-commercial, long-form,
// text-heavy pages. Measured on "identity over time philosophy" it returns the SEP entry, a
// philosophy department's event page and a course's lecture notes — which is what an honours
// student is looking for, and closer to it than a commercial engine's first page.
//
// LIVE_SEARCH_URL is the real duckduckgo.com, used only where the extension can frame it (34
// result links, its own styling). Two endpoints because they answer two different questions:
// "what can a server fetch and read" and "what can this browser display".
// ⚠ A CHAIN, NOT AN ENGINE — because a single one is measurably not enough. Called four times in a
// row through the deployed /api/reader with one query, old-search.marginalia.nu answered
// 170 / 170 / 3 / 3 blocks: it works and then intermittently returns nothing. A search box that is
// empty half the time is what Peter reported five times as "not searching anything", and pinning
// one engine — however well it scored once — reproduces that.
//
// Each entry was MEASURED through the deployed function, same query, same minute. The ones that
// answer a data centre with 502 or a challenge page are recorded in SEARCH_REFUSED below so nobody
// re-adds them from memory.
export interface SearchEngine { readonly name: string; readonly url: string }
export const SEARCH_ENGINES: readonly SearchEngine[] = [
  // 170 blocks / 90 linked at best. Indexes non-commercial long-form pages, which is why it returns
  // the SEP entry and a course's lecture notes for a philosophy query rather than a shop.
  { name: 'Marginalia', url: 'https://old-search.marginalia.nu/search?query=' },
  // 104 / 66, and steady across the runs where marginalia collapsed to 3.
  { name: 'SearXNG',    url: 'https://searxng.site/search?q=' },
]

/** Measured to refuse OUR SERVER — 502, or a challenge page with no results. Not a blocklist for
 *  the live frame (duckduckgo.com frames beautifully); a list of what a server cannot READ. */
export const SEARCH_REFUSED = [
  'html.duckduckgo.com', 'lite.duckduckgo.com', 'mojeek.com', 'search.brave.com', 'startpage.com',
] as const

export const SEARCH_URL = SEARCH_ENGINES[0].url

/** The next engine to try after `url` failed to produce results, or null when the chain is spent. */
export function nextSearchEngine(url: string): SearchEngine | null {
  const i = SEARCH_ENGINES.findIndex((e) => url.startsWith(e.url))
  if (i < 0 || i + 1 >= SEARCH_ENGINES.length) return null
  return SEARCH_ENGINES[i + 1]
}

/** Did a search actually return results? An engine that answers 200 with a challenge page is the
 *  case this exists for — it is not an error, and only counting real links can tell them apart. */
export function searchLooksEmpty(linkedBlocks: number): boolean {
  return linkedBlocks < 5
}
export const LEGACY_DDG_SEARCH = 'https://html.duckduckgo.com/html/?q='   // kept: `isSearch` must
                                                                          // still recognise old URLs
/** The REAL DuckDuckGo — its own styling, its own JavaScript. Only reachable with framing. */
export const LIVE_SEARCH_URL = 'https://duckduckgo.com/?q='
/**
 * ⚠ ECOSIA WAS ASKED FOR AND IS REFUSED ON MEASUREMENT (Peter, 2026-08-30: "lets use ecosia instead
 * of duckduckgo. its more sexy"). It is a reasonable-sounding idea, so record why it cannot work or
 * the next reader will try it again. Measured both paths, headed, with the shipped framing rule:
 *   • READ (server or extension fetch): **403**, 2 blocks, 0 links — Cloudflare refuses the fetch.
 *   • FRAMED, with the extension stripping the framing headers: it frames, and then renders
 *     **"Just a moment…"** — a Cloudflare interstitial. 147 characters, 0 result links.
 * Shipping it would put a challenge page where the results go. It is not a header we can strip and
 * not a path an extension changes: Cloudflare is judging the CLIENT, and we are not one it trusts.
 */
export const ECOSIA_SEARCH_URL = 'https://www.ecosia.org/search?q='

/**
 * The endpoint a typed query becomes.
 *
 * ⚠ IT IS DuckDuckGo EITHER WAY, AND THAT REVERSES A CHANGE MADE HOURS EARLIER THE SAME DAY.
 * When framing started working I switched search to Google on the reasoning that the live frame is
 * where its JavaScript runs. The reasoning was sound and the CONCLUSION WAS WRONG, because I never
 * measured GOOGLE framed — only that framing worked in general. Measured now, with the shipped rule
 * and a live canary: google.com/search frames successfully and then REDIRECTS ITSELF to
 * /sorry/index, its anti-abuse page. Peter hit it immediately ("google search aren't [working]").
 * Google declines to serve a search inside a frame; that is its policy, not a header we can strip.
 *
 * DuckDuckGo's no-JS endpoint returns 31 blocks and real result links to a plain fetch, so it works
 * WITH the extension and without it. `canFrame` is kept in the signature because it still decides
 * the MODE — a search we can frame no longer has to force reader view — but it must not choose an
 * engine that answers with a CAPTCHA.
 *
 * ⚠ IT IS NOW DuckDuckGo TWICE OVER, BUT NOT THE SAME ENDPOINT (2026-08-30). Peter asked for Ecosia
 * ("more sexy") and it is refused above on measurement — but the same measuring run found the
 * answer he actually wanted: with framing, **the real `duckduckgo.com` frames and renders in full**
 * (5,993 characters, 34 result links), which is a proper search engine with its own styling rather
 * than the bare `html.duckduckgo.com` transcript. So the ENGINE does not follow the capability —
 * Google still cannot serve a framed search — but the ENDPOINT does: the pretty one where it works,
 * the plain one a server fetch can read where it does not.
 */
export function searchUrlFor(canFrame: boolean): string {
  return canFrame ? LIVE_SEARCH_URL : SEARCH_URL
}

/**
 * ⚠ INKWAVE MAY NOT OPEN INKWAVE (2026-08-30 — Peter loaded `https://iwzero.me` in the panel).
 *
 * Today it shows the browser's broken-page icon, because the app sends `x-frame-options: DENY` and
 * `frame-ancestors 'none'`. That is not what makes this a refusal: the extension's rule STRIPS both,
 * so once it is installed this would very likely start working — and working is the problem.
 *
 * A framed Inkwave boots a SECOND full editor inside the first: a second Tiptap, a second OPFS
 * client, a second provenance session — and a second claimant on the SAME document lock
 * (`storage/tabDoc.ts` `claimDocLock`). This repo has already lived through one tab holding two
 * document locks: StrictMode's double-invoke did it by accident and the writer-facing symptom was
 * "This document is open in another window" on a plain refresh. Framing ourselves reproduces that
 * on purpose. And the inner copy has a reader panel of its own, so it recurses.
 *
 * MODE-INDEPENDENT deliberately: reader mode is no better, because the app is a client-rendered SPA
 * and extracting its shell yields a page with no prose in it.
 *
 * The origins come from `APP_INITIATORS` (reader/framingRule.ts) — the SAME list the extension
 * scopes its rule to. A private copy here is how a rename puts a guard quietly to sleep.
 */
export function isInkwaveItself(url: string): boolean {
  let host: string
  try { host = new URL(url).hostname.toLowerCase() } catch { return false }
  return APP_INITIATORS.some((d) => host === d || host.endsWith(`.${d}`))
}

// ── PLAYABLE MEDIA ───────────────────────────────────────────────────────────────────────────────
// Peter, 2026-08-28: "if gpt can play youtube then surely we can?" — with a screenshot of ChatGPT
// showing youtube.com in a panel, tabs and all.
//
// THE DIFFERENCE IS NOT EFFORT, IT IS WHAT KIND OF PROGRAM EACH ONE IS. X-Frame-Options and
// frame-ancestors govern EMBEDDING ONE PAGE INSIDE ANOTHER PAGE, and that is the only thing a web
// app can do: `<iframe>` (and `<embed>`/`<object>`) are the entire vocabulary, and all of them are
// covered. That restriction is not an oversight we can route around — it is what stops a page
// wrapping your bank in an invisible frame, so no browser offers an escape hatch. ChatGPT's panel
// is not an iframe: it is a NATIVE app hosting a real browser view (Electron/WKWebView), which is a
// TOP-LEVEL browsing context, and the header simply does not apply to it. The day Inkwave ships as
// a desktop app it gets the same thing for free; as a web page it never can.
//
// BUT VIDEOS ARE A DIFFERENT MATTER, and here the answer is simply yes. YouTube publishes an
// endpoint whose whole purpose is to be embedded, and it sends NO framing restriction at all
// (checked: /embed/ returns 200 with no X-Frame-Options and no frame-ancestors, unlike /watch).
// So a YouTube link is rewritten to it and plays. Same for Vimeo.
const YT_ID = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{6,})/i
const VIMEO_ID = /vimeo\.com\/(?:video\/)?(\d{6,})/i

/** A watch URL → the publisher's embeddable player. Anything else is returned unchanged. */
export function embeddableUrl(url: string): string {
  const yt = YT_ID.exec(url)
  if (yt) {
    let start = ''
    try {
      const t = new URL(url).searchParams.get('t') ?? ''
      const secs = /^(\d+)s?$/.exec(t)?.[1]
      if (secs) start = `?start=${secs}`
    } catch { /* not parseable — no start time, which is fine */ }
    // -nocookie: the same player, without YouTube setting tracking cookies for a video the reader
    // opened from inside their own document. It frames identically (checked).
    return `https://www.youtube-nocookie.com/embed/${yt[1]}${start}`
  }
  const v = VIMEO_ID.exec(url)
  if (v) return `https://player.vimeo.com/video/${v[1]}`
  return url
}

/** True when this URL became a player — the panel then shows it as media, not as a page. */
export function isPlayable(url: string): boolean {
  return embeddableUrl(url) !== url || /(youtube-nocookie\.com|player\.vimeo\.com)\/(embed|video)\//i.test(url)
}

/** True when this address can only be read, never framed — searches, and the engines themselves. */
/** Was this address a search we issued? */
export function isSearch(url: string): boolean {
  return SEARCH_ENGINES.some((e) => url.startsWith(e.url)) || url.startsWith(LEGACY_DDG_SEARCH)
    || /(^|\/\/)([\w-]+\.)*(duckduckgo|google|bing|mojeek|marginalia|searxng)\.[a-z.]+\//i.test(url)
}
/** The words the reader typed, recovered from whichever search URL they became. */
export function queryOf(url: string): string {
  try {
    const u = new URL(url)
    return u.searchParams.get('q') ?? u.searchParams.get('query') ?? u.searchParams.get('search') ?? ''
  } catch { return '' }
}

/** ⚠ `canFrame` is not an optimisation — it changes the ANSWER. An engine can only be READ when we
 *  cannot frame it; once the extension can, Google in the live frame is the better path and the
 *  reader is the one that cannot work (its results are JS-rendered). Defaulting to false keeps
 *  every existing caller, and every test, on the conservative reader-only answer. */
export function mustUseReader(url: string, canFrame = false): boolean {
  if (canFrame) return false
  return /(^|\/\/)([\w-]+\.)*(duckduckgo|google|bing|marginalia|searxng)\.[a-z.]+\//i.test(url)
}

/** A typed address → a URL. Bare hosts get https://; anything that is plainly a SEARCH (spaces, or
 *  no dot) goes to the search endpoint, because a reader who types words expects to find something
 *  rather than an error. */
export function addressToUrl(raw: string, canFrame = false): string | null {
  const t = raw.trim()
  if (!t) return null
  if (/^https?:\/\//i.test(t)) return t
  const looksLikeHost = /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(t) && !/\s/.test(t)
  if (looksLikeHost) return `https://${t}`
  return searchUrlFor(canFrame) + encodeURIComponent(t)
}

/** Tracking parameters a link picked up on its way to you. Peter, 2026-08-28, seeing
 *  `?utm_source=chatgpt.com` in the address bar: they are added by whoever gave you the link, not
 *  by us — but a reader is a place you READ, and carrying someone's campaign tag into every request
 *  and every citation is noise at best. Stripped on navigation; nothing else about the URL changes. */
const TRACKING_PARAMS = /^(utm_[a-z]+|gclid|fbclid|mc_[a-z]+|ref|ref_src|igshid|si|spm|_hsenc|_hsmi|vero_id|oly_enc_id|oly_anon_id)$/i
export function stripTracking(url: string): string {
  try {
    const u = new URL(url)
    let hit = false
    for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(k)) { u.searchParams.delete(k); hit = true }
    return hit ? u.toString() : url
  } catch { return url }
}

/** DuckDuckGo wraps every result in a redirect (`/l/?uddg=<encoded>`). Unwrap it, so clicking a
 *  result goes to the SITE — otherwise every navigation from a search lands on a redirector, which
 *  the reader then has nothing to extract from. */
export function unwrapRedirect(url: string): string {
  try {
    const u = new URL(url)
    if (/(^|\.)duckduckgo\.com$/i.test(u.hostname) && u.pathname.startsWith('/l/')) {
      const target = u.searchParams.get('uddg')
      if (target && /^https?:\/\//i.test(target)) return target
    }
  } catch { /* not a URL we can improve */ }
  return url
}

/** Hosts known to refuse framing, so the FALLBACK can say so before showing an empty rectangle. */
// Hosts known to send X-Frame-Options / frame-ancestors. NOT a security control and never
// exhaustive — the deadline below is what catches the general case; this just skips the wait for
// the ones we have already met (Peter hit abc.net.au and youtube.com within a minute of each other).
const KNOWN_NO_FRAME = [/(^|\.)jstor\.org$/i, /(^|\.)sciencedirect\.com$/i, /(^|\.)tandfonline\.com$/i,
  /(^|\.)springer\.com$/i, /(^|\.)wiley\.com$/i, /(^|\.)x\.com$/i, /(^|\.)twitter\.com$/i,
  /(^|\.)youtube\.com$/i, /(^|\.)google\.[a-z.]+$/i, /(^|\.)abc\.net\.au$/i, /(^|\.)facebook\.com$/i,
  /(^|\.)instagram\.com$/i, /(^|\.)linkedin\.com$/i, /(^|\.)reddit\.com$/i]

export function hostOf(url: string): string {
  try { return new URL(url).host } catch { return '' }
}
export function likelyRefusesFraming(url: string): boolean {
  const h = hostOf(url)
  return !!h && KNOWN_NO_FRAME.some((re) => re.test(h))
}
