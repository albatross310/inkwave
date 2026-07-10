# Inkwave Scroll — CLAUDE.md

Project context for Claude Code sessions. Read this first.

## What this is

**Inkwave Scroll v0.1** — the free tier of Inkwave, a calm writing environment for
short academic/philosophical writing. Solo developer: Peter (Brisbane). Target users:
STEM & philosophy honours students writing short documents.

The defining mechanic is **SCAS** (Stochastically Constrained And Suggested) — words
outside a per-paragraph "active vocabulary" glow red, and the writer can cycle through
thesaurus synonyms to replace them. The friction becomes an interpretable authorship
trace (provenance) without surveillance.

This is the **free Scroll tier only**. The paid **Tablet** tier (Clay/Stone commitment
states, weathering, hollow clocks, sentence-level glyphs, etc.) is Phase 2+ and **must
not be built here**. See the canonical docs for the full deferred list.

## Canonical documentation (lives OUTSIDE the repo)

On the Windows host, accessible from WSL at:
`/mnt/c/Users/peter/OneDrive/Documents/Claude/Projects/Inkflow Studio/`

Read in this order:
1. **`inkwave-scroll-v01-build-spec.md`** — start here. The focused build spec for v0.1.
   Tech stack, document model, SCAS scope, the 4-week build plan, explicit out-of-scope list.
2. `inkwave-architecture-decisions-v5.md` — full ~60-page architecture. Reference only.
3. `claude-session-memory.md` — session-by-session decision history; *why* choices were made.

Do **not** build against the older v3/v4 architecture docs (audit trail only).

## Tech stack

Vite + React 18 + TypeScript + Tailwind 3 + Tiptap (on ProseMirror) + OPFS/IndexedDB.
**React Router v7 in framework mode** (`@react-router/dev` Vite plugin) for routing +
build-time prerendering. `uuid` for IDs. Hosting: Vercel. Domain: `inkwave.studio`.

```
pnpm dev        # react-router dev (http://localhost:5173)
pnpm build      # react-router build — outputs static client + prerendered HTML to build/client/
pnpm typecheck  # react-router typegen && tsc -b
pnpm preview    # vite preview --outDir build/client
pnpm test       # vitest — ~37 files / 426 tests; ALL must pass before any push
pnpm test:e2e   # playwright (none written yet)
```

**Routing / SSR model.** `react-router.config.ts` sets `ssr: false` (SPA mode, no runtime
server) + `prerender(['/', '/about'])` — `/` and `/about` are rendered to static HTML at
build for SEO + instant first paint. The editor IS the landing page (`/`): the route
prerenders the empty-editor SHELL (`<Scroll>` chrome + `<EmptyEditorSurface>` facsimile,
same CSS classes as the live editor — see `src/editor/Scroll.tsx`), then the real Tiptap
editor mounts client-side in its place (ProseMirror can't SSR). The prerendered page is a
direct CSS function of the shared components, so style changes propagate automatically.
Flip `ssr: true` later when the Phase-2 "rooms" model needs per-request rendering.

Package manager is **pnpm** (`packageManager: pnpm@10.33.2`), not npm.

## Build progress (vs. build-spec 4-week plan)

- **Week 1 — Foundation: DONE.** `/edit` route, Tiptap editor, OPFS autosave (200ms
  debounce), restore-on-refresh, IndexedDB metadata index, hand-rolled PWA
  (`public/manifest.webmanifest` + `public/sw.js`).
- **Week 2 — SCAS variant: DONE (and gone beyond spec).** Per-paragraph stochastic
  re-ranking, red highlighting, Datamuse thesaurus, limit selector, compliance tracking,
  the inline word-cycle UI (Stages A & B done; C & D in progress).
- **Provenance spine M0 — SCAS engine swap: DONE.** Building the v4 spec
  (`inkwave-scroll-v01-provenance-spine-build-spec-v4.md`), which supersedes the old
  Week-3 plan. The Week-2 per-paragraph `ranking.ts` model is replaced by `scas/engine.ts`
  + `scas/state.ts` + `scas/controller.ts`: a rotating seed-derived exclusion set `S_v`
  (local seed in M0; server-held from M3) and the ban-credit/satisfied/immunity state
  machine. `RedHighlightExtension` now *renders* engine state (locked ∪ liveKicks) instead
  of recomputing vocab. Delete a kicked word → it locks (forced kick on retype, suppressed
  from popovers); swap → resolves; verdicts freeze at commit so `S_v` rotation never
  reflows committed text. Unit-tested (`scas/engine.test.ts`) + browser-verified.
- **Provenance spine M1 — snapshots + local hashing: DONE.** `provenance/hash.ts`
  (RFC 8785 JCS + SHA-256 + bundleHash), `provenance/kicks.ts` (KickEvent emitter),
  `provenance/snapshots.ts` (OPFS append-only store; snapshot on a resolved kick when
  the contentHash changed — typing/pastes never snapshot), `components/ReceiptPanel.tsx`.
  Offline, no network; `ots:unstamped` until M2. Unit-tested (`hash.test.ts`) +
  browser-verified (accrues on resolution, persists across reload).
- **Provenance spine M2 — OpenTimestamps → Bitcoin: DONE.** Each snapshot's bundleHash
  is stamped to Bitcoin via OpenTimestamps: unstamped → pending (seconds) → confirmed
  (hours, upgradeable by anyone). `javascript-opentimestamps` is a Node lib that fights the
  SPA's SSR/prerender bundling (global Buffer, stream-browserify in SSR), so OTS runs in a
  **stateless relay** — `api/ots.mjs` (Vercel) + `api/_ots-core.mjs`, mirrored in dev by a
  vite `configureServer` middleware (see vite.config.ts). This is the spec's sanctioned
  `api/stamp` fallback: it logs nothing and only handles a hash, so verification stays
  independently Bitcoin-anchored. Client wrapper `provenance/ots.ts` POSTs to `/api/ots`;
  the ReceiptPanel shows status + a "check Bitcoin" upgrade. `vercel.json` excludes `/api`
  from the SPA rewrite. Browser-verified to pending.
- **Provenance spine M3 — live-composition signing service: DONE.** A stateless,
  content-free signing service issues a rotating server-held exclusion set S_v and signs
  hash-chained receipts. Server (Node; Vercel functions + dev middleware):
  `api/_provenance-core.mjs` (Ed25519 @noble, seed derivation H(masterSecret,docId,v),
  S_v INDEX sampling → bitmask, signPeriod), `api/session.mjs`, `api/sign.mjs`. Client:
  `provenance/receipts.ts` (verifyReceipt/verifyChain), `provenance/session.ts`
  (SessionRunner). The editor opens a session on doc load, drives the SCAS controller off
  the server's S_v (`controller.useServerSet`), and on the period timer signs the period's
  receipt (content + resolved kicks, hashes only) + rotates the set; receipts persist
  (`scasReceipts`) and fold into snapshot bundles so OTS anchors them. Offline → falls back
  to local S_v (degrades visibly). ReceiptPanel shows the chain + a verify action.
  Real keys come from env (INKWAVE_SIGNING_SK / INKWAVE_MASTER_SECRET / VITE_SIGNING_PK);
  published key at `/.well-known/inkwave-signing-key.json` + committed. 49 tests; live
  loop browser-verified (session → receipts chain → verify ✓).
- **Provenance spine M4 — writer-held storage + export bundle: DONE.**
  `provenance/bundle.ts` builds the self-verifying export bundle (content + snapshots
  with OTS proofs + receipt chain + key ref); the ReceiptPanel "⤓ export bundle" downloads
  it. `storage/folder.ts` (File System Access, Chromium-only) — grant a folder once
  (`showDirectoryPicker`), persist the handle in IndexedDB, re-permission on return, and
  mirror doc + snapshots + bundle into it on every provenance checkpoint ("🗀 save to
  folder"). Non-Chromium falls back to OPFS + the export download. FSA grant needs a real
  user gesture (not headless-testable) — verify manually in Chrome.
- **Provenance spine M5 — open verifier + /verify: DONE.** `src/verify/index.ts` (pure,
  framework-free): verifyBundle = content integrity (recompute contentHash + bundleHash)
  + signed-chain (per-session prevHash + Ed25519, reuses receipts.ts) + kick consistency
  (each in-S kick's lemma is in that period's SIGNED set) + friction score + OTS existence
  tally. Verifies against the INDEPENDENTLY published key (not the bundle's claimed key).
  `routes/Verify.tsx` + `/verify` (prerendered): drop in a bundle → full report, entirely
  client-side, no login. 55 tests (6 verifier interop tests via the real server core);
  round-trip browser-verified (export → /verify ✓; tampered → ✗). HONEST GAP: full "no
  silent dodging" replay needs per-period content diffs (bundle carries period content
  *hashes* only) — kick-consistency + friction are the current conformance signals; deeper
  per-word replay is a planned extension. Next: M6 (paid cadence tier + billing).
- **Week 4 — Glyphs, dashboard, certification: NOT STARTED.** No `glyphList.ts`,
  `ParagraphGlyphExtension`, `GlyphDashboard`, or certification PDF/QR. Per the v4 spec's
  out-of-scope list these are later/Phase-2; the spine (M2–M6) comes first.

## Major systems added since the spine (2026-06 → 2026-07)

- **Cloud sync + writer-held files.** `storage/onedrive.ts` (Graph API), `storage/gdrive.ts`,
  `storage/folder.ts` (File System Access). All three write the self-contained `.studio` bundle.
  **INVARIANT — snapshot history is grow-only:** every write-back MUST union with the target's
  existing snapshots first (`mergeSnapshots` in `provenance/snapshots.ts`) so a short local set
  (fresh login / cleared data / a save racing ahead of restore) can never TRUNCATE the archive.
  This was a real data-loss incident (2026-07-05). `restoreSnapshotsFromBundle` also unions.
- **Native citations** (replacing Zotero/BBT). `citations/` — `bibProvider` (reactive store),
  real CSL formatting, `CitationNodeView` (in-text purple hooks; reactive via editor.on('update')
  + queueMicrotask), `ReferenceListNodeView` (bibliography). Citation nav (click hook ↔ reference
  back-refs by DOCUMENT page). `pmToText(doc, resolveCitations)` — **must stay byte-deterministic**
  when resolveCitations=false (verify/bundle rely on it); SnapshotView passes true for display.
- **PDF viewer + annotations.** `components/PdfViewer.tsx` — bundled pdf.js (self-hosted wasm/fonts
  in `public/pdfjs/`), lazy per-page render, markup overlays (highlight/underline/strike/text notes
  stored on `_iw.highlights`, NOT baked into the PDF), select-sentence→link-to-citation, cursor-
  anchored zoom, supersampled canvas (≥2× for crispness). `PdfSidePanel` docks side/bottom.
  PDFs stored as OneDrive **sidecars** (`<base>.<citekey>.pdf`, uploaded once) + OPFS; embedded in
  local-folder saves. URL-linked PDFs + the `api/pdf.mjs?proxy=` relay were REMOVED 2026-07-08
  (slow, often blocked, and the one PDF path through our server) — sources embed files only;
  legacy `pdfUrl` metadata is inert. Haiku page-offset
  detection (`citations/pageOffset.ts`). CSP (middleware.ts): `frame-src blob:`, `wasm-unsafe-eval`.
- **Editor chrome.** `Scroll.tsx` — the fixed full-region scroll container is opt-in via the `fill`
  prop (live editor only; SnapshotView reuses `<Scroll>` in-flow inside its split pane — do NOT make
  it fixed there or it covers the diff panel). Solid styled scrollbar + inset `::before` so the fixed
  waves don't bleed over it. `StyleBar.tsx` = the formatting bar (font/size/B/H/align/list/∀).
- **Hybrid zoom (SHIPPED 2026-07-09).** TWO zooms, one owner module `src/editor/magnify.ts`:
  Ctrl/⌘+wheel over the PAGE = font-reflow zoom (`--iw-editor-zoom`, `inkwave:editorZoom`); over the
  WATER (or a page gap) = GPU transform-magnify of the whole page (`--iw-magnify` on a dedicated
  `.iw-magnify-box` wrapper, top-left origin, NO transform at scale 1). Fit-to-width: when the window
  is narrower than the page, the fit scale binds — never a partial page horizontally; it CAPS zoom-in
  and user magnify can go far below (infinite zoom-out). The wrapper is sized to the page's VISUAL
  dims (height set imperatively from a paper RO) so scroll range == visual content exactly.
  **Coordinate convention:** getBoundingClientRect under the transform returns VISUAL px — convert
  via `scaleFor(el)`/`unscale()` from magnify.ts, NEVER ad-hoc reads. Pagination measures in the
  canonical window where magnify is forced to 1, so breaks are magnify-independent by construction.
  Do NOT use CSS `zoom` on the parchment — it inflates clientWidth and breaks the paginator. Phone
  zoom = pinch → the font-reflow pipeline (Scroll.tsx touch handlers); browser-native zoom is
  suppressed app-wide on phone (universal `touch-action: pan-x pan-y` — NB touch-action does NOT
  inherit, hence the `*` rule — + gesture*/two-finger-touchmove preventDefault + 16px input floor).
- **Review layer (IN PROGRESS, branch `feat/review`).** Peter's spec: live suggestion mode (track
  changes on every keystroke, behind a toggle so normal typing is unaffected), comments as sticky
  notes over the wave (not a panel), triggered from the **R** button in the footer toolbar, review
  nav (←/→ + Alt+A accept / Alt+S discard), named annotation sets via a drop-up.
- **Snapshot review** (`routes/SnapshotView.tsx`, `/snapshot`) — split diff (annotated doc + hunk
  panel) with warp physics (finite-range well, WARP_IMPULSE 0.14, snap On/Off, midline locks),
  minimap (wheel + diff ticks + page numbers/logos), position-based swipe scrub + momentum fling
  (multi-touch bails to the pinch — keep that guard), shift-wheel fast scrub, golden-ratio reading
  line, narrow/phone CSS-grid layout, per-version summaries (Haiku, opt-in), LoadingVeil wave
  choreography on open. Grow-only + deterministic pmToText apply here too. The doc pane has GAPPED
  PAGES (2026-07-10): `editor/staticPagination.ts` re-runs the editor's canonical break pipeline
  against the pane's static HTML (forced canonical measure → breaks cached as text-node char
  offsets → the shared `pageGap.ts` widgets + sheet panels inserted post-render; content keyed by
  snapshot.id so the DOM surgery never fights React). Minimap + diff-panel page numbers now come
  from those REAL canonical page regions (the old paper-width×√2 drift is fixed). Scrub diffs are
  cached + read-ahead ±20 in idle time (`provenance/diffCache.ts`) so hard scrubs hit only cache.
  2026-07-10 batch: MIDLINE PAGE SYNC (driver pane's midline crossing a page boundary flies the
  follower to that page — editor→diff unless bijMode 'both'; diff→editor only in 'off'; crossings
  retarget in-flight jumps, nav-settle window suppresses scrub/reposition); doc-pane zoom is a
  fit-capped CSS `zoom` on the PAPER (min(diffZoom, paneFit) — full page always fits the pane;
  phone pinned to 1 = edge-to-edge; staticPagination forces it to 1 in the canonical window +
  converts visual→local px in the band paint); FULL FINAL PAGE (last sheet extends to avg of prior
  ≤5 page regions, sheet min-height grows to cover — recompute's baseline must respect lastMinH or
  the RO ping-pongs; same treatment in PaginationExtension); minimap wheel = exactly 2× the pane.

## Canonical pagination (2026-07-09 — the load-bearing invariant)

Page breaks are CANONICAL: measured in a forced context (paper mm width from `editor/pageModel.ts`,
desktop side margins, `--iw-editor-zoom:1`, `--iw-magnify:1`, font 1.125rem — defeats the phone
×1.25 rule) inside `PaginationExtension.recompute()`'s single-rAF no-paint window
(`editor/canonicalMeasure.ts` does capture→force→restore-exactly), then applied as DOCUMENT-POSITION
break widgets. Same text on page N at every zoom, on phone (which "calculates relative to A4") and
in print. Consequences: live zoom/width changes ONLY repaint panels (`zoom-settled` → stable-set
no-op re-measure + `paint()`); window resize doesn't re-measure breaks at all; phone gap GEOMETRY is
compact fixed 32px (`PHONE_PAGE_MARGIN` — canonical fill-margins don't match phone-reflowed text
heights). Hard-won bugs, do not reintroduce: (a) a child's useLayoutEffect runs BEFORE the parent's
ref attaches on fresh mounts (PageGuides went dark; StrictMode masks it in dev — resolve elements
from your OWN refs); (b) the ResizeObserver must FOLD into the edit debounce, not measure next frame
(it fired the triple-reflow measure one frame after every line-wrapping keystroke); (c) Tiptap's
`update` fires on EVERY updateState incl. unrelated React re-renders — gate reschedules on doc
identity; (d) 'scroll' paper must still measure font-canonically. Citation-label hydration reflows
invisibly to inputSig → bibProvider.subscribe drives a debounced re-measure.

## Wave / water system (2026-07-09)

Water = cyan→aquamarine gradient (`#00b4d8 → #00bfa8`, 98.5°, viewport-fixed). Waves = two 140px
SVG data-URI tiles as vars `--iw-wave-a/b` on the surface (night block re-points them; thick line
on TOP), drawn by `::before`/`::after` (±280px overdraw = exactly two tiles — keep it ≡0 mod 140 or
transform↔background-position handoff tears). States: **anim** (fixed-velocity 72px/s drift,
1.944s/tile loop, phase-synced across surfaces via `__iwWaveEpoch` from the real animation
startTime), **coast** (pure-CSS exact-cubic ease-out `cubic-bezier(1/3,1,2/3,1)` ≡ x(t)=tx₀−d(1−(1−t/T)³),
d=vT/3 so initial velocity = drift velocity: T/d from `--wave-coast-T`/`--wave-coast-dist`, 3s/72px
desktop, 2s/48px phone), **off** (scroll sway via background-position ±`--wave-x` with a persistent
base). Sparkles ride a dedicated child div (opacity independent of the lines). ATOMIC WATER: the
whole water is gated behind `.iw-water-ready` on <html> (entry.client decodes the tile URIs first) —
colour + waves land in one paint; add any NEW tile var to that decode list. LOAD CHOREOGRAPHY: one
persistent shell (Edit.tsx `shellUp`) spans !doc + lazy chunk + pre-reveal; the settle gate fires
`inkwave:reveal-imminent` (coast start) then reveals; open-begin/open-failed re-raise/restore it.
Phone reveal waits for the coast tail. The coast freeze reads the compositor transform (which runs
~2 frames AHEAD of getComputedStyle — compensate) and must NOT start in the same commit as the
reveal (main-thread delay = backward flick). RELIABILITY (2026-07-11, the tri-engine load bug):
per-frame twinkle respawn style writes LIVELOCKED React's time-sliced editor mount (boot never
finished → waves forever) — dash respawns are boot-gated until `inkwave:editor-revealed`, budgeted
4/frame; on phone the shell stays OPAQUE until `wave-rest` with the covered editor z-raised above
it (fading the only water mid-coast exposed bare parchment = the iOS white-out). Every reveal-chain
event has a fallback cap (reveal 1.5s, shell force-down 4s, covered lift 4s) — keep them when
touching the chain. 2026-07-11 round 2: PHONE surfaces are in-flow (only `.iw-fill:not(.is-phone)`
is fixed) — the shell surface must be VIEWPORT-PINNED (fixed, inset 0, z 0 under the z:1 covered
editor) while its wave classes run, or the covered editor's height pushes the shell's gradient box
off-screen = the "goes white" bug (its viewport-fixed pseudos still painted ghost lines); gradient
uses background-attachment: scroll (WebKit's fixed-attachment compositing is flaky). Twinkle art
must be CANVAS-RASTERED PNGs, never per-instance SVG data-URIs — Chromium builds a full
IsolatedSVGDocumentHost per unique URI (~4.3s of boot at ~600 URIs; Firefox is cheap = the engine
asymmetry). The lazy editor chunk is eagerly imported at module scope (browser-only guard) so it
loads in PARALLEL with storage, not after doc-ready. Starved-boot coast: a first-coast-frame check
re-freezes from the drift's extrapolated pose when >150ms late (rebaseCoast) — prevents
full-speed-overlay-then-backward-snap; phone shell drop waits for wave-rest AND paper fade end.
Build marker: Settings footer + console show `__BUILD_COMMIT__` (vite.config.ts). Known residual:
the editor mounts TWICE per load (duplicate reveal events; Tiptap useEditor recreation) — needs
its own pass.

## Open pipeline + cloud caching (2026-07-09)

`storage/openCache.ts`: cloud `.studio` bytes cached in OPFS keyed by change-tag (Graph cTag/eTag,
Drive md5/version), 100MB LRU; cache HITS may only compare TRUSTED tags (fresh listing / live
metadata GET) — a stale listing tag could false-hit and the next sync would clobber the newer
remote. `warmCloudOpen()` (runWhenQuiet) pre-warms tokens/listings/recent bytes; background warm
paths must NEVER call GIS `getDriveToken` — its requestAccessToken opens a real popup window even
for prompt:'none' (Firefox blocks + warns); use `peekDriveToken()`. Parse runs OFF-THREAD
(`parseStudio` op in workers/parseClient.ts — the .studio parse on the main thread was the historic
0.5-1s open freeze); `inkwave:open-doc` carries the parsed doc. Snapshot restore defers its disk
write behind the reveal (write-through `_snapCache` is authoritative in-session; grow-only holds
because every write-back reads through the cache). Library/PDF restore is fire-and-forget AFTER the
reveal. `openPerf.ts` logs one line per open. OneDrive PDF sidecars self-heal: quiet-pass
`fetchMissingSidecars` + on-demand `fetchSidecarFor` in PdfSidePanel (savePdf threw on iOS until the
write shim, so metadata can say a PDF exists with no local bytes).

## iOS / WebKit invariants (2026-07-08/09 — each was a live bug)

- ALL OPFS writes go through `storage/opfsWrite.ts` (WebKit has NO createWritable; worker
  createSyncAccessHandle, serialized — ONE open handle per file or it throws; truncate/flush/close
  awaited for ≤16.x).
- File inputs: NO `accept` extension lists on touch (unregistered UTIs grey out every file).
- `navigator.storage.persist()` on first write (Safari's 7-day eviction); iOS <16.4 (no
  CompressionStream) degrades gracefully + banner.
- touch-action does NOT inherit — per-element, hence the universal phone rule; mid-gesture elements
  that own a drag (SCAS reel) need their own `touch-action:none`.
- iOS auto-zooms (and STAYS zoomed) focusing controls <16px — global 16px floor on phone.
- Phone typing scheduling: pagination re-measure 850ms (1200ms keyboard-up), SCAS tick 250ms,
  autosave 800ms, word count 1s — input latency owns the main thread; `inkwave:perflog=1` for
  on-device numbers.
- Phone SCAS tick is WINDOWED (2026-07-10): the 250ms tick scans/repaints only the tick's
  edit+caret paragraphs (~200× cheaper than O(doc)). INVARIANT: any tick with a DELETION does the
  FULL scan — the engine's vanished-lemma pass needs whole-doc word presence (a window that hides a
  removal ⇒ false lock + phantom snapshot); and the windowed decoration splice is only legal when
  the tick did NOT change SCAS state (a verdict change repaints that lemma doc-wide). Desktop keeps
  the full scan (byte-identical). Word count now runs ONLY while the ◈ panel is open on phone.
- Phone surface touch listeners: touchstart must stay PASSIVE (a non-passive one adds main-thread
  wait to EVERY tap/scroll start); the pinch's non-passive touchmove is attached only while two
  fingers are down (armed inside the second finger's touchstart — early enough to preventDefault
  the first move). Pinch suppression = that preventDefault + gesture events + touch-action.
- iPadOS masquerades as macOS (detect via maxTouchPoints); GIS popups need pre-loaded clients so
  requestAccessToken runs inside the tap's transient activation.

## Working model (how these sessions run)

Peter tests live on iPhone + desktop and reports in batches; work is delegated to parallel
isolated-worktree agents with precise briefs (root-cause first, no half-fixes), merged serially into
master from `/root/dev/Inkwave-perf` (Peter's own sessions use `/root/dev/Inkwave` — NEVER share a
checkout) with the full gate: typecheck (ignore pre-existing TS7016/TS2550 in test files), ALL tests,
build (gate on real exit codes — `| tail` swallows failures), then push (= production deploy).
Snapshot React state is METADATA-ONLY (`SnapshotMeta`; fetch full snapshots via `listSnapshots` at
action time — never hold contentJson in state). Autosave failures dispatch `inkwave:save-failed`.

**Standing preferences (Peter, 2026-07-10):**
- **No browser windows over Peter's screen.** Agents running HEADED browsers (Playwright probes
  that need GPU/compositor accuracy) must never pop a window over his workspace: use
  `xvfb-run` (virtual display — headed semantics, zero visible window) as the default, or launch
  args `--window-position=-32000,-32000` as fallback. WSLg GOTCHA: xvfb-run alone does NOT contain
  Firefox — WAYLAND_DISPLAY routes it to the host compositor; use
  `env -u WAYLAND_DISPLAY MOZ_ENABLE_WAYLAND=0 xvfb-run …`. SHARED-BOX RULE: never `pkill -f
  "vite preview"` (it kills OTHER agents' servers — caused a phantom 'editor won't mount'); use a
  dedicated port + kill your own PID only. Headless remains the default where fidelity
  allows. Agent briefs that ask for headed runs must say this.
- **Notifier (task #27, pending):** final reports start with the sentinel "📋 REPORT" so Peter's
  PowerShell hook can either FILTER to reports only, or keep all toasts but play a DIFFERENT SOUND
  for report messages (his preferred option) — audibly distinct without looking. RATIONALE (Peter):
  best of both worlds — when he's focused on development he keeps feeding agents on the ordinary
  toasts; when he's focused elsewhere (writing) he responds only to the significant sound. The
  two-tier cadence is the general model for working with him. Until the hook is updated, keep
  interim turns content-free anyway.
- **Batch the reporting — protect Peter's focus.** He writes (thesis/essays) while agents run;
  every notification breaks his concentration. Do NOT ping per-merge: merge each through the full
  gate as it lands with a bare non-message turn-ending, and send ONE consolidated report when ALL
  agents are done. Default to the quietest possible cadence unless he's actively testing.
- **Keep agents alive with their memories intact — always.** Never discard an agent's context:
  resume completed/failed agents via SendMessage (their transcripts restore full context) instead of
  spawning fresh ones for follow-ups in the same domain; salvage worktrees + transcripts when an
  agent dies (spend limits, filters); preserve agent worktrees until their work is merged.

## Theming / colour schemes (MANDATORY for every new panel — 2026-07-07)

Night mode (and future colour schemes) is driven by ONE switch: `src/editor/theme.ts` sets
`<html data-theme="night">` (applied pre-hydration in `entry.client.tsx`; toggled from Settings). All
colours live as CSS custom properties in the **NIGHT MODE block at the bottom of `src/styles/index.css`**
— never scatter per-component night overrides. Adding a new scheme later = one more `:root[data-theme="…"]`
block; components don't change.

**THE RULE — every floating panel/menu/modal MUST:**
1. Put `iw-nightable` on its outer container (alongside its `bg-white`/`shadow` classes). That class opts
   it into the themed surface: dolphin-grey background, light text, themed inputs/borders, dark hover
   fills — all automatic. This is the single most important step; a panel without it renders white-on-
   white in night mode.
2. For any CUSTOM inline colour, use a theme **token var with a day fallback**, NOT a hard-coded hex:
   - `var(--iw-ink, #5c2d8a)` — primary purple text/icons
   - `var(--iw-light, #9b5ccc)` — lighter purple accent
   - `var(--iw-cite-color, #5c2d8a)` — citation/link colour (light blue in night)
   - `var(--iw-pill-fg, #78716c)` — muted label/pill text
   - `var(--iw-nightable-border, …)` — inline borders (light in night)
   - `var(--iw-verified, #15803d)`, `var(--iw-newbtn-fg, …)`, `var(--iw-addbtn-*)` — specific accents
   Define a NEW token in the night block when you need a new custom colour — don't inline a night hex.
3. The `.iw-nightable` block already remaps Tailwind `text-stone*/gray*/neutral*`, `bg-white`,
   `border-stone*`, `hover:bg-stone-50/100`, inputs/selects, and any `[class*="5c2d8a"]`/`[class*="9b5ccc"]`
   arbitrary purple class. So plain Tailwind utility panels theme themselves once they have `iw-nightable`.

Panels already migrated: CitationPanel + EditDialog, ReceiptPanel, SyncStatus, footer toolbar,
OptionsMenu (+ its export modal), SettingsMenu, PageMenu, LimitSelector, StyleBar popups, ReviewBar,
VerifyModal, AccountControl, the Google-Drive/OneDrive pickers + openers, the PDF find bar. When you add a
panel, add it here too.

## Load performance (KEEP STARTUP FAST — hard-won, 2026-07-06)

A big doc (thesis + embedded PDFs, ~20 MB `.studio`) was lagging ~10s on every load / hard refresh.
Root causes were NOT file size — they were background work on the critical path. What was wrong + the
rule that keeps it fast (measure with a `PerformanceObserver` `longtask` logger + `performance.now()`
timers; the main thread only blocks ~1.5s now):

- **Clerk loaded on every free-tier page.** Its dev-instance init (network handshake + hidden iframe +
  token polling) churned for seconds. M6 auth is dormant, so `authEnabled()` now requires an explicit
  sticky opt-in (`?auth`; `?auth=off` clears) and `entry.client` only mounts `ClerkProvider` then. Do
  NOT mount auth for the free tier. See `src/auth/config.ts`.
- **OTS sweep ran on every load (~10s).** `drainUnstamped` + `upgradePending` re-write the compressed
  snapshot file PER snapshot and do serial calendar round-trips. Bitcoin confirms over HOURS, so this
  must NOT run on load — it runs only when the ReceiptPanel OPENS (`onOpened` → `runOtsSweep`), only if
  something is unstamped/pending, throttled once per 15 min (`inkwave:otsCheckedAt:<docId>`). New
  snapshots still stamp on creation; "check Bitcoin" forces it.
- **Multi-device heartbeat read+JSON-parsed the whole 20 MB file** on load AND every 45s. Now
  `readLocalHeartbeat` compares the File's `lastModified` to our recorded last write — metadata only,
  and (2026-07-08) `readRemoteHeartbeat` does the same via a Graph metadata GET (`getRemoteFileInfo`),
  no content read.
- **`blobToBase64` built a 20 MB string + `btoa` on the main thread** every save. Now native
  `FileReader.readAsDataURL` (off-thread) + a per-PDF base64 cache keyed by `pdfVersion` (bumped on
  save/delete), so unchanged PDFs are never re-encoded.
- **The grow-only snapshot union re-read the whole file on every write-back.** Now once per session per
  target (`needsWritebackMerge`/`markWritebackMerged` in `snapshots.ts`).
- **DON'T lazy-defer the snapshot LIST.** Rapid snapshot scrubbing is a core moat, so `listSnapshots`
  loads EAGERLY on doc open (deferring it made the first snapshot open lag). Only defer/gate the
  genuinely-not-needed-for-first-frame work (OTS), never the list.

Rule of thumb: nothing that reads/parses/encodes the whole `.studio` or hits the network per-snapshot
may run synchronously on load. Stamp on creation, sweep on demand, cache encodes, read metadata not
bodies.

## Code map

```
app/                                   # React Router v7 framework layer (thin; imports from src/)
  root.tsx                             # document shell (<html>/<head>), <Meta>/<Links>, fonts, global CSS
  routes.ts                            # route config: index('routes/home.tsx') + 'about'
  routes/home.tsx                      # '/' = the editor (renders <Edit/>) + SEO meta()
  routes/about.tsx                     # '/about'
  entry.client.tsx                     # hydrateRoot + service-worker registration + build marker
src/
  routes/Edit.tsx                      # loads/creates the active doc; renders the shell until it loads
  editor/Scroll.tsx                    # shared scroll-paper chrome + EmptyEditorSurface facsimile (CSS-function shell)
  types/document.ts                    # InkwaveDocument, Snapshot, ProvenanceEvent types
  editor/
    TiptapEditor.tsx                   # editor surface, scroll-head chrome, footer, prefetch
    extensions/RedHighlightExtension.ts# PM plugin: red decorations + hint badges + line compression
    suggestions/
      thesaurus.ts                     # Datamuse lookups, in-memory cache, form-matching (sp=)
      textMetrics.ts                   # canvas text measurement
      CycleHintPanel.tsx               # the j/k/space/tab/esc hint strip
      ThesaurusPopover/                # the word-cycle UI (split into focused modules)
        ThesaurusPopover.tsx           #   events (keyboard, pointer, outside-tap) + render
        usePopoverLayout.ts            #   cycle state + openCycleForElement + compression dispatch
        popoverGeometry.ts             #   posOf, measureNaturalLineRight, computeLineCompressionRange
        popoverFallbacks.tsx           #   buildSynonyms, displayFor (⌫)
        popoverConstants.ts            #   CYCLE_SIZE=8, DELETE_SENTINEL, CycleState type
  scas/
    stems.ts                           # getStems — candidate base forms (all that survives of ranking.ts)
    compliance.ts                      # accepted/(accepted+ignored) ratio, React context
  data/wordFrequency.ts                # ~30k-word Norvig/Google list (one big string[])
  storage/
    opfs.ts                            # document persistence (OPFS)
    indexeddb.ts                       # {id,title,updatedAt} metadata index for fast listing
  components/LimitSelector.tsx         # the N selector (500–5000 or infinite)
```

## Non-obvious conventions & invariants (READ BEFORE EDITING)

- **SCAS must never retroactively re-flag committed text.** In the engine model
  (`scas/engine.ts` — the Week-2 per-paragraph `ranking.ts` vocab model was deleted 2026-07-08,
  only `getStems` survives in `scas/stems.ts`): verdicts FREEZE at commit, so S_v rotation never
  reflows committed text; delete a kicked word → it locks. This is the single most important
  behavioural invariant — preserve it.
- **Enter = new paragraph; Shift+Enter = hard break.** Standard Tiptap/StarterKit
  behaviour (the inverted `enterBehavior` extension was removed so paragraph spacing works
  on Enter-separated text, not only pasted content).
- **The word-cycle replaced the original dropdown popover.** Don't reintroduce a dropdown.
  Cycle slots: index 0 = the original word, 1–6 = synonyms (cycled if Datamuse returns
  fewer), 7 = ⌫ delete sentinel. j decrements index, k increments; current sits in the
  middle row, prev above, next below.
- **No vocabulary filter is applied to suggestions** — all Datamuse candidates are shown
  and the writer decides fit (a deliberate Stage A decision).
- **Line compression** (`computeLineCompressionRange`) tightens letter-spacing around a
  focused word to absorb its min-width expansion *in place*, so the popover doesn't reflow
  the paragraph. This is fiddly, pixel-measured, and has had many regression fixes — change
  it carefully and test wrapped lines + first-word-on-line cases.
- **Provenance events** funnel through `compliance.ts` (accept/ignore). (The unused
  `appendEventLog` stub was deleted 2026-07-08; the provenance record is snapshots +
  signed receipts.)
- **Document IDs are stable UUIDs** — they become room identifiers in the future room
  model (Phase 2+). Don't change the ID scheme.
- **Tests exist and must pass** — `pnpm test` runs ~35 vitest files (~400 tests) covering
  scas engine/pool/stems, provenance (hash/receipts/cadence/session-auth), verify, and
  citations. UI/storage/sync are the untested areas — extract logic there before relying on it.

## Style

Match the surrounding code: terse purposeful comments explaining *why*, section dividers
(`// ─── … ───`), single-responsibility modules. Calm visual identity: ink/purple
(`#5c2d8a` / `#9b5ccc`), parchment/cream, serif body (IM Fell DW Pica / EB Garamond).
Commit messages: `feat:` / `fix:` / `refactor:` prefixes, present tense.
