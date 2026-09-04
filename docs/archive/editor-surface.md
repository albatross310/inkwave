# The editor surface — the stories behind the rules

The **why** for `src/editor/TiptapEditor.tsx`, `Scroll.tsx`, `waveTwinkle.ts`, `waveVideo.ts` and
`toolbarContract.ts`. Each source file carries the rule as a short imperative comment ending in a
pointer to an anchor here; this file carries the incident, the measurement, and the hypothesis that
was refuted.

Read the section that owns your area before proposing an alternative. Most of what is here has
already been measured, and several plausible alternatives have already lost.

Convention: `docs/archive/README.md`. Rule form: `docs/RULES.md`.

---

## `toolbarContract.ts` — the footer toolbar contract

<a id="toolbar-contract"></a>
### Why this file exists at all

OWNER: the toolbar lane. Three lanes (feat/prod-ledger, feat/music-piece-photo,
feat/music-musicxml) take toolbar real estate at once; this module is the ONE way they get it.

WHY THIS FILE EXISTS AT ALL: this codebase's recurring wound is two implementations of one
rule (staticPagination's orphan-snap vs the editor's; textRender's duplicate runOf; the
email lane's competing docTypeOf). Three lanes inventing a slot/layer mechanism independently
is that wound, pre-authorised. So the rules below are STRUCTURAL where they can be — a
second mechanism must be unrepresentable, not merely discouraged — and pinned by tests that
are mutation-proved to FIRE (toolbarContract.test.ts).

HOW A LANE PLUGS IN (read this; then read the section your change touches). Four things exist here
and nowhere else. If your lane is about to invent a fifth, it is about to fork one of these:

1. **A BUTTON** → add a member to `SlotId` + `ALL_SLOTS`, and a predicate to `SLOT_LIVE`.
   That is the whole registration: the row, the ▲ drawer, drag-to-reorder, migration and the
   positional hotkey all follow. Do not touch ROW_SLOTS, the storage key, or `migrateSlots`.
   Registered ≠ live — a slot whose lane has not shipped (`music`) or whose flag is off (`clock`)
   says so in SLOT_LIVE and is invisible everywhere, rather than painting a dead circle.
2. **A SECOND BAR** → add a member to `BarLayerId` and render on `active === 'x'`. The exclusion
   Peter asked for is the TYPE (one variable, one id), not a convention.
3. **TWO WAYS IN** → a slot is a TRIGGER, never an OWNER. Lift ONE piece of open state and give
   every door the setter (the ◈ ReceiptPanel is the precedent Peter named).
4. **A PER-DOC LAYOUT** → `ToolbarConfig` on the .studio. Read with `readToolbarConfig`
   (found/absent/error — never null), render with `resolveToolbarRow`, store/travel with
   `carryToolbarConfig`. It is OUTSIDE the provenance hash and must stay there:
   `toolbarHash.test.ts` PROVES it against the real snapshot + verify chain, so the day someone
   folds it in, the gate says so.

THE 2026-07-17 ARRIVALS, and their state: `media` LIVE (photo/audio/video import) · `clock` behind
?prodLedger (the Pomodoro/ledger drop-up; the top-right countdown is its second door) · `music`
registered, awaiting its lane, and it owns the music BAR LAYER when it lands.

ONE population (CLAUDE.md 2026-07-12): the ROW_SLOTS main-row circles + the ▲ drop-up
overflow. S (style) and ⚙ (settings) are slots too; only ▲ and ⋮ are fixed.

A LANE ADDS A BUTTON BY ADDING ONE MEMBER TO SlotId + ALL_SLOTS. Nothing else. It does not
touch the row size, the storage key, or the migration — and it MUST NOT add itself to
DEFAULT_SLOTS.

<a id="toolbar-row-six"></a>
### `ROW_SLOTS = 6` — the toolbar is a homepage

THE TOOLBAR IS A HOMEPAGE, NOT A PLATONIC FIXED THING. Peter, 2026-07-17, and it is the design
brief rather than a flourish: *"we're disrupting the whole ethos of a toolbar is a fixed
platonified thing to making it more like a toolbar is like your app homepage. You define what
apps sit on your homepage."* So SIX is a phone homescreen row, ▲ is the app drawer, and the
hold-drag-to-reorder machinery is the PRIMARY interaction — not a power-user setting. Design for
someone rearranging this often, per task.

SIX, AND THE REASON IS CONTINUITY. Peter: *"there's only 6 slots not 7 which I think is a good
number because it fits well on phone… we want to keep the phone and desktop experience
continuous."* The phone row is sized `(100vw − 45px)/N` (index.css .iw-phone-toolbar) across
▲ + the row + ⋮; six keeps every circle above the 44px tap target on a 320px iPhone SE, and
desktop shows the SAME six so the two devices teach one layout. This number is not a budget to
fight — it is what keeps one experience. Changing it is Peter's call, not a lane's.

<a id="toolbar-first-run"></a>
### `DEFAULT_SLOTS` — the first-run six, and why its scope is narrow

THE FIRST-RUN SIX — Peter's own list, verbatim: *"we can set up a default standard for the first
time you open a window or in incognito etc. which will be like page, style, info, settings,
media import, review"*. ('info' is the guide menu — the `i` circle.)

ITS SCOPE IS NARROW AND THAT MATTERS. This is NOT "the toolbar". It is the fallback for a writer
who has NOTHING — a first-ever window, or incognito. Three states, and only the first uses this:

- first run / incognito  → this array
- a NEW document         → whatever config is in OPFS (the writer's own last layout)
- a RECEIVED document    → its author's layout (signed-in writers can apply a saved preset)

So nobody is "evicted" by what is absent here: an existing writer's stored order is migrated, not
replaced (migrateSlots), and `bib`/`math` stay one click away in ▲ for the writers who want them.

<a id="toolbar-slot-live"></a>
### Registered ≠ LIVE — and the second implementation it absorbed

A registered slot may not be renderable YET, and there are exactly two reasons — which are the
same reason, and so they get ONE mechanism:

- its lane has not shipped a button (`media`: Peter's first-run six names it before it exists)
- it is behind a default-OFF flag (`clock`: `?prodLedger`)

Either way the id must not reach the row, the ▲ drawer or the drag machinery, or the writer gets
a circle that does nothing.

RECONCILED 2026-07-17 with feat/prod-ledger, which landed the clock before this contract existed
and had reached the same instinct from the other side: flag-conditional `allSlots()`/
`defaultSlots()`/`slotCount()` triples, dropping a stored `clock` *"so a stored 7-row can't strand
an unrenderable id"*. That is exactly this rule, written a second time — which is the wound this
file exists to close. So their gate is GONE and their guarantee is kept here, generalised: a lane
declares WHEN its slot is live and everything else follows. `clock` keeps its flag; nothing about
the ledger's behaviour changes for anyone.

Per-slot notes, at the time of writing:

- `clock` — feat/prod-ledger, the Pomodoro/ledger drop-up. Default OFF; the countdown is the
  other door.
- `media` — LIVE 2026-07-17: the media-import lane landed, and the `media: () => true` line is the
  one line that made it appear (row, ▲ drawer, drag-to-swap and migration all followed). It is now
  in Peter's first-run six for real, so no first-run writer falls through to `bib` any more.
- `music` — feat/music-piece-photo, the music BAR trigger (opens the
  [turn this photo into a piece] / [add youtube/mp3] second-bar layer). Behind the SAME
  default-OFF flag the music module already ships behind (`?music`, src/music/flag.ts), so the
  LIVE toolbar is BYTE-UNCHANGED for every real writer: the slot appears only when the music
  module is on, exactly as `clock` appears only with `?prodLedger`. The toolbar owns the SHELL and
  this trigger; the music lane fills the bar's body (components/MusicBar.tsx is the labelled seam
  it replaces). When the music panel is real, this flag is what turns both on together.

<a id="toolbar-migrate"></a>
### `migrateSlots` — the 4→6 precedent, generalised

The buttons that were FIXED before they became slots (`FORMERLY_FIXED = ['style', 'settings']`): a
legacy 4-slot config predates them, so they are appended first — this is CLAUDE.md's "legacy 4
migrates by appending style,settings", kept verbatim in behaviour and generalised in mechanism.

THE 4→6 PRECEDENT, GENERALISED — and the generalisation is the point. The shipped rule keyed on
`parsed.length === 4` and demanded an exact length, so it answered exactly one historical
question and RESET the writer's toolbar for every other shape (a stored 5, a retired id, and —
the live trap — any future row-size change). This rule is generational instead: KEEP what is
still live, in the writer's own order; FILL what is missing from canonical order; never reset
unless there is nothing usable to keep.

Resolve against what RENDERS, not merely what is registered: a row is a set of real buttons.
This is what keeps Peter's first-run six honest while `media` waits for its lane, and what
keeps feat/prod-ledger's promise that a stored `clock` cannot strand an unrenderable id.

Drop unknowns (a retired id, or a flagged-off one) and duplicates rather than failing the
whole config: a writer who once had a button we removed keeps the rest of their order.

Nothing usable — a first-ever window, incognito, or a config we cannot read at all. Peter's
first-run six leads the fill; anything in it that has no button yet falls through to the next
canonical member, so the row is always six REAL buttons.

`readStoredRow` returns `null` when the writer has none, and the null is the point — it is the same
distinction `readToolbarConfig` draws: "this writer has never curated a toolbar" (⇒ Peter's
first-run six) is not "this writer's layout is the default six" (⇒ their choice, which happens to
match). Collapsing them would make the first-run fallback unable to tell a fresh install from a
deliberate default — and would silently overwrite the meaning of an empty OPFS on every read.

<a id="toolbar-hotkeys"></a>
### Positional hotkeys — Alt+1…Alt+6

Peter: *"apps are like a learning tool for learning how to do things on hotkeys (and doing them
on phone where there are no hotkeys)"* — so the BINDING is the feature and the tooltip is only
how it is taught.

POSITIONAL, not per-slot letters, and the metaphor argues it: *"a toolbar is like your app
homepage. You define what apps sit on your homepage."* Alt+3 means THE THIRD CIRCLE — the same
thing your eye means. Position is identity on a homescreen, so the binding moving when you
reorder is the design, not a defect: the number you press is the number you see.

WHY NOT Alt+&lt;letter&gt;, which is the obvious first idea: Firefox on Windows/Linux — PETER'S OWN
BROWSER — binds Alt+F/E/V/S/B/T/H to the menu bar. Alt+digit is unbound in both Chrome and
Firefox, so the whole population fits with zero collisions and no chord.

THE PHONE LOSES NOTHING: it has no Alt, so it renders no hints and keeps the buttons as the
entire interface. This is additive on desktop and invisible everywhere else.

`slotIndexForDigit` returns null for '0' deliberately — the drawer is not a row slot, and folding
it in here would make "Alt+0 is index -1" a number some caller eventually indexes an array with.

<a id="toolbar-bar-layers"></a>
### Bar layers — the exclusion is the TYPE

Peter's word is "mutually exclusive": R and music cannot both own the bar.

THE SHIPPED MUTUAL EXCLUSION IS A CONVENTION, NOT A STRUCTURE — and that is the bug waiting to
happen. Today the state is TWO booleans (styleBarOpen, reviewOpen) = FOUR states, one of which
("both open") is illegal and is prevented ONLY by the discipline of a single function that
hard-codes the pair. A third member turns 4 states into 8 and 1 illegal state into 4, and the
function that must remember all of them is hand-written. That is how "identical policy" comments
come to sit above rules that have quietly diverged.

So the state is ONE VARIABLE holding ONE id. Two layers open at once is not "prevented" — it is
UNREPRESENTABLE. A lane owns the bar by adding a member here and rendering on `active === 'x'`.

`BAR_HANDOFF_MS = 240`: how long the outgoing layer takes to collapse before the incoming one
opens (max-height 220ms + slack). One constant: a per-lane copy is how two layers come to overlap
mid-handoff. `BarTogglePlan.handoff` is true when a DIFFERENT layer is currently open and must
collapse first: the caller opens `open` after BAR_HANDOFF_MS, guarded by a sequence number so a
fast double-tap cannot land a stale open on top of a newer one.

THE GUARANTEE `planBarToggle` CARRIES: the return type cannot express "two layers open". Any
caller, however careless, ends with at most one. That is the property CLAUDE.md's toolbar section
asks for and the current booleans only promise.

<a id="toolbar-trigger"></a>
### A slot is a TRIGGER, never an OWNER

Peter, 2026-07-17, on the Pomodoro: *"the pomedoro can be accessed two ways. Like the provedence
snapshots."* That names the precedent exactly, and it is already in this file's neighbour —
READ IT BEFORE BUILDING A SECOND WAY IN. `ReceiptPanel` (◈) is reachable twice today:

- it renders its OWN ◈ button (ReceiptPanel.tsx ~L158), and
- TiptapEditor LIFTS the state (`receiptOpen`) and passes `open`/`onOpenChange`, so the ▲
  drop-up's phone entry (~L2946) writes that SAME state.

One panel. One piece of open state, owned by the toolbar. N dumb triggers that only call the
setter. THAT is how a feature gets two front doors without getting two implementations — and it
is why the clock's toolbar slot and the top-right countdown are not a fork: both are triggers
writing one `ledgerOpen`. If a lane finds itself with two booleans for one panel, it has already
left the contract.

<a id="toolbar-config"></a>
### The `.studio` toolbar config — and why it is outside the hash

Peter, 2026-07-17: *"we should encode the toolbar configuration into a .studio document."* The
layout becomes per-DOCUMENT and task-based — a score gets music tools, an essay gets writing
tools — rather than one global preference.

⚠ At the time this was written the schema change (`toolbar?: ToolbarConfig` on InkwaveDocument,
types/document.ts) WAS NOT APPLIED — it was coordinated with Peter first, and the shape and rules
were settled so the three lanes could build against them. It has since landed: the field is on
`InkwaveDocument`, `bundle.ts` emits it and `openDoc.ts` restores it.

PROBED, not assumed, because the question was "is this inside the Bitcoin-anchored hash?":
**NO, AND IT CANNOT BE.** `contentHash(contentJson)` (provenance/hash.ts L66) hashes ONLY the
contentJson — never the InkwaveDocument — and `bundleHash` folds four EXPLICIT arguments
(contentHash · bibHash · emailHash · musicHash). So a new document field cannot ride in; it
would take someone deliberately adding it. That is the right answer and the precedent agrees:
the music lane excluded per-master titles/`addedAt` from v:4 because "a corpus renaming a piece
must not read as a tamper". Rearranging your buttons must not read as tampering with your thesis.
PRECEDENT for travelling at all: `citationStyle`, `scasLimitN` and `docType` are already
document-level preferences that travel in the .studio and already sit outside the anchored hash.
This is that same class of field — not a new kind of thing.

`ToolbarConfig.v` is versioned from birth: the shape is a wire contract the moment a .studio
carries it. `row` is the speed dial, in order, read through migrateSlots — never trusted raw.

**`ToolbarConfigRead` has NO `null` MEMBER, DELIBERATELY** — this is the `RemoteRead` pattern from
`productivity/ledgerRemotes.ts`, and it exists because of the 2026-07-15 incident: `readJson`'s
`catch { return null }` made a FAILED read indistinguishable from an ABSENT one, Edit.tsx answered
null by minting a blank document, and it destroyed a day of Peter's real honours-proposal
annotations. 'absent' and 'error' are different words and the type system enforces that they stay
different.

On the `found` member: `row` is the config MIGRATED for rendering here, now — exactly ROW_SLOTS ids
this build can actually draw, with anything flagged-off dropped. `config` is the SAME config
VERBATIM — the author's order, unmigrated — and the two are different on purpose. The migration is
a RENDER-time rule, and baking it into a document is a lossy write. `absent` means no config (a
pre-2026-07-17 document, or an uncurated one); `error` means present but unreadable — NEVER
silently a default.

WHY THE DISTINCTION IS LOAD-BEARING HERE, since a toolbar cannot lose a thesis: it is about what
we WRITE, not what we render. Both 'absent' and 'error' RENDER the same fallback row (the writer
always gets a working toolbar — see resolveToolbarRow). But only 'found'/'absent' may be written
back: persisting a resolved default over a config we merely FAILED TO PARSE is the blind
overwrite of 2026-07-15 in miniature — a read failure causing a write that destroys the thing it
failed to read. On 'error' we render the fallback and leave the document's bytes alone.

A config that survives `readToolbarConfig` is still passed through migrateSlots by the caller: a
hostile or truncated `row` cannot produce an unreachable toolbar, because migrateSlots returns
exactly ROW_SLOTS valid unique members from ANY input. ▲ and ⋮ are fixed chrome and are not slots
at all, so no config can hide the way back. "A received document locks me out" is unrepresentable.

<a id="toolbar-carry"></a>
### `carryToolbarConfig` / `mergeRowIntoConfig` — migration is a render rule

The config as it TRAVELS — written into a .studio, and read back out of one. Verbatim order;
registered ids only; **never migrated**. `undefined` when the raw value is absent or unreadable:
an unreadable config is DROPPED, not repaired, because a toolbar is one drag to fix and a
repaired-from-junk row is a guess we would then persist as if the author had arranged it.

WHY VERBATIM, AND IT IS THE LOAD-BEARING HALF. `migrateSlots` resolves against `livePopulation()`,
which is FLAG-SENSITIVE. Migrate on the way in or out and a writer who opens their own document
with `?prodLedger` off has `clock` silently deleted from the FILE — permanently, at the next save.
Migration answers "what can THIS build draw right now?"; a document answers "what did the author
arrange?". Those are different questions and only the second belongs in the bytes. Rendering still
goes through migrateSlots on every read (resolveToolbarRow), so a carried id this build cannot
draw is invisible rather than broken — the same partition, one rule, applied at the right end.

`registeredOnly` is the one filter it does apply: an id no version of Inkwave ever had is not a
lost feature, it is junk, and junk in a document is how a later reader learns to distrust a field.
Liveness is a runtime state; registration is a fact about the build.

`mergeRowIntoConfig` is the config to WRITE after the writer rearranges their row — the third
site, and the one where the flag-sensitivity closed back in.

The row the UI hands back is a MIGRATED row: it can only contain what this build draws. Persist it
raw and every drag quietly deletes the author's flagged-off slots from their own document —
`carryToolbarConfig` refuses to lose them on the way in and out, and this would lose them in the
middle. So: the writer's new row, PLUS any registered-but-not-live id their config already had.

THE RULE THAT MAKES THAT SOUND, and it needs the distinction the config's shape already draws: the
stored config is the ROW; drawer membership is DERIVED (overflowSlots). So a LIVE slot missing from
the new row was moved to the drawer BY THE WRITER — deliberate, and it must not come back. A slot
that was never renderable cannot have been dragged anywhere; its absence is the flag's doing, not a
decision. Keep what they could not have chosen to drop.

<a id="toolbar-resolve"></a>
### `resolveToolbarRow` — the resolution chain

THE RESOLUTION CHAIN, and the answer to "does a received document impose its author's seven?"

> document config → the writer's own global order → DEFAULT_SLOTS.

YES, A RECEIVED DOCUMENT'S LAYOUT APPLIES — that IS the feature Peter asked for: open a score,
get music tools. It is safe to let it, and the reasons are structural rather than hopeful:
a config can only ever name buttons that exist (migrateSlots), can never hide ▲/⋮, is
non-destructive, and is one drag to change. The precedent is already shipped and uncontroversial:
`citationStyle` travels in a .studio and silently reconfigures your citation rendering on open.
A document with NO config uses YOUR order, never a stranger's — so nothing changes for the
thousands of existing documents, which is the case that must not regress.

AND THE GLOBAL ORDER STAYS THE WRITER'S DEFAULT (localStorage, exactly as today — curation keeps
writing it). That is what stops per-document layouts becoming a chore: a new document inherits
the writer's latest curated order instead of snapping back to a factory seven. It is also why
there is no hardcoded per-docType default table — inheritance gives task-based sevens for free
the moment a writer curates one, without anybody guessing what a score's seven should be before
the music bar exists. If Peter wants factory-seeded per-type defaults later, they slot in HERE,
as one more link in this chain, not as a second mechanism.

EVERY path resolves through migrateSlots — including the first-run one. Returning DEFAULT_SLOTS
raw was a real bug its own test caught: the array names `media`, whose lane has not landed, so
the fallback smuggled an unbuilt button into the row that the normal path filters out.

---

## `waveVideo.ts` — the wave video (EXPERIMENTAL, `?waveVideo`, default OFF)

<a id="wave-video"></a>
### What it is, and why the debug overlay exists

Peter's proposal: play a pregenerated loop video of the water on the hardware media pipeline
(decode + composite off the main thread — immune to the raster-scheduling residual class: blue
flash, wave lines lagging their wave). The video is an OPAQUE, baked copy of THIS water
(gradient + drifting lines + marks + glitters) for the LOAD window only; at rest it hands back
to the CSS water, which owns scroll-time sway. The CSS/WAAPI unit keeps running HIDDEN
underneath (`html.iw-wave-video-on`) and is the automatic fallback at EVERY step.

SCOPE (say it plainly): this covers the LOAD animation ONLY — the drift + the S-curve slow-down.
It cannot affect scroll-time artifacts, because at rest the video is gone and the CSS water is
back. Load-time targets = blue flash + lines lagging their wave.

⚠️ THE FALLBACK CHAIN IS OTHERWISE SILENT (AV1 → H.264 → CSS) and CSS water looks IDENTICAL to
the video. `?waveVideo=debug` renders an on-device overlay naming exactly what is on screen and
WHY — Peter tests on an iPhone 8 with no Mac/Web Inspector, so without it a failed video is
indistinguishable from a working one and every verdict is uninterpretable.

iOS AUTOPLAY: inline autoplay requires BOTH `muted` and `playsinline` (as attributes AND
properties — older WebKit reads the attribute) and fails SILENTLY otherwise. Low Power Mode
blocks autoplay outright; that surfaces as reason 'autoplay-blocked'.

<a id="wave-hydration"></a>
### ⛔ Nothing may touch the DOM before hydration

2026-07-17 — Peter's *"the video works but it never loads"*, PROBED. `hydrateRoot(document)` makes
React own EVERY node, so appending our `<video>` (or the overlay) into the PRERENDERED
`.iw-wave-twinkles` before hydration is a hydration MISMATCH: React throws #418, discards the
server HTML and client-renders the whole document (#423) — which REPLACES the `<html>` element with
a new node. The new `<html>` carries no `.iw-water-ready` and no `data-theme`, so
`:root:not(.iw-water-ready)` puts every wave layer (and the twinkle host our own `<video>` lives
in) at display:none FOR THE SESSION: the CSS water dies, the video paints nothing, and on phone the
surface is left a flat aqua gradient with no waves — the 2026-07-10 "gradient without waves"
catastrophe, re-triggered by this flag. entry.client's MutationObserver stamp-guard cannot save it:
it watches the ORIGINAL `<html>`, which React detached. Hence `hydrated()` — every DOM write waits
behind it.

The barrier's own history is the "only wait on a signal that always arrives" rule twice over.
`inkwave:twinkles-ready` was the first key: waveTwinkle announces it once the pool is mounted from
a LAYOUT EFFECT, which React can only run after the hydration commit. That was post-hydration, but
it is NOT guaranteed — the pool announces only if BOTH its sets generate, while the water gate
opens regardless on its own 1500ms timeout. So a load whose pool never announced hung the video
FOREVER with the water gate wide open (PROBED 2026-07-17: reason stuck at 'waiting for hydration…',
clip/fetch never even set). **Correctness of the video must not depend on the twinkles succeeding.**

`.iw-water-ready` was rejected for the mirror-image reason: that gate has a 1500ms timeout path
(entry.client) that can open it BEFORE hydration on a slow device — an iPhone 8 is exactly that
device — which puts us right back in the mismatch.

`inkwave:hydrated` (entry.client's beacon) fires from a post-commit effect on every load, and
`__iwHydrated` makes it askable, so a caller that arrives late can never wait for an event already
in the past. The check and the subscribe are one synchronous block — nothing can slip between them.

The fetch stays IN FRONT of the barrier deliberately. Picking a codec and fetching bytes touch NO
DOM, so they are safe pre-hydration — and this is the whole reason the clip used to arrive in time.
The first cut of the barrier moved the fetch behind hydration too, which on Peter's A11 pushed the
download ~2s later and cost the video its 2.5s decode budget (his 8:15am overlay: `readyState 0`,
`fetch requested`). Only the ATTACH has to wait. The overlay was the second offender: with `=debug`
it broke hydration all by itself.

<a id="wave-ladder"></a>
### The ladder: CROP, NEVER RESIZE

2026-07-17 — Peter's ruling, and it is a bug fix: *"render the video at one higher resolution and
then crop it to the screen rather than resizing it… preserve dpi rather than the fixed boundaries
of the movie"*.

WHY THIS IS NOT A PREFERENCE. The video stands in for the CSS water for the load and HANDS BACK
at the coast, so its wave tile must be 140 CSS px at EVERY viewport — that congruence IS the
hand-off. `object-fit: cover` scaled the clip to the viewport, so the tile became
140 × max(vw/designW, vh/designH): MEASURED 122.5px at 1100×700 and 157.5px at 1440×900 against
the CSS water's unwavering 140.0 — a 12.5% jump at the swap, exactly Peter's live report (*"the
video resolution and size of the waves does not match that of the background"*). Crop measured
140.0 vs 140.0, 0.0% error, at a viewport where cover reads 122.5 (`tilescale.prove.mjs`).

THE MECHANISM: the element is sized to the clip's DESIGN CSS BOX (`cssW`×`cssH`, fixed at the
top-left) and `object-fit: fill` maps the clip's pixels onto it 1:1. The clip is encoded at
`cssW × dsf` — so on a device whose DPR === dsf, one clip pixel is one DEVICE pixel ("preserve
dpi"). The VIEWPORT then crops whatever overflows. A design box must therefore COVER the
viewport, or there is no pattern to crop from and the surface would show a bare edge.

⚠️ `object-fit: none` is NOT the same fix: it maps 1 video px → 1 CSS px, so a dsf:2 clip would
render 2× too big. The trio is: clip @ (design CSS × dsf) + element @ design CSS + `fill`.

THE CEILING IS PETER'S (*"Why don't we just do full hd. Or even 720p"*): the desk rung is FULL HD
at dsf 1, chosen over a retina 3840×2160 because he asked for the smaller file and because the
water is a gradient + soft 140px lines — and because 1920×1080 (2.07 Mpx) still fits H.264
**Level 4.0** (~2.1 Mpx), the iPhone-conservative pin `generate.mjs` has always carried. A 4K
clip would force Level 5.1. `wide` (2560×1440) exists because a 1920-wide design box has nothing
to crop from on a 2560 desktop; it is DESKTOP-ONLY by construction (`pickRung` partitions on the
pointer type), so its Level 5.1 never reaches an iPhone.

ABOVE `wide`, pickRung returns null and the CSS water plays — the honest answer, not a stretched
clip. A `<video>` cannot be background-repeated, two tiled videos are two `currentTime`s, and
canvas-tiling needs a per-frame JS driver (the one thing this whole unit exists to avoid).

The rungs, and why each exists:

- `phone` 440×956 @dsf 2 — covers every phone CSS viewport in portrait (iPhone 8 375×667 · 12
  390×844 · 14 Pro Max 430×932). dsf 2 is dpi-exact on an iPhone 8 and 0.67× on a DPR-3 phone —
  soft by Peter's own budget, not by accident. 880×1912 = 1.68 Mpx, also inside Level 4.0.
- `desk` 1920×1080 @dsf 1 — FULL HD, Peter's word. Covers a desktop CSS viewport up to 1920×1080
  at DPR 1.
- `wide` 2560×1440 @dsf 1 — the crop headroom a 2560-wide desktop needs. Desktop-only ⇒ H.264
  Level 5.1 is safe here.

<a id="wave-rungs"></a>
### `pickRung` — "inkwave should detect that"

Peter never tells us his resolution. Exported + PURE so the gate can be tested at every device
class without a browser. The old rung choice was `coarse || innerWidth < 900` and nothing else:
under cover-fit either clip stretched to fill anything, so the viewport's SIZE genuinely did not
matter. Under crop it is the whole question — a design box that does not cover the viewport has no
pattern to crop from.

THE RULE: the SMALLEST rung of the right device class whose design box covers the viewport in
BOTH axes. Smallest-that-covers is what keeps a 1280×800 laptop off `wide`'s bytes. Nothing
covers it ⇒ null ⇒ CSS water. It NEVER returns a rung that must be stretched: that is the bug
this ladder exists to fix, and silently reintroducing it is worse than not playing at all.

`coarse` IS A PARAMETER, not a `matchMedia` read inside the function — and the first reason is a
bug these tests caught on their first run: under vitest's node environment there is no `window`,
so an internal read returns `false` for every case and the ENTIRE touch half of the suite becomes
a silent second copy of the desktop half — passing, and proving nothing. (waveVideo.test.ts's
"the stub discriminates" check is what surfaced it.) Second: the device class is an INPUT to this
decision, so a function that reaches out for it is not the pure rule it claims to be.

THE DEVICE CLASS IS A HARD PARTITION, not a preference. `phone` is captured under the app's PHONE
CSS (compact 32px page margins, the ×1.25 font rule, in-flow surfaces) and `desk`/`wide` under
desktop CSS. They are pictures of two different waters. So a coarse device is NEVER offered a
desk clip — not even a landscape iPad, whose viewport `desk` would happily cover.

⚠️ DPR IS DETECTED AND REPORTED, BUT IT DOES NOT SELECT — and saying so is the honest version.
Peter's ask is *"detect viewport x DPR at runtime… I shouldn't have to give the res of my
desktop"*, and both halves ARE read at runtime (`planClip` → `diag.viewport`, `dpiRatio`). But
selection is a CHOICE, and DPR can only make one where two rungs of the same device class differ
in `dsf` — this ladder has no such pair, because Peter's ceiling ("full hd. Or even 720p") is
exactly what rules out the retina desk clip that would create one. A `dpr` parameter here would
be a number the function reads and cannot act on: an instrument reporting a decision it never
makes. WHEN a dsf variant is added, this is the function that gains the argument.
What DPR would otherwise be for — refusing a rung delivering under 1 clip px per device px — is
deliberately NOT done. A 440-CSS phone at DPR 3 asks 1320 device px of an 880px clip: still a
CROP (the tile is 140 CSS px, so the hand-off stays exact) and merely SOFT, which is inside
Peter's stated budget. Refusing it would drop every modern iPhone to CSS water — trading a PROVED
bug (the 12.5% tile jump) for a guess about crispness nobody has measured on a device.

⚠️ STATED CEILING, found by these tests rather than reasoned about: an iPad in PORTRAIT
(820×1180) matches no rung. `phone` (440×956) cannot cover it and the desk clips are landscape —
1080 < 1180, so `desk` fails on HEIGHT even ignoring the partition. It gets CSS water. Deliberate:
the alternative is an iPad rung nobody asked for, on a device Peter does not test, for a load
animation whose fallback is already correct.

<a id="wave-loop-gate"></a>
### The deliberate delay — the reveal waits for one whole loop

Peter: *"make it show at least one loop before the file comes up. purposefully delay it. (And use
that time to warm up the document)"*.

The reveal gate (TiptapEditor) waits on this alongside fonts.ready + the first pagination
measure — so "warm up the document" needs no code of its own: the warm-up IS what the load was
already doing, and this simply stops the reveal from cutting it short.

THE BOUNDARY IS THE VIDEO'S OWN, NOT A TIMER. `releaseAtLoopPoint` watches `currentTime` WRAP —
a looping media element's clock running backwards is the loop point, OBSERVED. A
`setTimeout(2000)` would be a guess about a decode we do not control, and a measurement whose
verdict depends on who else is running is not a guard: on a busy first load the clip starts
late, so a timer would release mid-loop and Peter would see exactly the half-loop he asked us
to stop showing him.

ALWAYS ARRIVES, AND IS ASKABLE (the one-shot-async-signal rule — this module has been bitten by
it twice already). Every exit fires it: bail, decode timeout, autoplay refusal, the wrap, the
settle, and the cap. A reader that arrives late asks `__iwWaveVideoLoopDone` rather than waiting
for an event in the past. If this module never loads at all, nothing here fires — which is why
the reader in TiptapEditor carries its own independent cap.

Watch for the wrap with rVFC where it exists (it ticks with the DECODER, so it sees the wrap on the
frame it happens), else a 40ms poll of the same fact — the poll is what `wireSettle` already uses
to find this identical boundary, so this is not a second way of asking one question. The 6s cap is
NOT the timer sneaking back in as the release mechanism: a media element genuinely can stall on a
dead network, and a load that never reveals the document is a far worse bug than a short loop. It
NAMES itself in `diag.loop`, so a capped release can never be read as a real one. The wrap test's
second arm covers `start` being mid-clip (play() can resolve a frame or two in) — a full duration's
worth of advance is also one whole loop.

Every exit runs through `bail`, and that is what makes the two gates safe to wait on: a bail must
ALWAYS hand the water back (drop the white wait → CSS water) and ALWAYS release the reveal (or a
failed decode would leave Peter on a white screen with no document).

<a id="wave-white-wait"></a>
### The white wait, and the probe seam

BLANK WHITE UNTIL THE VIDEO COMES UP — Peter: *"we have to just have blank white screen until the
video comes up and play the video every time"*. `html.iw-wave-video-wait` whites the surface and
hides every water layer, so a load can never show a frame of CSS water that the video is about to
replace (the "partial/janky first frame"). It is a CLASS ON `<html>`, set by entry.client BEFORE
hydration — the same shape as `.iw-water-ready` and `data-theme`, and deliberately NOT a node
append: appending pre-hydration is precisely the bug (React #418 → the whole document re-rendered →
the water dead for the session) that the `hydrated()` barrier exists to prevent.

IT MUST NEVER BE PERMANENT. Every exit clears it: the master hand-off swaps it for
`.iw-wave-video-on`, and every bail drops it so the CSS water — the fallback at every step —
appears. entry.client carries an independent timeout for the case where this module never loads.

PROBE SEAM (same contract as `window.__iwTwkPool`): probes must read `window.__iwWaveVideo`, never
scrape the overlay's rendered HTML — the overlay is a formatted STRING for Peter's phone camera,
and a probe that parses it measures the formatting. `masterEver` is the durable fact a 12s sample
can otherwise miss entirely: the video can become master and hand back before any single read
lands, which reads identically to "the video never ran" — the exact ambiguity that makes a green
meaningless.

<a id="wave-one-clock"></a>
### One host, one clock — and the direct `src`

DIRECT same-origin src, NOT a blob (2026-07-16 — THE iPhone-8 fix). iOS decodes a `<video>` only
when it can Range-request the moov atom; a blob URL cannot be ranged → readyState stuck at 0
(Peter's overlay: fetch 200, readyState 0, decode timeout). The SW serves /wave/ cache-first
WITH 206 Range, so a direct URL is still one fetch + cached, and iOS can seek the metadata.

The warm fetch is the one the SW's /wave/ handler was written to receive ("non-Range GET (our warm
fetch…)"): ONE full 200 that populates the cache, so the `<video>`'s later Range probes are served
from the cached buffer with no network. Fire-and-forget on purpose — nothing may AWAIT it, or a
stalled network would become a stalled load. If it loses to the `<video>`, the SW just fetches once
more.

iOS loads a `<video>` only while it is IN THE DOM (a detached element never fetches on WebKit),
so attach — invisible (opacity 0) — before load(). We are POST-HYDRATION there, so ONE plain
append is enough: React rendered `.iw-wave-twinkles` as a stable EMPTY container and never
touches its children again (waveTwinkle owns them imperatively and only ever removes its OWN
`.iw-twk-set` nodes — it never clears the host). The old 150ms re-attach interval existed
solely to heal the wipe caused by attaching PRE-hydration; with the barrier there is no wipe,
so the interval is gone rather than re-tuned. We become MASTER (hide the CSS water) only once
play() RESOLVES, so a decode/autoplay failure always leaves the CSS water visible.

⚠️ ONE HOST, ONE CLOCK — AND IT MUST STAY THAT WAY (2026-07-17, flagged by fix/wave-desktop-jitter).
`querySelector` + `:not(.iw-wave-covered)` means exactly ONE `<video>` exists per load: the shell's,
never the covered editor's. That is load-bearing, not incidental. During the load there are TWO
drifting surfaces, and the CSS water solves them by making both adopt ONE literal startTime — the
whole "sibling clock adopt" invariant in Scroll.tsx exists because two copies of this water at
33-500ms of skew showed doubled lines through the reveal fade. Give the second surface its own
element and you get the identical two-clock shape WITH DECODERS: two `currentTime`s, no shared
timeline, no adopt possible (a media element's clock cannot be assigned like an animation's
startTime). The jitter lane measured what that costs on the CSS side — 43-60px of mark-vs-wave
skew on 4 of 5 clean loads, from two animations resolving their startTime independently. Do not
add a second video without an answer to "which clock, and who slaves to it".

`reason` MUST TRACK WHERE THE FUNCTION ACTUALLY IS (2026-07-17). It used to be written once
before the barrier and then never again until play() resolved, so a video stuck in its decode
still displayed 'waiting for hydration…' — and that stale line sent the next reader hunting a
barrier bug that had already released (clip/fetch on the same overlay proved run() was well
past it). A field nobody updates is a field that lies.

Do not become master before the atomic water has painted, and never veil a load that already
reached its coast/rest (a slow decode on a fast open) — that would show drift over settled text.
ASKABLE, not just an event: the class is not a safe thing to test alone (a hydration recovery
can strip it — that WAS this bug), and the event may have fired while we were decoding. Same
rule as `hydrated()`: ask first, subscribe only if the answer is no.

The swap order at master is ONE swap, this order: `-on` goes on before `-wait` comes off, so the
white and the video never both let the CSS water through for a frame. Both are classes on `<html>`
= a single recalc. And `video.style.opacity = '1'` is not decoration: CSS defaults
`.iw-wave-video-el` to opacity 0, so THE loop was invisible without it.

<a id="wave-master-derived"></a>
### `iw-wave-video-on` is DERIVED, never latched

THE MASTER LATCH MUST NOT OUTLIVE THE ELEMENT (2026-07-17 — Peter, live: *"after I signed in just
now the wave background completely went away"*; flat teal, no waves, document fine).

`html.iw-wave-video-on` SUPPRESSES the CSS water outright (visibility:hidden on the wave pseudos
AND the twinkle host) with no dependency on this video existing. The class is therefore a PROMISE
that something else is drawing the water. When a re-render tears our `<video>` out of the DOM —
mounting Clerk at sign-in does exactly that — the promise is broken and the surface is left a
bare gradient: the CSS water suppressed, the video gone, nothing drawing. The water dies.

So the class must be DERIVED, not latched: the moment nothing of ours is left to draw, hand the
water straight back. Event-driven, not polled — the host's children change only when the twinkle
sets or our own videos mount/unmount, and MutationObserver callbacks are microtasks, so the CSS
water is restored before the bare-gradient frame can paint. `:not([data-going])` is what makes
the legitimate loop→brake swap a non-event: the dying loop is already marked, the brake is live.

LIMIT, stated: this sees our element leaving the host, and the host leaving its parent. A
re-render that replaces a HIGHER ancestor wholesale would go unseen — covering that needs a
subtree observer over the surface, which contains the ProseMirror subtree and would re-run on
every keystroke (the --wave-x invalidation lesson). Peter's ruling deletes this whole latch
anyway; this is the smallest thing that makes the live bug impossible.

Teardown ALWAYS restores the CSS water: dropping the class is what makes the DOM water the
fallback. (Leaving it set with no video = a blank surface — a real bug, 2026-07-16.)

`mkVideo` writes the element's size in TWO LINES and it must be written there rather than in CSS:
the design box is a per-rung fact, and the whole point of the ladder is that different devices get
different design boxes. `object-fit: fill` (index.css) then maps the clip's pixels onto it with no
scaling of its own.

The settle preloads the brake immediately (direct URL, in-DOM, invisible, guarded) so it is decoded
before SETTLE — on iOS a brake created at swap-time would stall exactly like the loop did.
Attaching it as a sibling of the loop in the same host means the guard/host logic covers it too.
The swap happens at the loop's phase-0 boundary: the brake is baked from that same boundary with
the SAME pool seed, so its first frame ≡ the loop's frame 0 (pixel-exact join). The abort paths
(open-begin / resize / an error / the tab hiding) land in `finish` and can outrun the wrap; they
release the loop gate, or the reveal gate would sit waiting on a loop from a video we just tore
down — the delay is a courtesy to the animation, never a dependency of the document.

<a id="wave-overlay"></a>
### The on-device overlay — an alarm that fires on the healthy path is worse than none

"ON SCREEN" MUST MEAN ON SCREEN (2026-07-17). This said VIDEO ON SCREEN whenever play()
resolved — a claim about the DECODER, not about pixels. It read green on Peter's iPhone while
the element sat inside a display:none host painting absolutely nothing, which is precisely how
a broken build talked us out of a real bug. Ask the layout engine instead: a display:none
ancestor gives a zero box (and null offsetParent for a non-fixed chain), and visibility/opacity
are resolved values, so this sees every way the video can be silently unpainted.

`painted` means PUTS PIXELS ON SCREEN. It demanded opacity >= 0.9, which invented a false
alarm out of a legitimate animation: `.iw-wave-video-el` fades in over `transition: opacity
0.3s`, so for ~270ms of every successful start — the exact moment Peter watches, "right
before it loads" — a video that WAS painting reported NOT PAINTED. A half-faded video is
painting. Only a fully transparent one is not.

THE LIVE ELEMENT, not just the first one. During the loop→brake swap the dying loop is still
in the DOM for 80ms (opacity 0, marked data-going) while the brake plays — picking it made
the overlay cry "NOT PAINTED" in the middle of a perfectly good hand-off.

NO ANGLE BRACKETS IN ANY OF THESE STRINGS: this box is written with innerHTML, so a literal
"&lt;video&gt;" is parsed as a TAG — it swallowed the water-gate and reason lines whole the first
time this ran. The instrument must not be able to blank itself.

THE STATE MACHINE (2026-07-17, round 3). The overlay was RED on a working app, and that is worse
than green on a broken one: it burns the trust of the one person whose eyes are the ground truth.
Success ENDS with the element removed and master cleared, so a completed run displayed the same red
'● CSS WATER (no video)' as a video that never ran at all — and Peter, reading it, reported "the
first time the video ran, from then on just the css". The finished state and the never-ran state
MUST NOT look alike. `masterEver` is what tells them apart.

NO "BENIGN" STATE FOR master-WITHOUT-AN-ELEMENT. Round 3 called that a mid-swap transient and
greyed it out; Peter's sign-in screenshot then showed EXACTLY that state while his water was
dead — `master` suppresses the CSS water, so master with nothing painting IS the water dying.
The alarm was telling the truth and I muted it. The legitimate loop→brake swap is excluded
properly instead, by reading the LIVE element (`:not([data-going])`) rather than by excusing
the symptom. Red means exactly ONE thing: the video never ran on this load; `reason` says which
exit.

KEEP IT ATTACHED. hydrateRoot(document) makes React own `<body>`, so a plain appended overlay is
reconciled AWAY during hydration (why it vanished, 2026-07-16). Re-append whenever it's gone —
this is Peter's only on-device instrument, it must survive hydration + every re-render.

Any on-device overlay whose screenshots may cross a deploy must print `__BUILD_COMMIT__`.

currentTime advancing = a REAL decode (not a frozen first frame — the iOS silent-failure tell).
`last` seeded at -1 meant the FIRST tick of any video satisfied `now > last + 0.001` and
reported "YES (real decode)" for a video holding NO DATA — Peter's 8:15am overlay showed
`readyState 0 (NOT decoded)` next to `advancing YES (real decode)`, a physically impossible
pair that cost real time to see through. Require decoded data AND a genuine delta against a
previous sample; `last = -1` now means "no sample yet", which can never look like motion.
