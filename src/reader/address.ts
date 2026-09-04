import { APP_INITIATORS } from './framingRule'

// THE ADDRESS LAYER — what a typed string means, and which mode can serve it.
//
// Pure functions over URLs: no React, no DOM, no fetch, no module state. ⚠ ONE DEFINITION, THREE
// READERS: the address bar, `go()` and the framing effect all ask what a string means, and a second
// copy is how the address bar and the navigator start disagreeing (hence `canFrameRef` in the
// component). → docs/archive/reader-panels.md#address


// ⚠ GOOGLE CAN NEVER BE READ HERE — its results are JavaScript-rendered, and fetching from the
// writer's own address changes WHO ASKS, not what comes back. Its FRAMING header is strippable by
// the extension (proved headed, `pnpm prove:framing`), but Google then refuses to serve a search
// inside a frame at all. So NO PATH USES THIS CONSTANT: it is kept because `isSearch` and the copy
// reason about Google, and a test asserts `searchUrlFor` never returns it.
// → docs/archive/reader-panels.md#addr-google-stale
export const GOOGLE_SEARCH_URL = 'https://www.google.com/search?q='
// ⚠ THE READER'S SEARCH ENGINE IS THE ONE OUR SERVER CAN ACTUALLY REACH, AND IT IS A CHAIN.
// Search engines refuse a data centre and serve a person, so the no-extension path had never worked
// with html.duckduckgo.com — measured 502 / 0 blocks, against marginalia's 200 / 119. And ONE engine
// is not enough either: the same engine answered 170 / 170 / 3 / 3 blocks on four consecutive calls,
// which is a search box that is empty half the time. Add engines here, never pin one.
// LIVE_SEARCH_URL is a different question — "what can this browser DISPLAY", not "what can a server
// read" — so the two endpoints coexist. → docs/archive/reader-panels.md#addr-search-chain
export interface SearchEngine { readonly name: string; readonly url: string }
export const SEARCH_ENGINES: readonly SearchEngine[] = [
  // 170 blocks / 90 linked at best. Indexes non-commercial long-form pages, which is why it returns
  // the SEP entry and a course's lecture notes for a philosophy query rather than a shop.
  { name: 'Marginalia', url: 'https://old-search.marginalia.nu/search?query=' },
  // 104 / 66, and steady across the runs where marginalia collapsed to 3 blocks.
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

/** Did a search actually return RESULTS — links that LEAVE the engine?
 *
 * ⚠ COUNTING LINKS IS NOT COUNTING RESULTS. Bing answers 31 linked blocks all pointing back at
 * bing.com (pagination, "images", "next page"), which a naive count scores as healthy — so the chain
 * never falls forward and the writer gets a page of an engine's own furniture. The signal is
 * DISTINCT EXTERNAL HOSTS, because that is what a result IS: somewhere else to go. It also degrades
 * correctly, since a challenge page has zero of them and still answers 200.
 * → docs/archive/reader-panels.md#addr-external-hosts
 */
export function searchLooksEmpty(externalHosts: number): boolean {
  return externalHosts < 3
}

/** The distinct hosts a search's results point AT, excluding the engine's own. Pure, so the rule
 *  above can be tested without a browser and the panel cannot grow a second copy of it. */
export function externalHostCount(links: readonly string[], engineUrl: string): number {
  let engineHost = ''
  try { engineHost = new URL(engineUrl).hostname } catch { /* a malformed engine is nobody's host */ }
  const base = engineHost.replace(/^(www|search|old-search|lite|html)\./, '')
  const hosts = new Set<string>()
  for (const href of links) {
    if (!/^https?:\/\//i.test(href)) continue
    let h = ''
    try { h = new URL(href).hostname } catch { continue }
    // An engine's own redirector counts as the engine, not as a destination.
    if (h === engineHost || (base && h.endsWith(base))) continue
    hosts.add(h)
  }
  return hosts.size
}
export const LEGACY_DDG_SEARCH = 'https://html.duckduckgo.com/html/?q='   // kept: `isSearch` must
                                                                          // still recognise old URLs
/** The REAL DuckDuckGo — its own styling, its own JavaScript. Only reachable with framing. */
export const LIVE_SEARCH_URL = 'https://duckduckgo.com/?q='
/**
 * ⚠ ECOSIA WAS ASKED FOR AND IS REFUSED ON MEASUREMENT — a reasonable-sounding idea, so the refusal
 * is recorded or the next reader tries it again. Read: 403, Cloudflare refuses the fetch. Framed
 * with the headers stripped: "Just a moment…", a Cloudflare interstitial, 0 result links. Not a
 * header we can strip and not a path an extension changes — Cloudflare is judging the CLIENT.
 * → docs/archive/reader-panels.md#addr-ecosia
 */
export const ECOSIA_SEARCH_URL = 'https://www.ecosia.org/search?q='

/**
 * The endpoint a typed query becomes.
 *
 * ⚠ `canFrame` CHOOSES AN ENDPOINT, NEVER AN ENGINE THAT ANSWERS WITH A CAPTCHA. Framing made
 * Google look reachable and it is not: measured with the shipped rule, google.com/search frames and
 * then REDIRECTS ITSELF to /sorry/index, which Peter hit immediately. What the capability does buy
 * is the PRETTY endpoint where the browser can display it, and the plain one a server fetch can read
 * where it cannot. → docs/archive/reader-panels.md#addr-ecosia
 */
export function searchUrlFor(canFrame: boolean): string {
  return canFrame ? LIVE_SEARCH_URL : SEARCH_URL
}

/**
 * ⚠ INKWAVE MAY NOT OPEN INKWAVE. Our own framing headers are NOT what refuses it — the extension
 * strips those, so once installed this would start WORKING, and working is the problem: a framed
 * Inkwave boots a second editor, a second OPFS client, a second provenance session and a second
 * claimant on the same document lock, and its own reader panel recurses. MODE-INDEPENDENT: reader
 * mode extracts an SPA shell with no prose in it.
 *
 * The origins come from `APP_INITIATORS` — the SAME list the extension scopes its rule to; a private
 * copy is how a rename puts a guard quietly to sleep.
 * → docs/archive/reader-panels.md#addr-inkwave-itself
 */
export function isInkwaveItself(url: string): boolean {
  let host: string
  try { host = new URL(url).hostname.toLowerCase() } catch { return false }
  return APP_INITIATORS.some((d) => host === d || host.endsWith(`.${d}`))
}

// ── PLAYABLE MEDIA ───────────────────────────────────────────────────────────────────────────────
// ⚠ A WEB APP CANNOT DO WHAT ChatGPT'S PANEL DOES, and the difference is not effort: `<iframe>`
// (with `<embed>`/`<object>`) is the entire vocabulary available here and X-Frame-Options covers all
// of it, while ChatGPT hosts a real browser view — a TOP-LEVEL context the header does not reach.
// BUT A PUBLISHER'S EMBED ENDPOINT IS DIFFERENT: /embed/ sends no framing restriction at all, so a
// YouTube or Vimeo link is rewritten to it and plays.
// → docs/archive/reader-panels.md#addr-playable
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

/** Tracking parameters a link picked up on its way to you. A reader is a place you READ, and
 *  carrying someone's campaign tag into every request and every citation is noise at best. Stripped
 *  on navigation; nothing else about the URL changes.
 *  → docs/archive/reader-panels.md#addr-hygiene */
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
// ⚠ NOT a security control and never exhaustive — the load deadline catches the general case; this
// only skips the wait for hosts we have already met.
// → docs/archive/reader-panels.md#addr-hygiene
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
