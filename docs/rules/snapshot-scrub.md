<!-- Area rules. CLAUDE.md routes here; it does not repeat this. Narrative + measurements: docs/archive/. -->

## /snapshot — snapshot review and the scrub

The moat, heavily tuned. 15 rounds incl. every refuted hypothesis:
`docs/archive/snapshot-scrub-rounds.md`. Read the round that owns your area first.

- **Never make `<Scroll>` `fill` on this route.**
- **Hidden keep-alive layers use `opacity: 0.001`** — never `0`, `visibility` or `display`.
- **A `DocLayer` binds the shared refs in a CHILD layout effect**, and **`DocLayer.run()` must clear
  its deferred warm timer.**
- **Detect rapid scrubbing from the INPUT EVENT's own `timeStamp`, never from `goTo` spacing.**
- **Clear `liveSnapId` ONLY in the catch-up effect once `urlSnapId` matches.**
- **A plain flick steps exactly ONE version**; the position scrubber arms only after a ~280ms
  mostly-still hold, checked at decisive-move time. **Slide LEFT = next, RIGHT = previous.**
  Multi-touch bails to the pinch — keep that guard.
- **`MAX_PER_FRAME = 1`**, **`LAND_QUIET_MS = 260`**, **`FREEZE_HOLD = 400`**, **`RASTER_DPR_CAP = 1`.**
- **`show()` blits into ONE persistent per-pane canvas.**
- **Lay offscreen replica capture hosts IN FLOW and mirror the real host's `position`** — an
  absolutely-positioned host rasterises outside the crop, returns blank, and stalls the sweep forever.
- **`getAnchorTop(scroller, snapId)` resolves the anchor in the TARGET VERSION'S OWN layout** — exact
  text match → surviving NEIGHBOUR (`provenance/anchorMap.ts`) → ratio, never the top. Never prime a
  warm layer with the active pane's raw `scrollTop`.
- **Judge registration by DRIFT IN PX, not the `registered` line-open metric** (which cannot reach 1.0).
- **A doc-pane thumbnail is a picture at a scrollTop**, so its signature carries `|a1`. **Thumbnails
  NEVER travel with the `.studio`** — local OPFS cache, regenerable.
- **No component of a persisted cache signature may be a counter since page load** — use
  content-derived state (`bibSignature()`), memoised BY the epoch.
- **Anything putting the bibliography in a persisted key must `await libraryReady()`**, or it bakes an
  empty-library key that misses forever, silently.
- **Header +N/−N badges read `peekOpsBetween` (CACHE-ONLY) and BLANK with `visibility` on a miss.**
- **Feature flags resolve ONCE per load into localStorage; a DEBUG flag lives in sessionStorage** —
  local-first nav rewrites the URL every scrub step.
- **The doc pane renders RICH formatted pages for every version** (`RichDiffView`, default ON). A run
  is a SLICE of an op, never a new op: same `diff-add`/`diff-del` classes, same `data-opidx`.
- Grow-only snapshots and byte-deterministic `pmToText` apply here as everywhere.

