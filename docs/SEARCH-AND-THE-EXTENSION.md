# Why search needs the extension — measured, 2026-08-30

Peter asked three times whether search could run "from the user's IP". It can, that path is
built, and it has never been installed. This is what was measured, so the next person does not
re-litigate it from a screenshot.

## The finding

Search engines refuse **Vercel's datacentre IP**. They do not refuse Peter.

Same URL, same User-Agent, same minute:

| From | mojeek | html.duckduckgo | lite.duckduckgo |
|---|---|---|---|
| Peter's connection (node fetch) | 200, 18.7KB | 200, 32.0KB | 200, 22.8KB |
| Deployed `/api/reader` (Vercel) | 502 `fetch failed` | 502 `fetch failed` | — |

**The control that makes this readable:** the same deployed function fetches
`plato.stanford.edu/entries/identity-time/` (200, 222KB, real title and blocks) and
`en.wikipedia.org/wiki/Ship_of_Theseus` (200, 71KB) in the same run. The function is healthy;
the engines single it out. Without that control, `fetch failed` reads as our bug.

Extraction is not the problem either — run against the HTML that *does* come back, our own
`extractBlocks` produces real results: mojeek 47 blocks / 35 linked, html.duckduckgo 31 / 31,
top hit "Identity Over Time (Stanford Encyclopedia of Philosophy)" on both.

## Two theories tested and REFUTED — do not re-run these

1. **"It's our bot User-Agent."** `api/_reader-core.mjs` sends
   `Mozilla/5.0 (compatible; InkwaveReader/1.0; +https://inkwave.studio)`, which is the classic
   bot form, so this looked obvious. Measured from Peter's connection, the bot UA gets **200 from
   all three engines** — identical bytes to a Chrome UA on mojeek (18728B both). The UA is not
   the blocker. Changing it would have "fixed" nothing and looked like a fix.
2. **"Google could work through the extension."** It cannot, and this is separate from the IP.
   `google.com/search` returns 200 with 91KB and **one** external link: the results are
   JS-rendered, so there is nothing in the HTML to extract. Fetching from Peter's own connection
   changes who asks, not what comes back. Google needs a rendering engine or their API; the
   extension does not help. Mojeek and DuckDuckGo's HTML endpoints are server-rendered and do.

## The instrument is not faithful here — know this before probing

Headless Chromium is **itself blocked**, and for a different reason than the server:

| headless Chromium, from Peter's connection | mojeek | html.duckduckgo |
|---|---|---|
| default (HeadlessChrome UA) | 403 | 202 challenge |
| with a real Chrome UA | **200, 18.6KB** | CORS `Failed to fetch` |

So a headless probe cannot answer "does this work in Peter's browser" — it reproduces neither
his case nor the server's. The DuckDuckGo CORS failure is also not a refusal: a page-context
`fetch` cannot read that response, while an extension worker holding host permission can. Peter's
own browser is the only faithful instrument for this path.

## What that leaves

The extension in `extension-src/` is the whole of the answer, and it is real: `<all_urls>` as an
**optional** permission (so the install prompt does not change for someone who only ever presses
Alt+Shift+C on a DOI page), granted from the popup, with `content-source.ts` doing the fetch.

    pnpm ext:build      # → extension-src/.output/chrome-mv3 + a store zip

Load `extension-src/.output/chrome-mv3` at `chrome://extensions` with Developer mode on, then
turn on page fetching in the popup. The reader re-reads the current page the moment the grant
lands (`SourceBrowser.tsx` re-asks on window focus, because `permissions.request()` is honoured
only inside an extension page and the app is told nothing).

Domains check out: `inkwave.studio` and `www.inkwave.studio` both 301 to `iwzero.me`, which is in
the content script's match patterns. (`https://inkwave.studio/*` would NOT have matched
`www.` — it does not need to.)

## UNPROVEN, and it is the last step

That the extension path returns results **in Peter's real browser** has not been demonstrated,
because nothing on this machine can stand in for it. Everything up to that point is measured. If
it fails there, the overlay-style question to ask is which of the three it is: the grant, the
worker's fetch, or extraction.
