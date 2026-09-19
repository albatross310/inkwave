# Inkwave Read along — implementation notes

## Run the standalone preview

This needs Node 22 or newer and the repository dependencies installed (`pnpm install`):

```sh
node scripts/readalong-dev.mjs
```

Open `http://127.0.0.1:8787/readalong/index.html`. This local server serves the reader and the same Node speech relay used in production. It does not open or modify Inkwave editor documents. Stop it with Ctrl+C. Opening `index.html` as a `file://` URL is **not** the supported mode: module loading, secure APIs and the speech relay require the server.

For deployment in Inkwave, follow `CODEX_START_HERE.md`. Do not blindly replace `vercel.json`, the menu component, or Vite configuration with older copies.

## Everyday workflow

Open an EPUB, a PDF with selectable text, a UTF-8 text or Markdown file, or paste text. A dropped file works too. No document is sent to the provider at import. The desktop shelf and mobile library hold multiple books. Choose **Voice & render**, enter a connection credential, load your voices, choose a genuinely Australian female voice, and press **Use this voice**. The first audition costs credits and is confirmed explicitly. It renders one existing passage so it can be reused in a full render rather than discarded.

**Steady / understated** is the default. V3 uses stability 1, while Natural uses 0.5. Multilingual v2 uses model-appropriate settings with style exaggeration zero. These controls are not substitutes for choosing the right source voice. A voice-design brief is available, but the reader does not secretly add performance tags, rewrite the story, or tell a model to invent jokes.

Render one chapter or the remaining book. Playback, font size and playback speed do not trigger synthesis. Recordings are grouped by exact text, voice ID, model, settings and cache-schema version. Changing voices selects another edition rather than deleting the old one. Returning to a previously rendered edition reuses it.

The default reading size is **17px**, adjustable from 14 to 28px. There is a night mode, focus dimming, search, chapter navigation, click-to-seek, bookmarks, media controls, playback-speed changes and a sleep timer. The slider seeks within the current recorded passage, not across an estimated whole-book duration. Scrubbing never pretends an unrendered chapter has audio.

## Text and timing

Imports remove a leading UTF-8 BOM, normalise CRLF/CR newlines to LF and trim outer whitespace. Otherwise the speech input is the imported text. Uploaded markup is displayed with text nodes, never executed. EPUB and PDF are extracted locally before entering this same text pipeline. Markdown is treated as text, with basic headings detected. Standalone HTML files are not accepted.

Chapter detection recognises common numbered headings, `Chapter`/`Part`/`Book` headings and Markdown headings. Large undivided ranges are divided into smaller display sections to avoid mounting hundreds of thousands of spans. These synthetic navigation labels are not inserted into the recording. The original chapter heading is displayed once, with timing-aware word spans.

Each chapter/section becomes passages of at most 1,400 UTF-16 code units, preferably broken at paragraph or sentence boundaries. Splitting preserves every non-whitespace character and avoids breaking surrogate pairs. The request sends the exact passage without performance tags. The provider is asked for `mp3_44100_128` plus original-text alignment.

Word positions use UTF-16 offsets throughout, matching JavaScript strings and DOM spans. The returned character entries are mapped positionally—not by finding the first matching word. Whitespace differences can be tolerated; reordered words, changed punctuation, number expansion in the wrong alignment field, invalid timestamps or missing arrays cause **explicit passage highlighting**, not made-up word timing. Binary search against `HTMLAudioElement.currentTime` drives highlighting. Changing playback speed remains synchronised because the audio media clock remains authoritative. Highlighting clears during gaps.

Returned alignment is provider metadata, not an independent verification that the generated speech faithfully reproduces every word. Generative speech may mispronounce names, omit/repeat words or interpret bracketed text. Listen to a real audition and inspect chapter transitions before committing to long-form generation. The implementation does not offer an unsupported guarantee of perfectly human or perfectly faithful narration.

## Rendering and failure behaviour

The browser schedules one paid request at a time under a same-origin Web Lock. Each successful audio blob and its timings are written immediately to a dedicated IndexedDB database. The queue checks the cache again inside the lock to avoid ordinary duplicate-tab billing.

Pausing finishes and saves the in-flight request, then stops scheduling. Closing the panel pauses in the same way; its trusted frame remains mounted so the result can still save. Closing/reloading the entire tab cannot guarantee completion: an in-flight paid request may be lost. Reopening reuses whatever was actually saved; it does not silently retry or claim a durable server job exists.

A lost response, provider error or timeout stops the queue. There are no automatic retries because a request may already have been charged. If storage fills after synthesis, the paid recording stays in memory as a recovery asset. **Save recovered audio** retries only the storage write; it does not call ElevenLabs. Export includes the recovery asset. Further rendering first attempts to save it, preventing an inadvertent paid re-render while recovery is outstanding. A page reload loses this in-memory rescue, so export or save it before closing.

**Remove this voice edition’s cached audio** is explicit and confirmed. It affects only matching reader-cache entries, never editor documents. Identical passages can be shared across books, and the confirmation warns that those references are affected too. Removing book text from the shelf does not silently purge its audio. Browser storage may be evicted or cleared; a completed local write is not a permanent backup.

## Portable listening books

Export creates `.iwlisten`, a small custom binary container: magic `IWLISTEN1\n`, a big-endian 32-bit manifest byte length, UTF-8 JSON, then consecutive audio blobs. The JSON carries book text, selected voice profile, saved position/bookmarks and per-blob hashes/byte lengths/timings. It is not a standard audiobook or EPUB format; reopen it in this reader.

The import checks the complete container before writing: source hash, chunk/profile keys, timestamp offsets and bounds, audio hashes, lengths, duplicates and trailing bytes. It does not overwrite existing book text, cached takes or an existing saved position. It restores the exported checkpoint when none exists. A quota failure while writing a fully validated archive can leave a partial cache, which remains reusable; there is no destructive rollback. The v1 limits are 2 million source characters, 3,000 archive assets, a 20 MB manifest and a 1.5 GB archive. Hashing is performed one audio blob at a time.

Exports contain private text and audio in plaintext, not encrypted form. Keep them somewhere appropriate. Only the selected voice edition is exported; other cached editions stay local.

## Security and deployment

`api/readalong.mjs` is a bounded same-origin POST relay to fixed ElevenLabs endpoints. It rejects other origins, non-JSON bodies, invalid models/voice IDs, oversized text and unsupported actions. It does not accept arbitrary upstream URLs, follow redirects, log keys/manuscripts or retry synthesis. Responses use `private, no-store`. Provider failures are sanitised rather than reflected verbatim.

The default API key is held only in frame memory, not Local Storage, IndexedDB or the URL. It is transmitted over the app’s HTTPS connection to its same-origin relay, which forwards it to ElevenLabs. The key is therefore visible to the user’s trusted browser runtime and Inkwave server, not cryptographically hidden from either. Normal origin security and careful review of scripts/extensions still matter. HTTP is for loopback development only.

Optional server-key mode requires a separate access token of at least 32 characters and uses a constant-time hashed comparison. A provider key with no valid gate is never used publicly. This is a private-instance mechanism, not an authenticated multi-tenant billing system. The in-memory concurrency set is per server instance; it is not a distributed quota or anti-abuse service.

The only new iframe is trusted, same-origin, script-enabled and sandboxed. It contains no untrusted HTML. Its external module scripts obey a narrow static CSP; blob URLs are allowed for audio only. The parent keeps its existing strict nonce-based CSP. Root/global CSS and React Router configuration are untouched. Header changes preserve `DENY` outside the reader prefix rather than relying on two competing global/specific `X-Frame-Options` values.

There is no service worker added by this module. Cached audio can play without another provider request while the reader is available; this is **not** a promise that the app shell will reopen offline without Inkwave’s existing PWA cache. Inspect the parent service worker and test installed-PWA behaviour during integration. Existing editor OPFS, provenance archives, account providers and document-saving code are never accessed by this module.

ElevenLabs receives text and applies its own account/retention terms. The relay does not assert zero retention or blindly set an enterprise-only logging flag. Review provider settings and the site’s privacy disclosure before public deployment.

## Tests and remaining verification

Run pure Node tests:

```sh
node --test tests/readalong/*.node.mjs
```

Run the browser integration script with an ordinary Inkwave dev server:

```sh
READALONG_BASE_URL=http://localhost:5173 node tests/readalong/browser.mjs
```

It imports Chromium from the repository’s existing `@playwright/test` dependency. `READALONG_CHROME` can point to a locally installed Chromium executable. It intercepts `/api/readalong`, uses a deliberately fake account voice and silent WAV data, and checks the actual page/controller/player with IndexedDB. No real key or charge is involved. Do not judge voice quality from this test.

See `TEST_REPORT.md` in the bundle for what ran in the generation environment, and the integration checks below for subsequent repository validation. Live API synthesis, physical Safari, real deployment headers, quota behaviour across physical browsers and long-duration background playback still require release testing. Do not turn a mock test into a claim of a live audition.

## Official API references consulted (14 September 2026)

- Speech with original-text character timestamps: https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps
- Account voice listing and pagination: https://elevenlabs.io/docs/api-reference/voices/search
- Model capabilities and request limits: https://elevenlabs.io/docs/overview/models
- V3 delivery/stability guidance: https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices
- Voice Design: https://elevenlabs.io/docs/eleven-creative/voices/voice-design
- Accent depends on voice selection: https://help.elevenlabs.io/hc/en-us/articles/19581255545873-How-do-I-select-the-language-and-accent

The provider can change model availability, voice compatibility, rate limits and billing. Recheck these sources when integrating. The code intentionally uses a conservative passage length, no hard-coded monetary cost estimate and no claimed universal Australian default voice.

## Integration in the current checkout

Read along opens from **Options → Read along**, with the existing editor mounted underneath.
The launcher restores focus to Options on close. The reader inherits the host’s night setting on
first use; its own appearance choice is then saved in the separate reader library. Mobile playback
uses a full-width seek bar, retains Bookmark, and uses 16px form controls to avoid iOS focus zoom.
No editor storage, document format, provenance, login, global stylesheet loading, or hydration code
is changed by this integration.

The main `pnpm gate` includes `pnpm test:readalong`. Browser verification remains an explicit
`READALONG_BASE_URL=http://localhost:5173 node tests/readalong/browser.mjs` command because it needs
a running app and installed browser engines. All speech responses in that test are mocked.

The relay recognises the current canonical `https://iwzero.me` origin as well as the Inkwave domain
and local development origins. Preview URLs supplied by Vercel are recognised automatically;
custom preview domains require `READALONG_ALLOWED_ORIGINS`.

The configuration requests a 300-second function duration. Vercel’s
[duration documentation](https://vercel.com/docs/functions/configuring-functions/duration) permits
this on all plans when Fluid Compute is enabled. The actual project’s plan and Fluid setting could
not be read during integration: the connected account exposed no Vercel teams, and this checkout
has no Vercel project link. Verify that project setting before deploying. This is not evidence of
a successful preview or production deployment.

Live release checks still require a Vercel preview with actual response headers, installed-PWA
reopening/update behaviour, and a user-approved paid audition of a real Australian female voice.
No provider credentials or real recordings are part of this checkout.

### Integration fixes and local checks

The bundle review corrected repeated-passage archive exports, made imported recordings and saved
places insert atomically without replacing another tab’s copy, and reserved the selected book/voice
across asynchronous import and render preparation. Closing now cancels pending playback and prevents
a queued render or completed audition from restarting behind the closed panel. A paused in-flight
request still saves its successful result.

Audio bytes are stored as ArrayBuffers with their MIME type and reconstructed as playback Blobs.
This avoids WebKit’s Blob-write failure in temporary browser profiles; older Blob-backed entries
remain readable without a destructive migration.

Local validation at the EPUB/PDF import checkpoint on 14 September 2026, before subsequent local
speech work: TypeScript passed and the production build passed. The earlier integration run of the
existing Vitest suite passed **304 files / 3,364 tests**, with two existing skipped tests. The isolated reader
suite passed **61 tests**, including EPUB spine/security/size handling, PDF text extraction,
current deployment-header rules and POST service-worker bypass.
The browser suite runs the real reader in Chromium and WebKit with synthetic text, a fake account,
and silent WAV recordings; it does not evaluate narration quality or prove physical-device behaviour.

The Chromium service-worker smoke (`node tests/readalong/pwa.mjs`) also passed: the real worker
controlled the reader, kept the unauthenticated speech POST out of caches, and restored/replayed a
synthetic listening book after an offline reload. This is not a physical installed-PWA test.

The browser integration verifies Options focus restoration, the original editor DOM remaining
mounted, its real save acknowledgement, and exact text/document identity after reload. WebKit’s
reader flows use temporary contexts; its editor save/reload control uses a fresh temporary
persistent profile because an editor-only control reproduced existing OPFS errors in ephemeral
WebKit. No user profile or personal document is used.


## EPUB and PDF imports

**Open a book** accepts `.epub`, `.pdf`, `.txt`, `.md` and `.iwlisten`; dropping files uses the
same importer. The file picker deliberately has no restrictive extension filter, so iOS can select
these formats. Nothing is sent to a provider until the user explicitly renders narration.

EPUB follows the package document’s declared spine, rather than ZIP entry or filename order.
Only readable text is imported; scripts, embedded media and styling are not executed. DRM-protected
or malformed books are refused. PDF uses the existing PDF.js dependency in a dedicated worker,
loaded only when a PDF is opened. Text follows the PDF text layer’s content order, which cannot
reliably reproduce every multi-column layout, table or footnote. A persistent import note asks the
reader to check that order before narration. Pages without selectable text are counted and disclosed;
an entirely scanned/image-only PDF is refused with an OCR explanation. Password-protected PDFs
must be unlocked first. OCR and original-page PDF/EPUB rendering are not part of Read along.

The import cap is 50 MB for EPUB/PDF, 2,000 PDF pages, and the existing two-million-character text
limit. Extraction errors leave the current book and audio untouched. The extracted text is stored
in the reader library; the original EPUB/PDF is not copied into editor storage. `.iwlisten` exports
preserve the extracted text and import note alongside the chosen recordings.

`scripts/readalong-vendor.mjs` copies the installed PDF.js parser, worker, character maps and licence
into ignored generated assets under `public/readalong/vendor/`. `predev`, `prebuild` and the standalone
reader server run it. These parser assets are lazy and add nothing to the ordinary editor startup.
The existing `/pdfjs/standard_fonts/` assets support font decoding. No CDN or external parser API
is used. Run `node tests/readalong/formats.browser.mjs` against the local dev server for synthetic
EPUB/PDF import checks in Chromium and WebKit.

That browser script passed in both Chromium and WebKit at the EPUB/PDF checkpoint, using fresh
isolated contexts. It verified EPUB spine order despite scrambled archive/manifest order, inert
hostile XHTML, real two-page PDF text extraction and order, and rejection of corrupt, empty,
missing-spine, DRM-protected or scanned fixtures without changing any saved book. Extracted text
survived reload, and a PDF's reading-order notice survived `.iwlisten` export and import into a
fresh context. No external or API requests occurred; no paid narration was generated.

The EPUB/PDF checkpoint production build ran the vendor prebuild step successfully. Its static
output includes `readalong/import-epub.mjs`, `readalong/import-pdf.mjs`, the PDF.js 6.1.200 parser
and worker, licence/version metadata, all 168 character maps, and the existing standard-font assets.
The emitted import modules, parser, worker and metadata were checked against their source bytes.


## Local CPU narration checkpoint

On loopback development origins, a fresh reader can select **Local on this Mac** using Kokoro.
It needs no provider key or paid confirmation. The one-time setup is
`pnpm setup:readalong-local`; the roughly 93 MB quantized model is pinned to a specific upstream
revision and its SHA-256 is checked. Dependencies and model files are outside the root production
package. Rendering disables network fetches in the inference worker and uses two CPU threads.
The Node-only `/api/readalong-local` route is available in Vite and the standalone reader, not in
the deployed Vercel function list. Both the browser origin and TCP peer must be loopback.

Local passages are capped at 600 characters, split further for the model without silent token
truncation, saved as WAV, and kept distinct from Eleven recordings. This engine has no trustworthy
word timestamps: it visibly uses passage highlighting. British and American voices are labelled
accurately; no Australian preset is claimed. Existing Eleven profiles and paid-consent controls
remain available.

Actual synthetic CPU auditions succeeded on the Intel i9 Mac: 16.1–17.45 seconds of audio took
26.8–28.9 seconds to produce at two inference threads; peak process RSS across the run reached
about 774 MiB. A real request through the local HTTP route also generated WAV successfully.
The current checkpoint passes TypeScript, production build and 72 isolated reader tests, with
local/Eleven and EPUB/PDF browser regressions passing in Chromium and WebKit.

This is a functioning baseline, **not** the requested final book director or cast of prompt-designed
actors. The broader requirements, scene-level comparison, public Vercel/Windows-worker architecture
and GPU options are documented in [the voice-model comparison](READALONG-VOICE-MODEL-COMPARISON.md).
The Windows preparation script has not been executed on Windows; the durable public queue, full-book
director, actor casting and character-colour UI are not yet deployed or represented as complete.

## MOSS cloud audition preparation — 15 September 2026

Peter now prefers rented cloud GPUs to the GTX 1070 desktop. The proposed public design remains
Vercel coordination with outbound GPU workers and durable saved audio; client playback needs no GPU.

`tools/readalong-moss/` prepares the first audition: three prompt-designed Australian voice
candidates, a complete original dialogue scene, and a continuation conditioned on the earlier
scene's audio and text. It pins MOSS VoiceGenerator, MOSS-TTSD and their codec, validates model
weights, and checkpoints completed recordings. Scene context and personas remain visible review
data; this adapter does not claim that TTSD accepts separate nonspoken motive instructions.

The cloud launcher previews a live RTX A6000 48 GB quote by default. Explicit paid execution adds
private SSH access, source-only upload, model setup, recording download, checksum verification,
shutdown and deletion after verified backup. The shutdown deadline is enforced locally, not a
provider hard spending cap. A stopped volume is retained if backup fails.

The review page has character colours and whole-scene audio controls, without invented timestamps.
Chromium and WebKit checks used explicitly synthetic WAVs. Python contract/lifecycle tests use
mock cloud and model APIs. **No GPU has been provisioned and no MOSS audio has been generated.**
Runpod login and an initial US$5 budget are pending. The full book director and public worker
integration remain next-stage work, subject to the audition results.

See [the audition guide](../tools/readalong-moss/README.md) for the concrete commands and limitations.
