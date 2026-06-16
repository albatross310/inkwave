# Inkwave Scroll — Refactor, Code-Shortening & Performance Report

**Date:** 2026-06-17 · **Target:** `master` @ `b533545` · **Scope:** whole `src/` + `app/` + `api/` (security explicitly out of scope — see `SECURITY-AUDIT-2026-06.md` for that).

**Method:** four parallel reviewers over distinct areas — (1) editor + SCAS hot path, (2) provenance/crypto spine, (3) storage/sync/data, (4) app-shell/build/api structure — each tracing findings to `file:line`. No code modified. Estimated LOC figures are removals/dedup, not rewrites.

---

## Executive summary

The codebase is in good shape: clean module boundaries, the heavy server deps are correctly confined to `api/*.mjs`, routes are auto-split, and the fragile bits (line compression, SCAS invariant) are well-commented. The biggest opportunities cluster into **four themes**:

1. **Dead weight on startup.** `src/scas/ranking.ts` is ~85% dead code — including a 30,000-entry `Map` (`RANK_MAP`) and the `FULL_VOCAB` Proxy that are built at module load but never read on the live path. The 326 KB word-frequency list ships eagerly in the landing/editor chunk. Together these are the largest initial-load and cold-start costs, and the cheapest to remove.
2. **Per-keystroke CPU.** The decoration pass re-lemmatizes every word in the document on every keystroke via an uncached `lemmaOf`/`getStems` (~20 regex tests + a Set alloc per word). Memoizing it is a one-line, invariant-safe order-of-magnitude win.
3. **Two big duplication seams.** The JCS canonicalizer + hash + byte-codecs are reimplemented client-side (TS) and server-side (`.mjs`) and kept in sync *by comment*; and `onedrive.ts`/`gdrive.ts` are near-mirror cloud providers. Both are prime extraction targets (~250+ LOC and a whole class of drift bugs).
4. **Two oversized files.** `TiptapEditor.tsx` (~1,200 lines) and `OptionsMenu.tsx` carry inline cloud-sync orchestration that belongs in a `useCloudSync` hook.

### Top 10 actions by impact

| # | Action | Type | Impact |
|---|--------|------|--------|
| 1 | Delete dead `src/scas/ranking.ts` (keep only `getStems`) | Shorten + perf | ~190 LOC; kills 30k-Map + Proxy at startup |
| 2 | Memoize `lemmaOf` (surface→lemma `Map`) | Perf | order-of-magnitude per-keystroke CPU cut |
| 3 | Move 326 KB word list out of the JS bundle + lazy-load | Bundle/perf | ~326 KB off `/` critical path |
| 4 | `React.lazy` the Tiptap editor behind the existing shell | Bundle/perf | largest single initial-JS win |
| 5 | Extract `useCloudSync` from `TiptapEditor.tsx` | Refactor | ~150 LOC; file 1,200→~700 |
| 6 | Shared JCS/hash/codec ESM module (client+server) | Refactor + correctness | ~80 LOC; removes silent-break risk |
| 7 | `CloudProvider` adapter unifying onedrive/gdrive | Refactor | ~120–180 LOC |
| 8 | Cache SCAS `lookup()` on the controller by state identity | Perf | removes 3 Set allocs/pass |
| 9 | `withHandler()`/`jsonPost()` helper for `api/*.mjs` | Refactor | ~55–70 LOC across 8 handlers |
| 10 | Fix O(n²) OPFS append + snapshot drain loops | Perf | O(n²)→O(n) on long sessions |

---

## Part 1 — Performance

### Hot path (per-keystroke) — these matter most

**P1. `lemmaOf`/`getStems` is uncached and runs for every word, every keystroke. (highest impact)**
`RedHighlightExtension.ts:158` (`buildDecorations`) and `controller.ts:63-64` (`scanCommitted`) both walk every word in the document calling `engine.ts:48 lemmaOf` → `ranking.ts:110 getStems`, which allocates a Set and runs ~25 `endsWith` checks per call. A 1,000-word doc ≈ 2,000+ identical recomputations per keystroke.
→ **Fix:** module-level `Map<string,string>` memo at the top of `lemmaOf` (pure function, safe). Cuts the dominant per-keystroke cost ~10×. Invariant-safe (does not change verdicts).

**P2. Decoration set rebuilt from scratch each keystroke.**
`RedHighlightExtension.ts:86-90` (`apply`) returns a fresh `DecorationSet.create` over the *entire* doc on every `docChanged`, never using `old.map(tr.mapping, tr.doc)` to shift unaffected decorations.
→ **Fix:** map the prior set through `tr.mapping` and recompute only the changed paragraph(s). P1's memo already makes the full walk cheap; the incremental map is the deeper win for very long docs. **Caution:** the focused-word/compression/slide decorations (`:188-281`) are cursor-dependent — keep them out of the mapped/cached portion; test against the reflow animations (invariant 2).

**P3. `buildLookup` allocates 3 Sets per pass; `lookup()` called many times per render.**
`controller.ts:118 lookup()` → `state.ts:61 buildLookup` rebuilds `new Set(locked)`, `new Set(liveKicks)`, immune set every call even when `state` is unchanged. `TiptapEditor.tsx:1005` builds a whole lookup just to answer one `.has`.
→ **Fix:** cache the lookup on the controller, invalidated on `this.state` identity change (transitions already return new state objects, so identity is exact). Invariant-safe.

**P4. Per-character `getBoundingClientRect` in the popover geometry (layout thrash).**
`popoverGeometry.ts:22-26, 48-52, 87-96` walk every char on the line calling `range.getBoundingClientRect()` per character, on open/commit/close/resize/scroll. Likely the main source of jank when cycling while scrolling on touch.
→ **Fix:** use `range.getClientRects()` once per text node (per-line-fragment rects) or binary-search the line-end char; keep the per-char path as a fallback. **High caution — invariant 2** (the fragile pixel-measured compression path): refactor structurally, preserve exact arithmetic, verify visually.

**P5. Redundant scroll listeners while a cycle is open.**
`usePopoverLayout.ts:46` (forceUpdate) and `ThesaurusPopover.tsx:541` (geomNonce) both re-measure on scroll — one scroll triggers multiple re-renders, each re-running P4's measurement.
→ **Fix:** collapse to one subscription and rAF-throttle the geometry recompute (`Scroll.tsx:47` already throttles; the popover doesn't).

**P6. `onTransaction` does full-doc work per keystroke.**
`TiptapEditor.tsx:262-264` calls `e.getJSON()` + `e.getText()` each keystroke; `deriveTitle(e.getText())` walks the whole doc for a title that only depends on the first line; a separate word-count effect (`:397-403`) calls `getText()` again.
→ **Fix:** `deriveTitle` reads `e.state.doc.firstChild?.textContent`; debounce the word-count `getText()`.

**P7. `prefetchSynonyms` DOM-scans all `.scas-red` 600 ms after every keystroke** (`TiptapEditor.tsx:277-283`). Pure overhead since the red-word set rarely changes between pauses.
→ **Fix:** compare against a snapshot Set before scanning, or lengthen the debounce. Low.

### Startup / bundle

**P8. The 326 KB word-frequency list ships in the landing chunk and is parsed eagerly. (biggest load win)**
`src/data/wordFrequency.ts:4` is a single 325,785-char JS *array literal* (30k tokens → 30k AST nodes; far slower to parse than `JSON.parse` of the same bytes). Imported statically by `scas/pool.ts:13` (and previously `ranking.ts:7`) → editor → `app/routes/home.tsx` (the index route). On eval it triggers ~4–5 full O(30k) passes: `POOL`, `POOL_SET`, `POOL_INDEX`, `POOL_ID = fnv1aHex(POOL.join(','))`, and `RANK_MAP` (the dead one — see R1).
→ **Fix (in order):** (a) move to `wordFrequency.json` / newline `.txt` and load via dynamic `import()`/`fetch` only when SCAS first needs it (infinite-mode sessions never pay); (b) if it must stay inlined, `JSON.parse('[...]')` for V8's fast path; (c) make `POOL*` lazy memoized getters so nothing builds at import. Removes ~326 KB (~80–120 KB gzip) from the critical path + the eager passes.

**P9. Tiptap/ProseMirror is eager in the landing chunk.**
`home.tsx` → `Edit.tsx:3` → `TiptapEditor.tsx` statically pulls `@tiptap/*` + `@tiptap/pm` (hundreds of KB), even though the prerendered `EmptyEditorSurface` shell is what paints first.
→ **Fix:** `const TiptapEditor = React.lazy(() => import('../editor/TiptapEditor'))`, mounted after `doc` loads. `Edit.tsx:97-107` is already shell-then-editor — only the import needs to go dynamic. Largest single initial-JS win.

**P10. Confirmed already-good (no action):** RRv7 per-route code-splitting; the dependency-free OTS walker (`src/verify/ots.ts`) isolated to the `/verify` chunk; Clerk dynamic-imported (`entry.client.tsx:14-17`); MSAL lazy (`onedrive.ts:98`); `stripe`/`supabase`/`svix`/`puppeteer`/`chromium`/`javascript-opentimestamps` confined to `api/*.mjs`.

### Storage / persistence

**P11. O(n²) OPFS event-log append.** `opfs.ts:130-153 appendEventLog` reads the whole `events.jsonl` and rewrites `existing + line` every call (comment admits it).
→ **Fix:** write at `position: file.size` with `{ keepExistingData: true }`, or a long-lived `createSyncAccessHandle` in a worker. O(file)→O(1) per append.

**P12. O(n²) snapshot drain/upgrade sweeps.** `snapshots.ts:33 writeSnapshotsFile` rewrites the whole array (each snapshot carries full `contentJson`); `drainUnstamped`/`upgradePending` (`:130-149`) do this in a loop → N rewrites of an N-element array.
→ **Fix:** batch each loop into a single read + in-place patch + single write. O(n²)→O(n).

**P13. Autosave rewrites the entire doc every 200 ms of typing.** `opfs.ts:117 scheduleSave` → `JSON.stringify(doc)` including `scasReceipts` (which also live in `snapshots.json`).
→ **Fix:** skip the write when `contentJson` reference is unchanged; don't embed receipts in `current.json`.

**P14. Cloud checkpoint re-reads + re-serializes 2–3×.** `mirrorIfActive()` (`TiptapEditor.tsx:519`) calls `listSnapshots()` (full OPFS read+parse) separately for folder (`:521`) and gdrive (`:529`), and rebuilds the `ExportBundle` per destination. OneDrive is throttled (`:538`); folder + gdrive are not.
→ **Fix:** read snapshots once and build the serialized bundle once per checkpoint; apply the OneDrive trailing-throttle to folder + gdrive.

### Cold-path (provenance/verify) — real but only on export/verify

**P15. Verify re-canonicalizes the same receipts O(snapshots×receipts) times.** `verify/index.ts:88` and `:97` canonicalize every receipt, and each snapshot re-canonicalizes the chain-so-far it embeds.
→ **Fix:** memoize `canonicalize` via a `WeakMap<object,string>` threaded through the verify pass (also covers `bitmaskToLemmas` rebuilt per receipt at `:125`, and the double-canonicalize in `verifyChain`). O(S·R)→O(R) — the only verify change with real algorithmic payoff on big bundles.

**P16. Serial Ed25519 verify.** `receipts.ts:117-124 verifyChain` awaits `ed.verifyAsync` per receipt in sequence; only the chain-link checks (counter/prevHash/chainHash) actually need to be sequential.
→ **Fix:** run the link checks sequentially, the signature verifications via `Promise.all`. Browser-side latency win on long chains (bounded by noble being single-threaded JS).

**P17. Micro-opts (flagged, low priority):** `deriveBitmask` full-sorts a 4,500-element pool per `/api/session|sign` where quickselect would do (`_provenance-core.mjs:81-85`); client hashes are all `async`/awaited though data is tiny (`hash.ts:53`) — switching to noble's sync sha256 removes the await ceremony *and* unlocks the shared-module refactor (R6).

---

## Part 2 — Refactor / code-shortening

### Dead code (pure deletions)

**R1. `src/scas/ranking.ts` is ~85% dead. (biggest single LOC win)** Grep confirms only `getStems` is imported elsewhere (by `engine.ts:14`). Dead: `getActiveVocab`, `isInVocab`, `clearRankCacheFrom`, `RANK_MAP` (30k-entry Map built at every module load), `FULL_VOCAB` (the Proxy), `rankCache`, `mulberry32`, `hashSeed`, `cacheKey`, `RARE_THRESHOLD`.
→ Move `getStems` into `engine.ts` (or `stems.ts`) and **delete `ranking.ts`**. ~190 LOC + removes the 30k-Map and Proxy from startup. Note the CLAUDE.md "infinite-mode FULL_VOCAB Proxy" and "clearRankCacheFrom invariant" notes describe this now-dead module — the *live* SCAS keying is via `scasSessionSeed`/`deriveSet` in the engine, so invariant 1 is unaffected. Update CLAUDE.md after deleting.

**R2. Minor dead/debug code.** `RedHighlightExtension.ts:8-20 debugHighlightAll` (+ `?debughl`, self-labelled "TEMPORARY") → gate behind `import.meta.env.DEV`. `ThesaurusPopover.tsx:355` empty `onWheel` registered non-passive (`:499`) → remove. `DELETE_SENTINEL`/`displayFor` ⌫ branch (`popoverConstants.ts:2`, `popoverFallbacks.tsx:6-12`) appears orphaned now that deletion is double-tap — verify and remove (~15 LOC). `bundle.ts:139-160 bundleReadme` describes the pre-M4 multi-file layout — verify unused and delete (~30 LOC).

### Duplication (the two big seams)

**R3. Client↔server crypto is reimplemented and kept in sync by comment. (highest correctness value)** The JCS canonicalizer is implemented twice and *must* stay byte-identical or every signature breaks:
- `provenance/hash.ts:19-39` (`serialize`) ↔ `api/_provenance-core.mjs:50-61` (`canonicalize`).

Plus the byte codecs reimplemented 3+ times: `fromHex` in `receipts.ts:34-38`, `_provenance-core.mjs:26`, `verify/ots.ts:38-43`; `toHex` in `hash.ts:45-50`, `_provenance-core.mjs:25`, `verify/ots.ts:33-37`; `fromBase64` in `receipts.ts:39-44` and `verify/ots.ts:58-63` (identical `atob` loop). `countWords` is verbatim in three files (`snapshots.ts:56-67`, `bundle.ts:85-96`, `verify/index.ts:67-78`). `mulberry32`/FNV-1a appear 3× each.
→ **Fix:** extract dependency-free ESM modules — `shared/jcs.mjs` (canonicalize), `shared/bytes.mjs` (hex/base64), `shared/hashes.mjs` (domain hashes: `bundleHash`, `lockedSetHash`, `kicksHash`) — imported unchanged by both the Vite client and the serverless functions. ~80 LOC removed and, more importantly, the byte-for-byte agreement becomes *structural* instead of aspirational. **Guard with a cross-implementation golden-vector test** (existing `hash.test.ts`/`receipts.test.ts` are the foundation) before deleting either copy. `countWords`: just import the existing `snapshots.ts` export (~24 LOC).

**R4. `onedrive.ts` (315 L) and `gdrive.ts` (260 L) are near-mirror cloud providers.** Duplicated: `ensureExt` (verbatim, `onedrive.ts:292`/`gdrive.ts:92`), per-doc filename localStorage (`onedrive.ts:43-50`/`gdrive.ts:91-99`), `renameXFile`, `syncToX` (identical but the upload call), the `SyncResult` interface (declared twice). The orchestration in `TiptapEditor.tsx:555-744` carries two parallel copies of "sign in → sync → set active → deactivate the other."
→ **Fix:** a `CloudProvider` interface —
```ts
interface CloudProvider {
  id: 'gdrive' | 'onedrive'
  configured(): boolean
  signIn(): Promise<boolean>
  sync(doc, snaps): Promise<SyncResult>
  rename(doc, name): Promise<boolean>
  listFolders(parentId): Promise<DriveFolder[]>
  listFiles(parentId): Promise<DriveFile[]>
  download(ref): Promise<string | null>
  adopt(docId, ref): void
}
```
with shared `cloud/common.ts` (`SyncResult`, `ensureExt`, filename helpers, the `composeTraceFile(buildExportBundle(...))` + `setDocSource` wrapper). `TiptapEditor` iterates a `providers[]` array. ~120–180 LOC across the storage modules + collapses the duplicated pickers/openers in `src/components`.

### Oversized files

**R5. `TiptapEditor.tsx` (~1,200 L) — extract the cloud-sync layer.** Lines ~500-744 (`saveRecord`, `mirrorIfActive`, `syncOneDrive`/`syncGoogleDrive`, `saveAsX`, `chooseXFolder`, `uploadFromX`, the resume effects, throttle refs) are ~250 lines of self-contained sync.
→ **Fix:** `useCloudSync(docRef)` hook (built on the R4 adapter) returning the sync actions + UI state. The file drops to ~700 lines focused on SCAS + editing; the `SyncStatus` IIFE (`:1027-1084`) moves with it. ~150 LOC saved via dedup.

**R6. `OptionsMenu.tsx` — collapse prop-drilling.** Takes ~20 props, ~15 forwarded verbatim to `SavePanel` (`:219`).
→ **Fix:** bundle the save/sync callbacks into one `cloudActions` object prop (pairs with R5's hook return); move the panels and mini-SVG logos to `OptionsMenu/` siblings. ~40 LOC + much less churn at the call site (`TiptapEditor.tsx:1161-1181`).

### API handler boilerplate

**R7. `withHandler()`/`jsonPost()` for `api/*.mjs`.** Eight handlers repeat method-check → parse body → JSON header → call core → `res.end(JSON.stringify())` → catch → status-from-message → envelope. The `'Method Not Allowed'` string is in 10 files; the status ternary (`'bad request'?400:'invalid session'?401:'subscription required'?402`) is duplicated in `sign.mjs:16-17`, `ots.mjs:20`, `session.mjs:14`; the `typeof req.body === 'object' … : JSON.parse(req.body||'{}')` line is copy-pasted in `ots.mjs:15`/`sign.mjs:11`/`session.mjs:10`.
→ **Fix:** one `api/_handler.mjs` exporting `jsonPost(core, opts)` (and a sibling for the authed `{status,body}` handlers). `sign.mjs` collapses 19→~3 lines. ~55–70 LOC across `ots/sign/session/sync-profile/stripe-checkout/paypal-subscribe/me/pubkey`, with the status map in one place.

**R8. Dedup `readRawBody`.** `stripe-webhook.mjs:13-20` and `paypal-webhook.mjs:14-21` define an identical `readRawBody`; `pdf.mjs:103-107` a near-identical variant; `vite.config.ts:61-65` a fourth. → one shared helper + a `withRawWebhook(verify, handle)` wrapper. ~20–25 LOC.

**R9. `vite.config.ts` dev-API middleware duplicates the prod handlers.** `vite.config.ts:9-99` re-implements routing/method-checks/raw-body/JSON-envelope for every `/api/*` route — a second source of truth (note the status mapping at `:92-93` duplicating `sign.mjs:16-17`). Since each prod handler already exports a standard `(req,res)` default, the dev middleware can become a loop mounting `mod.default` (as `webhook()` at `:61` already does). ~40–50 LOC + kills the dev/prod drift bug class.

### Smaller items

- **R10.** Shared word-scanning iterator: the `paragraph→child→WORD_RE.exec→skip-under-cursor` loop is duplicated in `RedHighlightExtension.ts:132-170` and `controller.ts:42-75` (same `WORD_RE`, boundary regex, length<2 skip) — the comments stress "must match the renderer," which is exactly the drift risk. Extract `forEachCommittedWord(pmDoc, cursorPos, cb)`. ~40 LOC + correctness coupling removed.
- **R11.** IndexedDB boilerplate: `folder.ts:16-49` and `indexeddb.ts:11-77` hand-roll the same request→Promise open/txn wrapping. Extract `idbKv(dbName, store) → {get,set,del,getAll}`. ~40–60 LOC.
- **R12.** Drop `uuid` + `@types/uuid` for `crypto.randomUUID()` (only user `Edit.tsx:2`); verify/drop `isbot` (SSR-only, `ssr:false`). `ReceiptPanel.tsx:97` `[...snapshots].reverse()` per render → `useMemo`.

---

## Suggested sequencing

1. **Deletions first (zero risk, immediate):** R1 (ranking.ts), R2 (debug code), R8/countWords, R12. ~250+ LOC and the 30k-Map startup cost gone.
2. **Per-keystroke perf (cheap, high value):** P1 (memoize `lemmaOf`), P3 (cache `lookup`), P6 (deriveTitle). Mostly one-liners, invariant-safe.
3. **Bundle:** P8 (word list → data + lazy) and P9 (`React.lazy` editor) — the two big initial-load wins; P8 is cleaner once R1 removes the other importer.
4. **Structural dedup:** R3 (shared crypto module, golden-vector test first), R4+R5 (cloud adapter + `useCloudSync`), R7/R9 (api handler + dev-middleware).
5. **Heavier perf:** P2 (incremental decorations) and P4 (popover geometry) — touch invariants 1/2; refactor structurally, preserve exact behavior, verify visually.
6. **Storage:** P11/P12 (O(n²) appends/sweeps), P14 (single checkpoint read).
7. **Cold-path (only if export/verify feels slow):** P15 (memoize canonicalize), P16 (parallel verify).

**Respect throughout:** R3 and P2/P4 touch hash-committed bytes / the fragile pixel-measured compression path. Keep golden-vector and visual regression coverage before/after. Net estimated shortening across all items: **~700–800 LOC** plus the elimination of three duplicated source-of-truth classes (client/server canonicalization, dev/prod handler wiring, the two sync providers).

*Review performed 2026-06-17 against `master` @ `b533545`. Static read only; LOC estimates are dedup/removal, not net of new helper code.*
