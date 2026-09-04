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

---

## `waveTwinkle.ts` — the precomputed pool and the scroll-time system

<a id="twinkle-model"></a>
### The model, in full

v3 (Peter, 2026-07-11 — the strip-down): *"it's just sine waves, some stochastic glitters and
wave marks from a precalculated data pool, and an S-curve slow down — all of which on a
different workflow to whatever has to load so it doesn't get interrupted."*

THE LOAD UNIT. Everything the loading animation will ever do is computed BEFORE playback:

- A pool of instances — sparks (glitters) and dashes (wave marks) — with positions drawn
  through the never-strike-twice sampler (memPick), canvas-rastered art (never SVG URIs —
  Chromium's per-URI IsolatedSVGDocumentHost cost is measured ~4.3s at ~600 URIs), and a
  per-instance SCHEDULE: a cycle of blink envelopes (dash: 0.3s S rise / 0.4s hold / 0.3s S
  fall), each at a fresh lattice slot.
- Playback = WAAPI animations started once (an opacity track + a transform track per
  instance, both looping over the ~46.7s cycle) + the tiles' CSS drift. NOTHING runs per
  frame on the main thread during the load — no rAF driver, no respawns, no style writes —
  so main-thread starvation is PHYSICALLY INCAPABLE of touching the animation (that's the
  "different workflow": the compositor thread).

HOW AN INSTANCE RIDES ITS WAVE WITH ZERO MAINTENANCE. The tile pattern drifts at exactly
72 px/s (140px per 1.944s loop). A blink instance's transform track bakes that motion in:
during each lit envelope the track moves linearly at the drift velocity, holding the instance
at a CONSTANT wave-space position (its art phase, wrap140 — so the mark always lies on its
crest/midline); between envelopes (opacity 0) the track glides invisibly to the next slot.
Slots are drawn on the instance's own 140px lattice (same phase ⇒ the SAME art stays exactly
valid) through the shared band memory — a strike never lands where one recently sat, and the
rotation only repeats after the full cycle (~47s ≫ any load). The track loops seamlessly:
its duration is a multiple of the 1.944s tile loop and its value is periodic by construction.

ONE CLOCK, SET ONCE. Wave-space validity needs the tracks' startTime ≡ the tile drift's
startTime (mod 1944ms). alignTracks() reads the tile animation's literal startTime (at the
atomic-water gate on boot; at anim re-entry on later loads — waiting on its `ready` promise
when pending, which resolves before the first visible frame) and batch-sets every track, once
per load, with a random whole-loop cycle offset so each load plays a different window of the
pool. No epoch globals, no per-frame re-anchoring, no resync.

THE S-CURVE SLOW DOWN (SETTLE → rest). The tiles' coast is an additive brake (see Scroll.tsx);
the twinkle FIELDS get the SAME injected brake keyframes via CSS the moment .iw-wave-coast
lands — zero value + zero velocity at start, so every layer decelerates in lockstep with the
water, continuous by construction. Over the coast the blinking layer FADES OUT and the static
rest layer FADES IN (both pure CSS, the coast's S-curve): the twinkling calms exactly as the
water slows, ending on the resting texture. Statics ride a WAAPI drift clocked to the tiles
(created once, at coast start — they are invisible before it) so they decelerate on their
crests too. At rest everything is handed to the scroll-time system in one commit.

THE SCROLL-TIME SYSTEM (post-reveal, unchanged in spirit): static texture between scrolls;
scroll velocity drives dash blink playbackRate (driven WAAPI); relocations are raster-free
140px-lattice moves through the same never-twice memory (2026-07-11 scroll-jank round: the
full-art respawn re-rastered PNGs on the scroll path — deleted); sway = literal field
transforms via swayFields() (the --wave-x inheritance firebreak — see index.css).

During the LOAD the fields carry no inline transform at all: the coast brake is a pure CSS
animation (`.iw-wave-coast .iw-twk-field` — the same injected keyframes the tiles composite), so
every twinkle layer decelerates in exact lockstep with the water, main-thread-free. At REST
the fields take literal sway transforms (`swayFields` — never `var(--wave-x)`: a var-consuming
field put the whole instance subtree inside the sway's invalidation set; see the firebreak).

<a id="twinkle-later-host"></a>
### The covered editor's copy is built in idle slices

A LATER host (the covered editor under the shell): its copy is invisible until the
reveal, so its ~330 track animations (~250ms measured) move OFF the boot's critical
path — created in CHUNKED idle slices (each ~35 elements ≈ 25ms), so the editor boot's
fonts/pagination work interleaves and the reveal never waits on a long task. Complete
long before the uncover on any healthy load; clock-exact either way (startTracks stamps
trackT0 at creation).

<a id="twinkle-rest-drift"></a>
### The static rest layer's coast ramp

The static rest layer fades in over the coast and must decelerate ON its crests. Each rest
wrapper gets a NON-wrapping WAAPI drift ramp anchored to its enclosing field's CSS brake:
the brake's `ready` resolves at the coast's first painted frame with its literal startTime
t0c — the SAME clock Scroll's resolve stamps — and the ramp starts at the drift's wrapped
pose at t0c, exactly the tx0 the brake keyframes were snapped against. Standing pose at the
hold = tx0 − d = the handed-off --wave-x, so the rest commit swaps in identical pixels BY
CONSTRUCTION. (A looping 140px ramp would visibly teleport the lit statics at every wrap;
an anchor at settle-time had a wrap ambiguity against the resolve — both real.) Statics are
near-invisible for the ramp's ≤1-frame pending window (their fade-in starts at 0).

Pending until the forward anchor plays it (~1 rAF + slack) — `ready` + a poll fallback;
whichever lands first wins (start() is idempotent). Statics are near-invisible that
early in their fade, and the anchor stays EXACT (t0c is the literal startTime,
however late we read it).

<a id="twinkle-clock-gate"></a>
### Never create-then-re-clock on visible water

Batch re-clock of anims created BEFORE the clock resolved. Only the pre-gate boot mounts
ever get here with existing tracks (they are display-hidden until the same recalc that
starts the drift, so the batch is invisible); on VISIBLE water, track creation is gated on
`clockReady()` — a late batch re-clock of live marks was a MASS TELEPORT of the whole
field (Peter's live *"backward tick just before the slowdown"*, 2026-07-12: +24-62px phase
steps on the screencast, ~40ms before reveal-imminent — the batch landed as the editor
mount drained, right before the settle gate fired).

Surviving rest elements (and zoom-reseeded ones) get THIS load's tracks only once the new
load's clock exists — creating them on a provisional clock and re-timing later teleported
every visible mark at once (the live backward tick). The wrappers fade out (taking the old
rest texture with them, gently), the tracks land aligned, then the layer eases back in.

Entry fade for mark tracks created on VISIBLE water: hold the layer at 0, create, then fade
in over the CSS transition — deferred creation must never pop the whole layer in one frame.
ON THE FIELD, not the blink wrapper: the coast's paused fade ANIMATION overrides any wrapper
inline opacity the moment the coast class lands (first keyframe = 1 — measured re-pop); the
field only ever animates TRANSFORM, so its inline opacity survives every phase.

<a id="twinkle-rest-commit"></a>
### The rest commit

ONE commit, same flush as the surface's wave classes dropping: cancel the load playback
(blinkers fall to var(--twk-static) — invisible: their layer just faded to 0 through the
coast), stop the rest layer's drift (its enclosing field's brake vanishes with the class in
this same recalc; total pose = the tiles' handed-off --wave-x, identical by construction),
and put the fields on literal sway transforms at that exact value.

---

## `Scroll.tsx` — the paper chrome, the two zooms, and the wave choreography

<a id="scroll-zoom-tuning"></a>
### The four zoom-input constants, and why each moved

`TRACKPAD_ZOOM_SENSITIVITY = 4`. Trackpad ctrl-pinch fine-deltas: multiplier on the fractional step
per 100px of deltaY. A discrete mouse-wheel notch (|ΔY| ≥ 100) is ALWAYS exactly one 1.08 step —
this only speeds up the sub-notch accumulation, capped at one step per event.
2026-08-20 (Peter, real Mac trackpad: *"takes way too much movement to zoom even one step"*) — the
commit itself is a hard `Math.trunc()` with ZERO visual feedback below a whole step (applyFrame /
applyMagnifyFrame), so at the old value of 2 a real trackpad's small per-event deltas needed many
accumulated events before ANYTHING moved, which read as "nothing happens" rather than "zooming,
slowly". Raised 2 → 4; still capped at one committed step per event so a single frame can never
leap multiple lattice steps.

`FIRST_STEP_BONUS = 0.92`. One-time bonus added to the FIRST wheel event of a fresh gesture
(`latch.isIdle()`), on top of its own normal contribution — makes the first commit land sooner than
steady-state cadence would, so the very start of a zoom gesture reacts immediately rather than
needing to "warm up" the accumulator from zero. Purely additive; steady-state per-step distance
(TRACKPAD_ZOOM_SENSITIVITY above) is unchanged once a gesture is under way. 0.5 → 0.92 (Peter,
still felt slow to start): at 0.92 almost any nonzero first tick — even a very light touch —
crosses the 1.0 commit threshold on its own; it doesn't reach 1.0 by itself only so a literal
zero-delta event can't spuriously commit a step.

`ZOOM_SETTLE_MS = 450`. How long after the last committed zoom step the SETTLE runs — the heavy
half of zooming: it exits the live-reflow window, re-measures page breaks canonically and re-anchors
the viewport. 200 → 450 (2026-08-23, Peter: zoom *"goes like three zooms then stops then another
three"*). MEASURED: a deliberate trackpad gesture notches every ~400ms, so at 200 EVERY notch outran
the debounce and paid its own full re-measure — 8 notches, 4 blocking tasks of ~80ms. The stall was
never the step itself (the step is a cache hit or one scoped reflow); it was the settle firing
between steps. 450 sits past a deliberate notch cadence so a multi-notch gesture coalesces into
ONE settle, and is still well inside Peter's stated bar for this (*"paras split over pages even if
they render 0.2s late; the cursor line moves instantly"*) — the step's own reflow is unchanged, so
what he sees while notching does not move; only the re-measure waits for him to stop.

`PINCH_ZOOM_SENSITIVITY = 2.5`. Phone pinch: multiplier on the finger-distance-ratio → steps mapping
(log(d/d₀)/log(RATIO)). 1 = the pinched distance ratio maps 1:1 onto the zoom ratio; higher = fewer
centimetres of pinch per step. Steps still commit whole on the shared zoomStep lattice. Raised
1.75 → 2.5 (Peter, 2026-07-10) now the transform preview decouples gesture feel from reflow cost.

<a id="scroll-accel"></a>
### Deep-zoom-out scroll acceleration

Peter, 2026-07-10. The plain-wheel scroll is content-proportional (delta × scale) so a notch always
covers the same fraction of a page — but taken literally that gets GLACIAL at tiny scales (at 0.05
a notch is 5px). Below the knee the multiplier accelerates above pure proportionality, ramping
harder as the scale approaches MIN_MAGNIFY: f(s) = s^(1 − a·t), t = (KNEE − s)/(KNEE − MIN) ∈ [0,1].
At the knee t=0 → f(s) = s exactly (continuous, and the s ≥ KNEE regime is byte-identical);
with a = 0.5 the boost over proportional is ≈2.4× at s=0.1, ≈3.9× at s=0.05, ≈7× at 0.02.
Retune the KNEE (where acceleration starts) and STRENGTH (how hard it ramps) — not the formula.

⚠ NATIVE SCROLLING FOR THE WHOLE NORMAL ZOOM BAND (Peter, 2026-08-23: scrolling has *"some lag vs a
normal word doc… it feels like a resistance"*). Above the knee this branch multiplied every wheel
delta by `scrollScale(s) === s`, so at a fit-to-width magnify of ~0.57 — which is simply what a
~570px window gives you, not a zoom anyone chose — the page moved 57% of what the fingers asked for.
That IS resistance, and `preventDefault()` on top of it replaced the trackpad's compositor-driven
momentum with discrete main-thread writes, so the shortfall came without inertia to disguise it.
The proportionality it bought ("one notch = the same fraction of a page") is a real idea but the
wrong trade here: the wrapper already sizes the scroll RANGE to the visual content, so native
scrolling covers the document correctly on its own — it just does it with momentum and sub-pixel
smoothing we cannot reproduce by hand. Below the knee the accel curve still earns its keep (a page
at 0.1 needs the boost), so that path is untouched.

<a id="scroll-coast"></a>
### The S-curve slow down — an ADDITIVE BRAKE over the never-stopped drift

The load unit's deceleration (Peter's spec, 2026-07-11): the drift animation is never stopped;
SETTLE adds a second animation composited with `animation-composition: add` whose value starts
at 0 with zero initial velocity — the handoff is continuous BY CONSTRUCTION whenever the
commit lands, however starved the main thread is. After the coast time T a linear hold cancels
the drift exactly, so the TOTAL pose is static until the rest handoff, however late its commit
lands. The twinkle fields ride the SAME injected keyframes via CSS (index.css), so every layer
decelerates in lockstep. ONE COAST PER LOAD: every surface (shell + editor) swaps class in the
same event dispatch and shares the injected keyframes + the resolved clock.

ZERO-JERK S-CURVE (2026-07-11 live-tick round): total velocity = −v·(1 − smoothstep(τ)) — the
water holds full speed with ZERO initial deceleration, eases into the slowdown, and lands with
zero end velocity: a true S-curve slow down (Peter's spec), and any residual anchor lag ε now
costs add(ε) ∝ ε³ (sub-pixel even at hundreds of ms) instead of ∝ ε². add(τ) = vT(τ³ − τ⁴/2),
d = vT/2 (90px desktop / 72px phone), sampled as ~24 linear segments (max deviation from the
true quartic ≈ 0.06px); after T a linear hold at +v cancels the still-running drift exactly.
Direction: coast-l opposes drift-l (positive), coast-r mirrored. The twinkle fields' CSS brake
uses these SAME keyframe names, so one injection drives every layer in lockstep. The keyframes
carry literal px because `var()`-dependent keyframes cannot composite.

LOAD WATCHDOG — the ONE backstop (it replaced the old per-stage fallback caps). Playback is
compositor-only and the rest handoff is a resolved-clock timer, so on any healthy load the whole
chain always completes; the only way it cannot is SETTLE never arriving (the document never became
ready) or the page's timers being dead. If a load is still drifting WATCHDOG_MS after it began, LOG
loudly and force the chain: start the coast and dispatch 'inkwave:load-watchdog' (Edit.tsx
force-drops the shell; TiptapEditor force-lifts `covered`). 30s ≫ any healthy load (worst measured
cold 20MB open ≈ 12s) — it must never fire on one.

Coast END → sway handoff. The deceleration itself is pure CSS (drift + brake); JS wakes only
at the resolved-clock timer to hand over: the snapped rest offset is written into `--wave-x` in
the same commit the coast class drops. Because the coast geometry's ±280px overdraw is
exactly two 140px tiles, transform +tx ≡ background-position +tx — dropping the class while
setting `--wave-x = txFinal` paints identical pixels: no snap, no dead frame, and the sway then
continues from that offset (base = txFinal − scrollTop·WAVE_SWAY, rebased there). The coast ends on
a device-pixel-SNAPPED offset (coastEndRef) and the handoff must write that same number or the
bg-position repaint shifts sub-pixel.

Two effects, deliberately: the settle (switch class) must not share an effect with the handoff —
`setWaveMode('coast')` inside a `[waveMode]`-dep effect re-ran the effect and its CLEANUP tore down
the just-armed listeners, leaving `.iw-wave-coast` stuck forever.

<a id="scroll-forward-anchor"></a>
### The forward anchor — brakes are born CSS-paused

FORWARD ANCHOR (2026-07-11, Peter's live *"backward tick"*). The brake animations are born
CSS-PAUSED (zero additive value — the drift alone keeps rendering, byte-identical), so
engines that resolve a pending CSS animation at STYLE time (Firefox; Chromium under
starved compositor acks) can never present brake(lag) as a first frame — the old tick:
when a CPU spike delayed the swap commit, the compositor had drifted past the brake's
recorded start and its first presented frame applied a cancellation computed for a pose
N frames ago (a backward step proportional to the spike). Instead, ONE rAF after the swap
commit we stamp the load's anchor t_a = now + slack ON THE TIMELINE CLOCK, compute the
drift pose AT t_a analytically from the drift animation's own startTime (presentation-
exact for a long-running compositor animation), snap the rest pose to a device pixel,
inject the final keyframes, and start every coast animation (tiles + twinkle-field brakes
+ the layer fades, both surfaces — all name-matched in the subtree) at exactly t_a. The
brake then begins at zero value/velocity at a future compositor time: continuous BY
CONSTRUCTION however starved the main thread was, and every copy shares one clock.

`play()` first: it marks the WAAPI override (the CSS paused declaration must never re-pause on a
later recalc), then the explicit startTime sets the exact shared clock.

<a id="scroll-sibling-clock"></a>
### Sibling clock adopt — and it must RETRY

SIBLING CLOCK ADOPT (the one cross-surface sync the tiles need). Two overlapping surfaces
(the loading shell + the editor beneath it) each carry their own CSS drift; a surface that
mounts MID-LOAD starts its animation at its own recalc, out of phase with the shell's — the
reveal cross-fade would smear two offset copies (the 2026-07-09 ~10px hiccup). Adopting the
sibling's literal startTime makes every copy pixel-identical by construction. Surfaces that
mount BEFORE the atomic gate opens have no animations at all — then every copy is born in
the same gate recalc and is identical without any adoption. `useLayoutEffect`: the adopt must
land before this surface's first paint. It also arms the load watchdog (disarmed at rest).

THE REFERENCE is the first-mounted surface, and it is NEVER rewritten (2026-07-18 desync fix). The
reference is whatever surface mounted first (the loading shell); `waveTwinkle.findDrift` resolves
the SAME surface (first host), so trackT0 — the marks' clock — is read from a startTime nothing
here touches. Every LATER surface (the covered editor) adopts the reference; that keeps both waves
in phase AND keeps the marks on every surface's crest, because a mark clocked to the reference
rides an adopter whose wave now equals the reference.

WHY THE OLD `sibling != null` GATE FAILED (measured, markskew.prove.mjs + diag-trace): the
covered editor routinely mounts ~150-250ms BEFORE the shell's drift commits its startTime — so
at the covered editor's mount NO sibling was resolved yet, the gate skipped adoption ENTIRELY,
registered no retry, and the two drifts then resolved independently 150-250ms (10-18px) apart,
FOREVER. Peter's *"the little short lines often appear out of sync with the waves"* is exactly
that: the covered surface's wave off the shell's, and — since the marks share the shell-clocked
trackT0 — the covered surface's marks off their own crest by the same amount. The fix is to
WAIT for the reference to resolve rather than give up: adopt on retry until it lands (capped, so a
reference that never resolves cannot spin forever).

STICKY (2026-07-11): a write to a PLAY-PENDING CSS animation is CLOBBERED when the pending start
resolves — re-assert at `ready`, when the write sticks.

The last drifting surface unmounting (the desktop /snapshot veil fades out mid-coast and takes its
animations with it) ends the choreography — there is no chain left to watch.

<a id="scroll-wave-hold"></a>
### Wave stillness through zoom

Peter: *"stop it moving the waves"*. The sway is `--wave-x = base + scrollTop·WAVE_SWAY`. Zoom
writes scrollTop in many ways — anchor corrections, the settle re-anchor, and ASYNC browser
scroll-clamps when the wrapper/content shrinks (those materialise at a later layout flush, so
no synchronous bracket can catch them all). Mechanism: zoom activity opens a HOLD WINDOW
(holdWavesFor, extended by every zoom frame + settle); while it's open, the sway handler
treats every scroll delta as zoom-driven and rebases the base EQUAL-AND-OPPOSITE — `--wave-x`
is held exactly constant through gesture, settle, re-measure and any clamp. When the window
closes, sway resumes from exactly where the waves were (same rebase pattern as the coast
handoff) — no jump. Trade-off: a user scroll INSIDE the window doesn't sway (decorative, and
scrolling mid-zoom is rare); the moment the window lapses, normal sway is untouched. The old
approach — skip one sway frame when the zoom var changed — leaked: coalesced and clamp-induced
scroll events after the skipped one still swayed.

`WAVE_SWAY = 0.06`, two thirds of the old 0.09, shared by the sway and both rebases. The sway rides
on a persistent BASE offset: where the loading coast came to rest. It starts at 0, so surfaces that
never drift (SnapshotView) keep the plain scrollTop·WAVE_SWAY sway.

Phone attaches NO sway listener at all: waves exist only DURING load there (`.iw-wave-anim` /
`.iw-wave-coast`), and at rest the surface returns to parchment (`::before display:none`), so the
sway var would be a style recalc per scroll frame for nothing.

FULLSCREEN PDF SWAY (Peter, 2026-07-10): while the PDF viewer floats over the water it dispatches
its absolute scrollTop ('inkwave:pdf-sway'); folded into the SAME base+top formula as a second
scroll source, so the waves at the pane's sides sway with PDF scrolling exactly like editor
scrolling — one write path, and the zoom-hold/coast rules stay intact.

ONE rounded value for both consumers: the surface var (wave pseudos) and the twinkle fields' literal
transforms (`swayFields` — no var inheritance into the instance leaves; see the `--wave-x` firebreak
block in index.css).

<a id="scroll-magnify"></a>
### Magnify plumbing, the fit cap, and the scroll lock through the squeeze

HYBRID ZOOM scope: only the desktop LIVE editor (`fill`) with a fixed-size paper gets the
transform-magnify + fit-to-width cap. Phone has its own model (canonically-narrower render +
pinch font zoom); SnapshotView's in-flow Scroll and 'scroll' paper (no mm width) stay plain.

ONE subscriber applies the module's effective magnify to the DOM: the `--iw-magnify` var (the
CSS transform reads it), the `.iw-magnified` class (`scaleFor()` keys off it; also gates the
transform rule so scale=1 renders EXACTLY like master — no containing-block change), and the
wrapper box's width/height. The wrapper is the scroll-height fix: transform doesn't change
layout size, so a scaled-down page would leave ghost scroll space (and a scaled-up one would
clip) — sizing the wrapper to the page's VISUAL dims (pageW·s × paperH·s) makes layout ≡
visual, so the scroll range always matches what's on screen and mx-auto centring stays exact.
`useLayoutEffect`: the first fit/magnify application lands BEFORE the browser paints the mounted
surface, so a narrow window (or a persisted magnify) never flashes one frame at scale 1.

FIT CAP: recompute from the surface's width on every resize (and page-settings change).
`clientWidth` excludes the scrollbar (`scrollbar-gutter: stable`), so the fit page never sits
under it; WATER_MARGIN_PX keeps a strip of water visible either side.

SCROLL LOCK THROUGH THE SQUEEZE (Peter, 2026-07-10): when a width change re-binds the fit
cap — the PDF panel opening/closing (its `--iw-pdf-room` inset narrows this fixed surface over
a 0.18s transition), or a window resize — the effective magnify changes, the wrapper's
height changes with it, and the reading position would scroll away. Anchor the TOP-visible
text line: read its viewport top, apply the new fit (setFitContext → the subscriber's
apply() resizes the wrapper SYNCHRONOUSLY), read it again, and displacement-correct
scrollTop — per RO tick, so the transition's stream of small changes each cancels to zero
and the text you were reading stays put through the whole open/close relayout. Same
held-anchor rule (and the same block-rejection rules) as the zoom paths.

NO `holdWavesFor` in the paper RO (2026-07-14 sway-freeze fix). That RO fires on EVERY paper resize
(pagination, typing reflow, the box.height write's own relayout) — open-ended, unlike a bounded zoom
gesture. Arming a 250ms wave-hold per fire meant that whenever the paper resizes more often than
every 250ms at s≠1 (fit-cap bound on a narrow window / PDF panel open / persisted magnify≠1), the
hold never lapsed and the scroll sway froze permanently (Peter's live *"waves don't wave when
scrolling"*). Zoom-induced clamps are ALREADY held by the gesture path (holdWavesFor 350 per step +
800 at settle); a clamp from an ordinary reflow is genuine content motion the sway SHOULD follow.

Applying a new scale resizes the wrapper, and the browser may CLAMP scrollTop against the new extent
(asynchronously, at the next layout) — scroll changes the sway must absorb, whether that fires
inside a wheel frame or standalone on a resize-driven fit change. Hence the 350ms hold on the
magnify subscriber and 800ms at settle.

The module's fit cap is deliberately NOT reset on unmount — the loading shell and the live editor
are BOTH hybrid surfaces during the load handoff, and the shell unmounting must not yank the cap
from under the editor. A remount recomputes it immediately.

Settings change: recompute the fit cap for the new page width, and re-apply AFTER React's own
settings rerender commits (rAF lands post-commit, pre-paint) — otherwise React's fresh mm width on
the wrapper would clobber the imperative pageWidth·s px while magnified.

Non-hybrid fill surfaces (phone; 'scroll' paper) render the magnify wrapper too — hydration
STRUCTURE must match the desktop-built prerender — but must not keep its width: React 18 silently
adopts mismatched server attributes at hydration and never rewrites one whose vdom value doesn't
change between renders, so the build-time `width:210mm` would stick to a phone's wrapper forever
(horizontal overflow). Clear it pre-paint.

The magnify wrapper is RENDERED FOR EVERY `fill` SURFACE, hybrid or not (2026-07-10 iOS regression):
the prerendered shell is built desktop-side (hybrid), so gating this div on `hybrid` made the
phone's first client render STRUCTURALLY different from the server HTML — hydration failed (#418),
React client-re-rendered `<html>` from scratch and stripped `.iw-water-ready` + `data-theme`, and
the whole load choreography died (gradient with no waves). Structure must be a constant of `fill`;
hybrid only drives styling/behaviour. Its width starts as the same mm value the paper uses (layout
identical to master at scale 1) and is imperatively switched to pageWidth·s px while magnified;
height is ONLY ever set imperatively, so React never fights the RO's writes.

<a id="scroll-classname"></a>
### React's className write silently strips `iw-magnified`

⚠ 2026-08-20 — THE ACTUAL ROOT CAUSE of the fit-to-width "zoom snap" bug (found after three
earlier band-aids — canonicalMeasure's restore, roPaper's self-heal, a 600ms delayed self-heal —
ALL failed to close it, which was the tell that something OUTSIDE that effect's own lifecycle was
the culprit). The surface's className is a JSX TEMPLATE STRING keyed on `phone`/`fill`/
`covered`/`waveMode`. `waveMode` is REACT STATE that walks 'anim' → 'coast' → 'off' over the
SEVERAL-SECOND wave reveal sequence, and `covered` flips too — EVERY one of those transitions makes
React compute a NEW className string and write the WHOLE `class` attribute to the DOM. React has no
idea the OTHER layoutEffect also imperatively added `iw-magnified` outside its own bookkeeping, so
that write silently replaces the entire class list — including `iw-magnified` — with whatever the
template currently says, which never includes it. Traced live: the class is correctly present within
the first ~1.3s of load, and gone again by t=4000ms with nothing in the OTHER effect having touched
it since — exactly consistent with a wave-state transition overwriting the attribute later in the
reveal, well past every earlier self-heal's timing window.

FIX: re-assert both the class and the variable every time React is about to write a NEW className
for this exact reason — a layoutEffect keyed on the template's own inputs runs AFTER React's commit
(so it sees the fresh class string) but BEFORE paint (so the repair is invisible).

The paper RO's re-assertion stays as belt-and-braces: `--iw-magnify` and that class are two
independently-mutable pieces of state `apply()` keeps in lockstep on ITS OWN writes only, and the RO
fires on every paper reflow — far more often than any OTHER path to the same desync needs to be
invisible for — so re-asserting both together there is a standing correction, not specific to one
cause.

<a id="scroll-anchor"></a>
### The gesture anchor is a TEXT POSITION, and the ratio fallback must be clamped

The ref (`editorZoomRef`) is the AUTHORITATIVE live zoom; React state only trails it (the settle's
catch-up setEditorZoom). Do NOT re-assign the ref from state on render — any re-render landing
MID-GESTURE (reveal chain, panel updates) reset it to the stale state and the next commit
stepped from zoom 1: a visible multi-step snap-back (probed: a −9-step jump mid-pinch).

Anchor the font zoom to the pointer, SYNCHRONOUSLY (no flicker): set the zoom var, force layout by
reading the anchored element's new position, then correct scrollTop in the SAME frame — all before
the browser paints. The anchor is the actual element under the cursor (exact — a fraction estimate
drifts badly further down the page since reflow doesn't grow uniformly). scrollLeft is held so it
never jumps to the left edge. React state is updated after, to the same value (no re-paint).

FRAME COALESCING (the zoom-flicker fix): trackpads/pinch emit several wheel events per frame,
and each zoom step forces a FULL-document reflow (the font-size is calc'd from the zoom var).
2–3 reflows per 16ms blows the frame budget on a long doc → visible stutter. So wheel events
only accumulate ±1 steps; ONE rAF applies the net step count — one reflow per painted frame,
and rAF runs before paint so the synchronous anchor logic stays single-frame/flicker-free.
React state + localStorage persist are deferred to a settle timer: neither changes pixels
(the var is already on the DOM), and the per-tick setState re-rendered PageGuides for nothing.
BOTH accumulators are FRACTIONAL and commit WHOLE lattice steps per frame (Math.trunc, the
remainder carries) — wheel notches contribute ±1, trackpad fine-deltas and phone pinch
contribute proportional fractions, so every input quantizes onto the shared zoomStep.ts
lattice. That's what makes zoom levels precomputable (the pagination step cache).

ONE STABLE anchor per gesture — a TEXT POSITION (caret range), not a block top. Re-picking
under the viewport centre every frame made the anchor flip between elements at block
boundaries (drift toward the doc top in both directions — fixed 2026-07-09 by holding one
element per gesture). But holding a BLOCK's TOP was still too coarse (Peter, 2026-07-11:
*"phone screen doesn't stay in fixed scroll position when zooming"*): a font-zoom step scales a
paragraph's height ≈ zoom² (line count × line height), so text N px into the block slides to
N·zoom² while the block top sits perfectly pinned — on a phone one paragraph can exceed the
screen, so the pinched-on words sailed off by hundreds of px (measured: 1300px over one
gesture at the lattice cap). The anchor is now the CARET position at the pinch midpoint /
cursor (caretRangeFromPoint), whose line-box rect tracks the exact content through any
reflow; the block element is kept for connectivity checks and as the fallback when no text
caret resolves (margins, gaps, empty paragraphs).

A skipped block (content-visibility mid-gesture) yields a degenerate 0×0 caret rect at the
origin — fall through to the block-top placeholder box rather than trust it.

The block-probe fallback rejects the big containers (`.ProseMirror` / `.scroll-paper` — they span
the whole doc, so their top reflows toward the doc top and a correction against them lurches — the
old "jump to top" bug) and the PAGE-GAP widgets/sheet chrome (their heights are pinned px that do
NOT reflow with the font — the "funky near page gaps" bug). When the point falls in a gap/margin,
probe outward until real text is found. STRICT pass first: refuse blocks SPLIT by a page gap (a
mid-paragraph break nests the fixed-px gap widget inside the block). Such a block's rect straddles
the boundary, so as the text redistributes across it the top↔gap relationship warps and successive
frame corrections alternate direction — the boundary-zoom flicker. Then a lenient pass: a split
block still beats the no-anchor ratio fallback.

⚠ THE RATIO MUST BE CLAMPED, and this is the "doc keeps jumping down to the bottom"
(Peter, 2026-08-28, the same session the pinch started working again — which is not a
coincidence: the fallback is reached ONLY when no content anchor could be picked,
and that is exactly the pinch-over-the-WATER case, which was unreachable while the wheel
listener stayed unarmed at magnify 1).
`scrollRange()` floors at 1 so it can be divided by. When the document currently FITS its
viewport that floor is a FICTION — there is no range — and any scrollTop at all divided by
it yields a ratio ≥ 1, i.e. "you are at the very bottom". The next frame multiplies that by
a REAL range and the document leaps to its end. Same shape as the archive guards: a
defensive default (max(1,…)) silently became a measurement.
So: a degenerate range answers 0 — the honest position when everything fits is the top —
and a real one is clamped to [0,1], which a proportion cannot leave anyway.

MAGNIFY frame (hybrid, wheel over the water/gaps): scale the whole page about the VIEWPORT
CENTRE (Peter: *"centre it around the centrepoint of screen"* — the cursor position picks the
ZONE only, never the anchor). The wrapper box's rect IS the page's visual bounds (layout ≡
visual), so the content point at the screen centre is the offset (centre − box.top) into the page;
after the scale change it sits at box'.top + offset·(after/before) — correct the scroll by its
displacement so it stays pinned at the centre (the shared conversion: paper-local = visual ÷ scale;
new visual = local × new scale). Multiply the EFFECTIVE scale (not the raw intent): while the fit
cap binds, intent hovers just above it instead of silently running to 2.5 and snapping huge when the
window widens.

GESTURE REBASE (Peter, 2026-07-11: *"if it has to load, it has to measure the zoom from when it
starts working, not the finger width at the start — so there's not a big jump"*): when the main
thread is busy at gesture start (a previous settle's relayout, a SCAS tick), the queued touchmoves
burst in together and the whole backlog would commit as one multi-step leap (then the next frames
replay the rest — Peter's "multiple jumps"). The FIRST responsive frame of a pinch instead DISCARDS
the backlog and takes the current finger spread as the gesture's baseline (pinchDist already tracks
it — every queued move updated it), so zoom follows finger movement from the moment the pipeline
actually responds. Costs at most one frame's worth of spread on a responsive start.

Between-commit drift (native pan on phone, content-visibility relevancy waves on both platforms) is
owned by the zoom GUARD loop, which runs every frame while the live window is up.

LATTICE COMMIT: level = 1.08^step exactly (same 8%-per-notch feel as the old multiply, but every
reachable level is a shared lattice point the pagination step cache can precompute).

Pin pagination's RO-driven painters for the whole gesture (`__iwZoomHold`): per-frame LIVE
repositioning lagged the reflowing text 1–2 frames — the page-boundary up/down flicker. The step
cache replaces live repositioning with instant precomputed geometry; the RO path stays gated as the
cache-MISS fallback. Cleared in the settle, right before zoom-settled. On phone the hold is taken
from the FIRST touch, not the first commit: a queued SCAS tick landing mid-pinch rebuilds the
touched paragraph and the gesture dies on the detached node (iOS dispatches a pinch's touchmoves to
the ORIGINAL target).

PREDICTIVE STEP CACHE: the `inkwave:zoom-step` dispatch goes AFTER the anchor read, so a cache
MISS's band measure rides the layout just forced (a hit is pure style writes that batch into this
frame's paint; the panels still move WITH the text). The surface is included so the SnapshotView's
zoom can never drive the live editor's panels. Dispatched before the scroll correction — applyBands'
sheet min-height write must precede the scroll write or the range could clamp.

Hybrid at magnify ≠ 1: the reflow changed the paper's height, and the wrapper box must track it
SYNCHRONOUSLY (its RO fires later this frame) or the scroll-range clamp could bite against the stale
height near the document end. One offsetHeight read in a frame that's about to force layout anyway.
ONE forced layout for the whole frame (2026-07-11 first-response cost): placeholder switch + font
reflow + wrapper sync all land in this single anchor read.

Inside the live window, pin the anchor to its GESTURE-START viewport top, not last frame's — the
content-visibility placeholder set re-evaluates between frames (scroll corrections move the
viewport), and per-frame displacement correction PRESERVES that inter-frame drift instead of undoing
it (the pinch midpoint slid ~200px over a big gesture). While the window is active the user cannot
scroll (fingers down / ctrl+wheel burst), so the pin is safe; outside it (CV unsupported) the classic
displacement correction stands.

The settle waits while fingers are still down = the gesture is NOT over (a paused pinch) — settling
then would tear down the live window + anchor pin mid-gesture and re-measure under held fingers.

ZOOM-SETTLE RE-MEASURE: page breaks stay pinned DURING the gesture (re-measuring live made the text
lurch), but the gaps + sheet panels were measured at the OLD font size and sit misaligned with the
reflowed text. One clean re-measure now — and re-anchor the viewport around it (same held-anchor
logic) so the adjustment doesn't move the text you're reading.

Per-EVENT profiling: `probePerf` costs one property check unless a harness defines `window.__iwPerf`.
`notePerf` keeps only the worst value per 2s, which cannot answer "what does ONE notch cost" — see
scripts/textrender-probe/zoomcost.prove.mjs.

<a id="scroll-zone"></a>
### Zone geometry, the mode latch, and arming the wheel listener

ZONE GEOMETRY v2 (Peter, 2026-07-10) — X-BASED, not point-in-panel: the text column's
left/right edges (the live .ProseMirror rect — custom margins respected) are two
imaginary vertical lines. Cursor x OUTSIDE them → WATER zoom (side water, the page's
own side margins, and the parts of gaps/bottom margins beyond the lines); x INSIDE
them → font zoom (text, bottom margins, gap regions within the column's x-range).
y never enters the test. Latched per gesture — see zoomZone.ts.
`isIdle()` must be read BEFORE `resolve()` — resolve() itself latches a mode on its first
call, so that is the only point that can still see "no gesture in progress yet".

MODE LATCH + COOLDOWN (Peter, 2026-07-10): the FIRST zoom event of a gesture picks the
mode (water = whole-page magnify, text = font reflow) and it stays LOCKED until 0.5s
after the last zoom event — regardless of cursor movement. (Replaces the old 8px-cursor-
movement latch: zooming moves the page under a stationary cursor, and a deliberate slow
notching gesture must never flip modes mid-flight.) The latch also drives the zoom-cursor
classes on the surface (zoomZone.ts + the `.iw-zooming-*` rules in index.css).

LATTICE QUANTIZATION: a full mouse-wheel notch (|ΔY| ≥ 100 in Chrome/Firefox) = exactly
±1 step (identical to the old feel); trackpad ctrl-pinch fine-deltas (small |ΔY|)
contribute proportional FRACTIONS that accumulate until a whole step commits — so every
input lands on the shared zoomStep lattice instead of an arbitrary float in between.
TRACKPAD_ZOOM_SENSITIVITY scales ONLY the fine-delta fraction — a discrete notch stays exactly one
step; retune the constant, not the formula. The FIRST-STEP HEAD START is applied AFTER the mode is
decided (mode doesn't affect which accumulator gets it) and only ever once per gesture
(`freshGesture` is captured pre-resolve).

SCROLL LATENCY: the non-passive wheel listener exists ONLY when it can actually
preventDefault (Peter, 2026-07-10: ~100ms wheel→scroll lag). A non-passive wheel listener
— however cheap its body — forces the compositor to WAIT for main-thread dispatch on
EVERY wheel event, so plain scrolling inherited whatever task was running (SCAS tick,
measures). The listener is ARMED only while it could intercept. At rest there is NO non-passive
wheel listener at all — plain scrolling is fully compositor-threaded, native latency.

⚠ A TRACKPAD PINCH PRESSES NO KEY (2026-08-28, Peter: *"both water and page zoom no longer
appear to be working with finger drawing closer and farther. It overrides to the native GPU
zoom"*). macOS/Windows trackpads synthesise `wheel` with `ctrlKey: true` and NO keydown ever
fires — so the two arming triggers this had (a real Control/Meta KEY, or magnify ≠ 1) both
read false during a pinch, the non-passive listener was never attached, and the gesture fell
straight through to the BROWSER's own zoom. It looked intermittent because the second
trigger papered over it: at a narrow window fit-to-width puts magnify ≠ 1, so the listener
happened to be armed and the pinch worked — go full-screen and magnify returns to 1, the
listener detaches, and the same gesture zooms the browser instead. Window-size-dependent,
which reads as random.

A gesture that announces itself only in its own first event cannot be armed for reactively:
by the time we have seen `ctrlKey` the browser has already zoomed a notch, and a browser
zoom level is not something a page can undo. So the listener is armed WHILE THE POINTER IS
OVER THE SURFACE — the only state that reliably precedes the pinch. The latency guard the
arming exists for is preserved where it matters: the cursor parked over another window or
panel still leaves no non-passive wheel listener, and the handler's own first branch
returns for an ordinary scroll without preventDefault, so the compositor keeps the scroll.

Residual edge: entering the window with ctrl ALREADY held gives the browser the first notch (page
zoom) until a keydown/pointer event reveals the modifier — the passive pointermove check closes that
for the mouse-first flow.

<a id="scroll-live-window"></a>
### The live-reflow window, its placeholders, the guard and the deferred un-skip

LIVE-REFLOW WINDOW (the "lazy off-screen" strategy — phone pinch AND desktop wheel).
While a zoom gesture is active, `.iw-zoom-live` puts content-visibility:auto on the
editor's block children (see index.css): the browser natively SKIPS layout of off-screen
blocks, so a zoom step reflows ~one screenful instead of the whole document. Skipped-
placeholder height = the document's average REAL block height, published as ONE root-level
var (--iw-cis) — NEVER per-block inline styles: writing a style attribute on a ProseMirror-
OWNED node trips PM's DOM observer, which REBUILDS the touched blocks — that detached the
gesture's touch target (iOS keeps dispatching a pinch's touchmoves to the ORIGINAL node, so
the gesture died after the first commit) and stripped the placeholder sizes (scroll
collapse). The aggregate scroll geometry stays ≈ exact (n·avg ≈ total content); per-block
error is absorbed by the anchor PIN (anchorTop0) and trued by the exit bracket + settle.
Measurement stays exact: forceCanonicalContext forces `--iw-cv: visible` inside every
canonical window, and no measure runs mid-gesture anyway (`__iwZoomHold` + no edits, with the
SCAS tick / PageGuides also deferring on the hold). Scoped to the GESTURE only.

EXACT per-block placeholder heights, via ONE generated stylesheet — `:nth-child` rules,
NEVER inline styles on PM-owned nodes (PM's DOM observer rebuilds touched blocks and the
gesture dies on the detached touch target — the original --iw-cis lesson). Exactness
matters (2026-07-12): a flat mean placeholder shifted off-screen geometry by Σ(real−mean),
so the entry needed a huge compensating scroll (~5,000px at the doc bottom) which DRAGGED
the content-visibility relevancy set across the doc — and WebKit's async relevancy
relayout landed AFTER that frame's pin correction: one painted frame with the pinched
text ~2,400px off (deterministic at the document bottom). Height-identical placeholders
make the switch geometry-neutral at the current zoom — no compensating scroll, no
relevancy drag, no second-wave jump. `--iw-cis` stays as the fallback for any child beyond
these rules; the `:nth-child` specificity beats the base `> *` rule in index.css.

Placeholders TRACK the zoom (2026-07-12, the residual single-frame blips): a multiline
block's height ≈ lines·lineHeight ∝ zoom² (both factors scale), so frozen gesture-start
heights diverge from rendered blocks as the gesture moves — every relevancy swap then
jumped by (z/z0)²−1 of the block (probed: 90-450px single-frame blips at commits). Each
rule multiplies the measured height by `--iw-cis-scale = (zoom/z0)²`, written next to the
zoom var each commit (same style recalc — zero extra invalidation), so swap deltas drop
to line-quantization noise.

No entry bracket (2026-07-11): the ONLY caller is applyFrame's commit path, immediately before the
zoom var write — the (geometry-neutral) switch and the font reflow land in ONE forced layout (the
anchor read that follows), and the pin correction against anchorTop0 absorbs the frame's whole
displacement. The old touchstart-time entry paid a separate full bracketed relayout inside the
touchstart task (gesture-start lag). Re-entering from the RESTING arith window: the class is already
on, so every offsetHeight reads a placeholder (no content layout) and the doc is never un-skipped;
the old exact stylesheet is replaced by the fresh baseline.

ZOOM GUARD (round-3 flicker, 2026-07-12): the live window's placeholder regime is only
piecewise-consistent AT commit instants — the browser re-evaluates content-visibility
RELEVANCY asynchronously between frames, and each wave (skipped↔rendered swaps, heights
start-zoom vs current-zoom) shifts the layout with NO handler running: the text moved but
the pin and the band/panel geometry were commit-time — measured 93-546px of band/text
desync lasting until the next commit ("text flows over gap", "page joins gap"). While the
live window is up, this rAF loop re-pins the anchor and re-syncs the bands the frame a
wave lands. A DESKTOP scrollTop change between commits is a genuine user scroll (wheel
without ctrl) — accept it (rebase the pin); on PHONE fingers are down, so any scroll not
ours is a native pan that survived suppression — fight it (pin), the round-2 rule.

The guard discriminates OUR writes from user scrolls (rebase vs pin) by recording every write's
CLAMPED result in `setScrollTop`, so commit/exit corrections never read as user scrolls — it was
rebasing its pin onto relevancy-wave displacement whenever a commit's correction landed between its
ticks (probed: 11 rebases vs 3 pins over one wheel session). The guard counters are shared across
Scroll instances (the loading shell's would otherwise shadow the live editor's) — debug/probe only.

ATOMIC EXIT (round-3 flicker): the un-skip relayout must never paint under the
placeholder-era panels — that window (exit → settle recompute → paint, 2 rAFs + a forced
measure) showed 779-1170px of band/text desync for ~180ms at EVERY settle. Re-derive the
band geometry from the full layout in this same task: the class is off, so onZoomStep
routes to the full-regime stepCache (hit = pure writes; miss = one band read riding the
layout the anchor read just forced). Dispatched BEFORE the scroll write so applyBands'
sheet min-height lands first (scroll-range clamp order). The re-anchoring bracket pins the held
content anchor back to its gesture-start viewport top in the same task, because skipped blocks held
their gesture-START heights and un-skipping lays them out at the committed zoom.

ARITH EXIT (flag `inkwave:arithBands`). The un-skip is O(doc): dropping content-visibility
invalidates every block and the anchor read then forces the whole document's layout (240/722/2688ms
at 5k/20k/40k words). Ask the paginator instead: if the doc is arith-eligible it computes the bands
AND every block's exact render height with NO layout read. Then the window STAYS ON with exact
reservations — only the on-screen blocks lay out — and the exit is O(visible). The bands are applied
inside the dispatch, so they still land in THIS task, atomic with the pin. EXPERIMENT A: the un-skip
IS the cost. Keep the window on and re-derive the bands in the PLACEHOLDER regime — exactly what
every mid-gesture step already does (onZoomStep routes to liveCache/readBands when `.iw-zoom-live`
is on), and those frames are fine. No arith.

THE DEFERRED EXACT UN-SKIP. The fast exit leaves the content-visibility window ON, so off-screen
blocks still reserve their (approximate) placeholder heights: the SCROLL RANGE is off by up to ~5%
(measured 20,931px on a 20k-word doc) until each block is scrolled into view and `auto` remembers
its real size. Visible bands are exact regardless (they are read from the same regime the text lays
out in), so nothing on screen is ever wrong — but the scrollbar would lie. So we still pay the
un-skip; we just pay it when the writer is IDLE, never in the gesture's own frame. Anchored on the
first block crossing the viewport top so the exact relayout can't jump the page, and scheduled only
on genuine idle: any input pushes it back, so it never lands in a gesture or a scroll.

<a id="scroll-pinch"></a>
### Phone pinch — and pan-while-pinching

PHONE PINCH-TO-ZOOM — LIVE font reflow per lattice step, exactly like the desktop wheel
(Peter, 2026-07-10: *"I want live reflow with better performance — do everything off the
screen lazily; anchor to the point between the two fingers"*). The performance budget comes
from the LIVE-REFLOW WINDOW: during the gesture, off-screen blocks skip layout
entirely (content-visibility: auto — a phone screen holds ~one screenful of text, so each
zoom step lays out only that in real time). ANCHOR: the pinch MIDPOINT's vertical position
(applyFrame's phone branch picks the text block at pinchX/pinchY and holds its displacement
to zero) — horizontal is inherently fixed by the full-width reflow. Feature-detected: where
content-visibility is unsupported (iOS < 18) the same live pipeline runs against the full
document (correct, just heavier).

INPUT-PIPELINE COST (round-2 iPhone lag, 2026-07-10): a NON-PASSIVE touchstart / touchmove
on the whole surface makes iOS synchronously dispatch EVERY touch to the main thread and
wait — so touchstart stays PASSIVE (records pinch state only), and the non-passive
touchmove is attached ONLY while two fingers are down (armed synchronously inside the
second finger's touchstart, before any move can dispatch). Pinch suppression = that
preventDefault + the CAPTURE-phase document backstop + gesture* preventDefault
(entry.client.tsx) + the universal phone `touch-action: pan-x pan-y`.

Fresh gesture → anchor the TEXT POSITION under THIS midpoint, from the pre-gesture layout (before
the live window's placeholder switch), so the pin holds exactly what the fingers grabbed for the
whole gesture. That hit-test is the touchstart task's ONLY layout-touching work — the live window
enters lazily at the first commit.

PAN-WHILE-PINCHING (2026-08-20, Peter: *"it doesn't work if the average centrepoint of your
two fingers zooming is panning at the same time"*). Before this, the two fingers' MIDPOINT
was captured once at touchstart and never touched again — pinchDist (the SEPARATION) was
the only thing this handler ever updated. `e.preventDefault()` unconditionally blocks
the browser's own native two-finger pan/scroll (deliberately — we're replacing its pinch),
so a real-world gesture that pinches AND drags at once had its drag half go nowhere: the
zoom ratio kept working (distance-based, translation-invariant), but the content refused to
follow the fingers moving together, which reads as "doesn't work" even though it's really
"only half the gesture is implemented". Fix: track the midpoint's OWN frame-to-frame
movement and apply it as a direct, additive scroll offset — independent of the zoom-step
commit path (that only fires when a LATTICE step crosses, i.e. rarely; this must
track every touchmove or the pan reads as sticky/laggy). Phone is never CSS-scaled
(hybrid = fill && !phone in magnify.ts), so a screen-pixel delta maps 1:1 to a scroll-pixel
delta with no unscale conversion needed. VERTICAL goes through getScrollTop/setScrollTop —
NOT `el.scrollTop` directly — because on phone scrolling is the WINDOW (window.scrollY /
window.scrollTo), not the surface div (el.scrollHeight === el.clientHeight there; the
surface is never itself the scroller), and setScrollTop also records guardScrollTop so the
zoom guard loop recognises this as OUR write, not a user scroll to rebase against. pinchX/Y
then update to the CURRENT midpoint (was stale at the touchstart position) so the anchor
fallback re-pick and the zoom-commit anchor also track where the fingers actually are now,
not where they started.

Phone is BODY-scroll: the anchor correction must move `window.scrollY` — the surface itself never
scrolls there (`el.scrollTop` is always 0). One pair of helpers keeps applyFrame + the settle
re-anchor identical for both scrollers.

At touchend the final commit LANDS NEAREST the fingers (round the fractional remainder), then the
live-reflow window closes — both in the same task, one paint, anchored throughout. A pinch that
never committed a step arms no settle, so the hold is released there.

<a id="scroll-chrome"></a>
### The paper chrome, the twinkle host, and the scrollbar fade

The scroll "paper" chrome — the white page surface and the parchment column with its drop
shadow. Shared by BOTH the live editor (TiptapEditor) and the prerendered/loading shell
(EditorShell) so the static landing page is a direct visual function of the same components
+ CSS. Style changes here flow to both. Both wooden rollers are now removed and the page is
pulled up near the top of the viewport (see the `.inkwave-editor-surface` rule in
styles/index.css). Long-term the parchment grows a vectorised torn-paper edge; keeping the
chrome in one shared component makes that a one-place change.

Gapped mode draws a separate-sheet drop shadow at EACH page break (the rounded caps in
PaginationExtension); the single tall outer shadow would otherwise bleed continuously down the
left/right edges and through the gaps, so it is dropped and the per-gap caps do the work.

Stochastic twinkles (sparkles + accent dashes — see waveTwinkle.ts). The container div is in
the JSX (and the prerender) EMPTY; the random instances are populated client-side after
hydration, so the server HTML and the first client render always match (no mismatch, and no
flash: each instance mounts only after its art decodes). Live-editor surfaces only (fill):
sparkles run while the load drift/coast does; the dashes decorate ALL stages on desktop
(drift, coast, resting sway — static between scrolls) but exist only during the load on phone
(no waves at rest there). `useLayoutEffect` deliberately: the mode handoffs (coast start, rest
transform) must land in the SAME pre-paint flush as the wave class swap — a passive effect
ran after paint, leaving one visible frame where the dashes stood still against moving waves.

PHONE + covered: no twinkles on that host, and — critically — do NOT call syncTwinkles at all:
waterMode is GLOBAL, and that surface's early drop to 'off' (settleToCoast) would clobber the
shell's live coast for every host. The shell owns the water until wave-rest. The same reasoning
governs `settleToCoast`: a phone covered surface renders NO wave classes, and a class-less surface
has nothing to coast, so it drops straight to rest.

No animation-composition (pre-2023 engines): no brake possible — stop cleanly instead. Read the
drift pose from the animation clock, hand it to the sway, done. A hard stop, not a coast;
acceptable degrade on engines none of our targets ship.

Scrollbar idle-fade (desktop fill only): the thumb shows while scrolling or when the pointer is
near the right edge, and fades out (via `.iw-sb-idle`) after 1.4s of inactivity, so at rest only
the waves remain in the channel. ARMED ONLY AFTER THE LOAD WAVES REST (waveMode 'off' — 2026-07-09
regression fix): the toggles used to land during the drift (classList.add at hydration; the
restore-scroll's show() + its 1.4s re-add timer), and each one ran the 0.3s scrollbar-color
transition — a per-frame repaint of the scroll container's bar region (Firefox repaints the whole
scroller) that read as the "jump at ~0.7s / bigger jump at ~1.4s" in the wave drift.

<a id="scroll-guides"></a>
### `PageGuides` resolves the sheet from its OWN ref

Page guides (ungapped mode): a faint dashed rule + page number at each page BREAK. The break
positions come from the pagination extension's zero-size break markers (`.inkwave-page-gap
.iw-break-marker`) — the SAME line-measured breaks gapped mode uses, derived from the canonical
physical page height in pageModel — so toggling the gapped switch never moves content across
pages, and the on-screen breaks are the print/PDF breaks. Falls back to the uniform canonical
model (topMargin + n×textArea) where no markers exist (loading shell, SnapshotView, multi-column).
Purely visual overlay (no content reflow).

Our OWN overlay div — the sheet is resolved as its `parentElement`, NOT via `sheetRef`. React
attaches host refs bottom-up during commit, so on a fresh mount a CHILD's useLayoutEffect runs
BEFORE the parent's sheetRef is attached: `sheetRef.current` was null in production, the
effect bailed without wiring its ResizeObserver / pagination-measured listener, and the page
guides never rendered (the "dotted lines disappeared" regression, 2026-07-09 — introduced when
this went useEffect → useLayoutEffect for the paint-with-the-text reveal). Dev never showed it:
StrictMode's double-invoked effects re-ran after the ref attached. A component's ref to its own
rendered element IS guaranteed set in its own layout effects — and parentElement is structurally
the enclosing `.scroll-paper`, so this can never resolve to another surface (e.g. the loading
shell's), either.

The guides depend on client-only state (paper size / gapped, both from localStorage), so the
prerendered shell and the client's first render disagree → hydration mismatch. Gate on a post-mount
flag so the FIRST client render matches the shell (nothing), then the guides fill in a tick later.

Pre-decode both logo variants once, so a new page appearing during zoom-out paints its logo in the
same frame instead of popping in a beat late (image decode is async even from cache).

---

## `TiptapEditor.tsx` — the editor surface, the footer band, and the load choreography

<a id="editor-lazy-chunks"></a>
### Lazy must stay lazy, and a flag must be read INLINE

LAZY, AND IT MUST STAY LAZY (2026-07-17). A static import put the whole report lane —
the modal, report/compile.ts and its prompt strings — inside THIS chunk, which every writer
loads, with the flag off and no chunk of its own to show for it. `{reportOpen && <Modal/>}` is a
RENDER guard and `if (reportFlag)` is a RUNTIME guard; neither can stop the bundler. flag.ts's
"ZERO load-path cost … neither panel is imported unless asked for" was measured false in the
built output while that comment sat two lines above the flag it described. Verify in
`react-router build` output, never in the source: a separate chunk file is NOT evidence of
laziness (fixtures had its own chunk and was still statically imported, hence preloaded).

The measured writing-charts panel (P1a-viz) is LAZY for the same reason: its charts + fixtures
must never ride the editor's eager graph (`scripts/prodLoadPath.prove.mjs`). The trigger lives in
the clock drop-up (ClockMenu), which is eager — but that button only calls a callback, so no chart
code reaches this chunk.

THE SAME RULE APPLIES TO FLAG READS. The wave-video, btDebug and textRender gates read their
localStorage / URL flags INLINE rather than importing a `…Enabled()` helper: importing a helper to
decide whether to import the module would pull the module on every load and make "off costs
nothing" false. That is exactly why `textRenderFlag.ts` lives alone.

The textRender probe surface is MEASUREMENT ONLY, never a user feature. The plaintext page
renderer is measured IN THE REAL APP — live doc, real shipped fonts, real DPR — never a harness
that reimplements the context (the trap that has burned this codebase five times). It is a
1477-line probe that installs `window.__iwTextRenderProbe` and walks the doc; it must NEVER install
for a real writer. It is DELIBERATELY NOT gated on `textRenderEnabled()`: that flag is now DEFAULT
ON (the rich /snapshot pane ships live), so gating the probe on it would hand every writer the
harness. It arms instead on the FRESH `?textRender` URL param — what every .prove.mjs navigates to,
and only them.

The iOS break-table store test (`inkwave:btDebug`, default OFF): Peter opens `/?btDebug=1` on his
iPhone 8, on the live site. The store's OPFS layer is proved on Chromium, but Chromium has
createWritable — iOS takes opfsWrite.ts's OTHER branch (worker createSyncAccessHandle, ONE handle
per file or it throws), which has never executed with this store and which CI physically cannot
reach. The store's first execution found two bugs that were invisible until the code ran; this asks
those same questions on the device.

<a id="editor-commit-doc"></a>
### One commit path for a document mutation

Every mutation must do the same three things in the same order: make the new document the one
this component reads (`docRef`), tell the parent (`onDocChange`), and schedule the write
(`scheduleSave`). This was written out longhand at ten call sites, which is ten chances to omit
the third line — and omitting it is SILENT: the edit appears on screen, the parent re-renders,
and only the DISK is stale, so the work is lost at the next reload rather than at the moment of
the mistake. `email.prove.mjs` caught exactly that omission once (a header edit never called
`scheduleSave`, because autosave is driven by the editor's own update handler and a header field
never fires it), and nothing but a browser probe could have.

NB `ensureDocFresh` deliberately does NOT use this: it CACHES a lazily-built document into
`docRef` and is not a mutation — there is nothing to tell the parent and nothing new to save.

The email header block is the live instance of the rule: a header edit is a document edit, and
NOTHING else saves it. `docRef` is updated FIRST so any snapshot/finalise work that reads it sees
the new headers immediately.

<a id="editor-scroll-memory"></a>
### Where you were, across a hard refresh

2026-08-28, Peter: *"very useful as I have to keep hard refreshing for testing"*. Written on a
settled scroll, restored once the document has its real height — i.e. AFTER the reveal and the
first pagination, because a paginated document is dramatically shorter until the gap widgets land
and restoring against that shorter range would clamp the offset to nothing. The rule itself (clamp,
refuse a materially different document, ignore the very top) is pure and lives in
`editor/scrollMemory.ts`. It tries across the settling window rather than once: fonts, pagination
and the reveal each change the height, so a single attempt lands before the document is its real
size, and it only counts as restored once the write actually took.

<a id="editor-unsynced-notice"></a>
### The unsynced notice's tick, and its probe seam

A slow tick, and ONLY while a warning is actually pending: nothing to re-render once sync is
live, dismissed, or before the first unsynced edit. (The reducer returns its input unchanged on
a no-op edit, so useReducer bails out and typing never re-renders the shell — the
console-snappy rule.)

PROBE SEAM (the `__iwRasterDprCap` / `__iwAnchorRule` pattern): shorten the threshold so the
wiring can be DRIVEN and observed in a live browser instead of waiting five real minutes — a
feature whose only proof is "the rule is unit-tested" is a feature nobody has ever seen fire.
Undefined in every real session ⇒ the constant in unsyncedWatch.ts applies.

The editor's onUpdate closure is long-lived, so sync state is read through a ref: the first
unsynced edit must be judged against the CURRENT destination, not whatever was live at mount.

<a id="editor-unsynced-clock"></a>
### The clock starts at REAL WORK — a change the writer caused

Both halves are needed, and each was PROBED (scripts/tabdoc-probe/unsynced.mjs):

- A docChanged transaction ALONE is wrong: the editor fires them during LOAD, so the clock
  started at page load and the notice would nag someone who opened Inkwave, typed nothing and
  walked away (cells 1+3 caught exactly that).
- `beforeinput` alone is wrong too: it never fires here — ProseMirror's input pipeline means
  the event is simply absent (measured: 0 events at document capture while typing). A signal
  that never arrives silently disables the feature, which is this codebase's signature bug.

So: user input ARMS the clock, and the next real document change starts it. Caret moves and
load-time transactions do neither.

<a id="editor-alt-hints"></a>
### The Alt hints must not react to a shortcut in progress

Peter, 2026-08-23: *"my ctrl del and opt del aren't working bc these numbers keep coming up on the
pill buttons and interfering"*. Alt is a MODIFIER before it is a hint trigger: on macOS ⌥⌫ is
delete-word-left and ⌃⌫ its cousin, so a writer taps Alt as part of a chord many times a minute.
Showing the badges on Alt's keydown meant every one of those re-rendered TiptapEditor's whole tree
BETWEEN the modifier and the key it modifies — and this component deliberately does not re-render
per transaction (`shouldRerenderOnTransaction: false`) precisely because that tree is expensive.
So the hint now waits for a DELIBERATE hold: Alt alone, unaccompanied, for ALT_HINT_DELAY_MS. Any
other key arriving cancels it, which is exactly what a chord is. The teaching affordance is
unchanged for someone who holds Alt to look — that is a pause, not a chord — and Alt+digit still
works instantly either way, because the hotkey handler never consulted `altHeld`.

`altHeld` flips only on Alt's own down/up — never per keystroke — and the ref guard stops key-repeat
from setting state 30×/second while Alt is held.

<a id="editor-hotkey-tap"></a>
### The hotkey IS the tap

It dispatches the slot's OWN button click rather than calling the slot's action, and that is
deliberate: every slot owns its open state privately (GuideMenu, PageMenu, MediaMenu, SettingsMenu,
ClockSlotButton all differ), so an "action registry" would mean a SECOND way to trigger each one —
two roads that drift the first time a slot changes what its tap does. Routing through the real
button makes divergence unrepresentable: the keyboard and the finger are the same event, by
construction.

<a id="editor-slot-drag"></a>
### Phone touch-hold drag-to-reorder

HTML5 drag events never fire from touch in this UI (and the iOS long-press guards deliberately
swallow the native gestures), so phone reorder is hand-rolled: hold a circle ~400ms → it arms
(scale-up pulse = the haptic-feel cue), drag horizontally → neighbours FLIP-slide out of the way
(transform-only, 180ms) previewing the drop, release → the order commits + persists. Coexists with
the guards: `.iw-touch-guard` suppresses selection/loupe, the slot wrappers get `touch-action:none`
(per-element — it doesn't inherit), and the post-drop synthetic click is swallowed.

<a id="editor-track-changes"></a>
### Track changes cannot outlive its own control

2026-08-28, Peter: *"stop the text from going red"*. The ✎ toggle lives on the review row and
nowhere else, so with the row closed the mode was invisible AND unreachable while still rewriting
every keystroke into a red insertion mark — Peter spent a session in it, reaching for the
text-colour menu, which cannot touch a suggestion mark. Closing the row now ends the mode. The
suggestions already made are untouched: they are marks in the document, and reopening the row shows
them with accept/discard.

The bar exclusion RULE is pure and lives in toolbarContract.ts (`planBarToggle`, swept over every
(active, which) pair by its tests). `toggleBar` is only its hands: the timing, the sequence guard
and the style bar's idle timer. Adding a layer changes NOTHING there.

<a id="editor-rerender"></a>
### `shouldRerenderOnTransaction: false`, one extension list, one mount

RE-RENDER STORM FIX (2026-07-11, the ablation's #1 keystroke cost): @tiptap/react's legacy
default re-renders the OWNING component on EVERY transaction — every keystroke, caret move,
SCAS repaint and pagination meta re-ran this whole ~2,500-line tree (footer, panels, menus).
With it off, re-renders happen only when React state actually changes. Everything the render
body used to read live off `editor.state` is mirrored into state by the selection-tracking
effect (selectionEmpty + selIsAtomNode); StyleBar/ReviewBar self-subscribe.

THE ONE EXTENSION LIST — moved verbatim to extensions/editorExtensions.ts so /snapshot, which
has no editor, can build the SAME schema and turn a version's contentJson into a real PM Node
(the plaintext renderer's blocker). Same entries, same order, same configure() args; the call
returns a fresh array per render exactly as the inline literal did. A schema-only COPY of the
list was rejected — two lists is how the model drifts from what the editor paginates.

DOUBLE-MOUNT NOTE (2026-07-11): this component must mount in a default-lane render — NOT a
time-sliced one (lazy/Suspense retry). useEditor's in-render creation + its 1ms
scheduleDestroy safety timer otherwise race across the slices: two full editor creations
and a doubled reveal chain per load. Edit.tsx holds the resolved module in state (no
Suspense) precisely for this.

<a id="editor-kdsync"></a>
### Keydown-synchronous typing

Task #28, flag `inkwave:kdSync`; desktop default ON, touch default OFF — the virtual keyboard's
native path + autocorrect must never be intercepted. Plain printable keys dispatch their
ProseMirror transaction synchronously IN the keydown task, so the character paints in the SAME
frame — instead of the native route (browser mutates the DOM → PM's MutationObserver reconciles a
task later). `handleTextInput` runs first, exactly like the native path, so input rules (smart
quotes, math shortcuts, citation triggers) behave identically. Backspace/Enter are already
keydown-synchronous via the keymaps. Guards: no modifiers (shift ok), no IME composition, no open
word-cycle (it owns j/k/space/tab), text selections only.

<a id="editor-scas-tick"></a>
### The SCAS tick: deferred, windowed, and parked during a zoom

CONSOLE-SNAPPY RULE — a keystroke does no O(doc) work. The engine scan (processDoc walks every
committed word) and the decoration rebuild both move to ONE debounced tick ~120ms after the last
input; the decoration plugin meanwhile just position-maps its existing marks through each edit (see
RedHighlightExtension.apply). Deletion tracking accumulates across the debounce window so the
lock-on-delete rule still sees every deletion. The tick's own repaint transaction carries
SCAS_HINT_META → never re-arms.

SCAN WINDOW bookkeeping: accumulate WHERE this debounce window's edits landed, in current-doc
coordinates — map the running range and the last-tick caret through this edit, then union this
transaction's own changed range (each step's new range, mapped through the steps after it). The
tick hands the union to processDoc so the scan is O(window), not O(doc). Cost per keystroke is
O(steps) — no doc walks.

ENGINE KILL SWITCH (diagnostic/benchmark only): `inkwave:scasEngineOff='1'` disables the whole
SCAS tick (scan + decorations). NB the USER's "SCAS suggestions" toggle (`inkwave:scasOff`) is a
separate DISPLAY-only flag and must NOT stop the tick — the words stay remembered.

PHONE: the tick's engine scan + decoration rebuild is O(doc) — ~7ms/10k words in Node, several ×
slower on a phone CPU (tens of ms on a thesis-length doc), and at 120ms it landed between keystrokes
during normal typing. 250ms keeps it in genuine gaps; verdicts freeze at commit anyway, so a later
repaint changes nothing semantically. Desktop stays 120.

ZOOM-GESTURE DEFERRAL (Peter, 2026-07-10 "lag in the reflow zoom"): the tick's engine scan +
decoration rebuild is the heaviest non-visual work that can land mid-gesture — and a decoration
repaint REBUILDS paragraph DOM, which detaches an active pinch's touch target (iOS keeps dispatching
to the original node → the gesture dies). While a zoom gesture holds the painters (`__iwZoomHold`,
cleared at settle), park the tick and retry — it flushes ≤150ms after the settle. Verdicts freeze at
commit anyway, so a deferred repaint changes nothing semantically.

WINDOWED TICK (phone 2026-07-10; desktop joined 2026-07-11 — the tick's O(doc) scan + decoration
rebuild at the 120ms cadence was part of the desktop "waves of lag"): scan only where this tick's
edits/caret moves happened — the window = accumulated edit range ∪ last-tick caret ∪ current caret
(a word commits when the caret LEAVES it, so both caret paragraphs must be scanned). Full scan
stays for: any tick with a DELETION (the engine's vanished-lemma pass needs whole-doc word presence
— the phantom-snapshot guard), and the decoration repaint whenever the tick DID change state (a
verdict change repaints every instance of that lemma doc-wide). Windowed ≡ full equivalence is
unit-pinned in scas/controller.window.test.ts + extensions/redHighlightWindow.test.ts.

Deletion ticks are windowed too (round-4 "deleting lags in waves"): the controller's whole-doc
presence INDEX answers the vanished-lemma pass, so the scan never needs to leave the window.

Always repaint: the deferred decorations need it after edits, and it refreshes the cursor-word
suppression after pure caret moves. Windowed splice only when nothing outside the window can differ
(no state change, no open popover) — else full rebuild.

The paragraph index feeds the thesaurus popover and must track SELECTION moves too (clicking into a
paragraph), so it stays above the docChanged gate. It is an O(blocks-before-caret) walk that returns
false at each textblock so it never descends into inline content; React bails on the same value.

<a id="editor-docchanged-gate"></a>
### The docChanged gate, and no serialization on the keystroke

Everything below the gate serializes the document / re-renders the shell — and this handler fires
for EVERY transaction: caret moves, the SCAS hint repaint, and the pagination extension's two
per-keystroke meta dispatches. Paying full-doc getJSON + a React re-render + an IndexedDB write up
to 3× per keystroke was the dominant lag source. Selection-only transactions stop there.

CONSOLE-SNAPPY RULE: no serialization on the keystroke either. The document object is rebuilt
lazily (ensureDocFresh: getJSON + title + bibliography) at the first point that actually needs it —
the 200ms save beat, any snapshot/signing work, or a mirror. The beat stays data-only; the shell
re-renders only when the title changed.

The productivity ledger's session capture rides the SAME stream and derives counts from the SAME
`countSteps` primitive — no new content instrumentation. O(steps): it compares two numbers and
increments three fields. Every O(doc) number the ledger needs is computed at session CLOSE, off this
path. Flag default OFF and cached in a module variable, so the disabled cost is one boolean test.

Insignia's cadence tap folds a transaction's steps into the current 0.5s bin. Counts only — never
chars — and inert for the free tier (`cadenceTierActive()` false ⇒ the tap is never created).

<a id="editor-enter"></a>
### Enter must do NO O(doc) work on the keystroke

The paragraph-snapshot trigger takes a cheap top-level count first and only collects the paragraph
TEXTS when the count actually grew by one — the full textContent collection on every keystroke was
an O(doc) walk for a check that is almost always false. It then reads ONLY the completed
paragraph's text (round-4 Enter "mega lag": collecting EVERY paragraph's textContent was an O(doc)
string build ON the Enter keystroke).

Round-4 Enter "mega lag" (b): the snapshot chain (ensureDocFresh getJSON + JCS canonicalize + hash +
OPFS write + OTS stamp) started right on the Enter keystroke. It is deferred to a GENUINE input
pause — content is captured at WORK time (enqueueSnapshotWork always ran ensureDocFresh at work
time, so the capture-drift semantics are unchanged in kind); the buffer bookkeeping stays
synchronous so Enter ordering is deterministic.

<a id="editor-word-count"></a>
### Word count runs only while the panel is open

Live word count for the record panel, debounced: `getText()` walks the whole doc, and a panel
readout doesn't need per-keystroke precision — 300ms after the last edit is indistinguishable.
The readout only renders INSIDE the open ◈ panel (ReceiptPanel is controlled on all platforms now),
so while it's CLOSED we don't count AT ALL — the O(doc) string build + unicode regex + the
editor-shell re-render otherwise landed in every typing pause (desktop counted every 300ms of a
100-page doc for a hidden number — the 2026-07-11 ablation). Opening the panel counts immediately
(the effect re-runs on receiptOpen) and keeps counting while open.

<a id="editor-keyboard-dock"></a>
### The keyboard: detection, the dock, the PM reserve, and the focus guards

Detect the on-screen keyboard from the visual viewport: when it's up, the visible height drops well
below the LARGEST height seen (its no-keyboard height). Comparing to the tracked max — rather than
to `window.innerHeight` — is robust to iOS quirks where innerHeight tracks the keyboard, and
`offsetTop` is ignored (a scroll offset, not the keyboard) so page scroll doesn't fool it. A 150px
threshold ignores URL-bar resizes. Soft keyboards only exist on touch devices: on desktop, browser
ZOOM also shrinks `visualViewport.height`, which would falsely read as "keyboard up" and hide the
snapshot/sync pills (and skew the baseline so they never return). Pinch-zoom on touch is filtered
via `visualViewport.scale`.

`keyboardUp` is mirrored to a window flag so non-React code can read it — PaginationExtension's
phone edit debounce stretches while the keyboard is up (reflow mid-composition is worthless).

PHONE: the footer toolbar HUGS the keyboard instead of retracting — pinned flush to the visual
viewport's bottom edge (keyboard top / URL bar) at ALL times. iOS never resizes the layout
viewport for the keyboard, and scrolling with the keyboard up PANS the visual viewport within
it — during which WebKit composites the pan WITHOUT re-running layout, so writing a layout
property (the old `bottom`) left the bar drifting anywhere the pan took it ("all over the
shop"). The dock (editor/toolbarDock.ts) instead slaves a compositor-path transform:
translateY(-off) on the fixed wrapper, one write per frame while the geometry moves (rAF
follow loop — vv events are sparse mid-slide and unreliable in momentum tails), parked once
stable. `--iw-kb-offset` still carries the same value for the scroll-padding reserve (outside
React, so re-renders never clobber it).

Rubber-band detection: during elastic overscroll fixed elements ride the elastic layout viewport
and vv geometry goes garbage — the dock freezes (see toolbarDock.ts).

KEYBOARD-SLIDE CHASE (Peter round 2, nice-to-have): iOS reports the keyboard's final geometry in
one/few big resize steps — a raw write teleports the bar. A LARGE jump gets a short ease-out
transition (transform-only; CSS retargets smoothly if another step lands mid-glide), so the bar
visually chases the slide. Small per-frame follow deltas (pans, momentum) stay immediate — never
transition those, the compositor tracking IS the mechanism.

TAP-REVEAL (Peter round 2: *"revealed the moment you tap, not on the first key"*): iOS runs its OWN
focus pan AFTER the keyboard geometry settles, which can re-park the caret just above the keyboard
but BEHIND the pill. Two delayed no-op-guarded passes (keepCaret only scrolls when actually
obstructed >4px — the single-reveal rule holds) catch whatever iOS does after our settle. Cleared on
any new episode.

Keyboard-up page scrolls fire window scroll even when vv events go missing (momentum tails);
`check()` is two property reads and only kicks on real drift. A watchdog probes every 500ms because
vv events can be missed around load/orientation races, so the bar can never stick wrong.

The toolbar band is RESERVED space: `--iw-toolbar-h` mirrors the footer pill's LIVE height (it grows
when the style/review rows open — the RO tracks the animation) so index.css can pad the phone
surface's bottom and scroll-padding every scroller, keeping the caret, selection handles and
scrollIntoView targets ABOVE the toolbar + keyboard. Rect height, not offsetHeight: it includes the
desktop ×1.12 scale transform.

ENTER-CARET FIX (2026-07-11, Peter: *"press Enter … the cursor isn't visible until you type"*):
ProseMirror's own scrollIntoView (what Tiptap's Enter/splitBlock dispatches) IGNORES CSS
scroll-padding — it scrolls the new caret line to the scroller's RAW bottom edge, which is
exactly the band the floating toolbar reserves via scroll-padding-bottom (index.css). The
new empty line (and its caret) settled BEHIND the toolbar; the next typed character made the
BROWSER's native caret-reveal run, which does honour scroll-padding — hence "appears when
you type". Give PM the same reserve through its own mechanism: scrollThreshold (when a
position counts as too close to the edge) + scrollMargin (how far clear to scroll), kept in
sync with the live toolbar height by the ResizeObserver.

Pill height ONLY — do NOT add the keyboard offset. prosemirror-view's windowRect bottom is
ALREADY visualViewport.height (the keyboard is excluded from PM's window box), so a
kb-inclusive reserve DOUBLE-COUNTS it: the bottom rule then fires on every Enter (bounds
328 − 421 < 0) → +180px over-scroll, and the next Enter's top rule yanks −84 back — the
probed "screen moves, then moves again" bounce. The toolbar band above the vv bottom is a
CONSTANT h regardless of keyboard state; the CSS scroll-padding (a LAYOUT-viewport
scroller mechanism) is the one that needs `--iw-toolbar-h` + `--iw-kb-offset`.
+28 over the pill: PM scrolls the CARET rect clear, but the paragraph's line box extends a
few px of leading below it — clear the whole line, with margin to spare. `setProps` triggers a
full PM updateState, so skip when nothing changed (the dock settles after every scroll episode) —
but never skip a NEW view, since editor recreation must be re-synced.

MENU FOCUS GUARD (Peter round 2: *"the toolbar retracts when opening menus"*): on iOS any tap
outside the contenteditable blurs it → the keyboard dismisses → the docked pill (and the
just-opened menu) slide to the screen bottom mid-interaction. The pill used to preventDefault
its own pointerdowns, but every drop-up PANEL is PORTALED to `<body>` — taps inside Settings/
Options/Page/Guide/Math dropped focus. One document-level capture guard covers the pill AND
every portaled panel (they all carry `.iw-touch-guard`): while the editor owns focus,
preventDefault pointerdowns on guard surfaces so focus (and the keyboard) stay put. Real
form fields inside menus are exempt — they legitimately take focus — as are reading surfaces
(the source reader's article body).

iOS touch-and-hold guard, half two (half one = `.iw-touch-guard` user-select CSS): a touch that
STARTS on the toolbar or any of its drop-ups must never start a text selection mid-slide when
the finger moves up onto the editor — touch events keep firing on their START target, so one
document-level non-passive touchmove preventDefault covers every guard surface, including
portaled menus. Touches that start in the editor itself are untouched (long-press selection
there still works). Capture-phase + first-touch-only so a second finger can't drop the guard.

<a id="editor-reveal"></a>
### The reveal chain, and the deliberate delay

BOTH platforms: start the coast FIRST, on this light frame — 'inkwave:reveal-imminent'
freezes + class-swaps every drifting surface (shell + this editor's own, in lockstep —
see Scroll.tsx). The freeze must NOT share the reveal commit (the busiest frame of the
load): the compositor kept drifting while that commit blocked the main thread, so a
same-commit freeze snapshotted a stale offset and the waves snapped ~7px BACKWARD when
the coast started (the reveal flicker, Chrome + Firefox desktop, 2026-07-09).

PHONE (Peter's spec): waves decelerate first; at 1.5s the shell drops instantly and the
page + chrome fade IN over the still-coasting waves for the remaining 0.5s — the fade
completes at 2s, the moment the waves reach rest. DESKTOP (Peter, 2026-07-10, second tune): the
page fade-in starts AT coast start — no extra wait (the 1s fade runs over the first 1s of the 2.5s
coast; the slowdown stays visible for another 1.5s after the fade completes). Two clean frames
between the coast class swap and the heavy reveal commit — the coast is compositor-driven and
already easing smoothly when the commit lands. rAF can starve on a wedged/backgrounded main thread,
so a timeout cap still fires; reveal is idempotent.

THE DELIBERATE DELAY (Peter, 2026-07-17: *"make it show at least one loop before the file comes up.
purposefully delay it. (And use that time to warm up the document)"*). "Warm up the document" needs
NO code of its own: fonts.ready, the first pagination measure and the editor's own mount are ALREADY
running through this window. The delay just stops the reveal cutting them short — the warm-up is
what the load was doing anyway, given room.

THE FLAG IS READ INLINE, never imported from waveVideo: importing a helper to decide whether to wait
would pull the whole video module into the editor bundle on every load and make "off costs nothing"
false. OFF ⇒ `waveLooped` is an already-resolved promise and this gate is byte-for-byte the old one.

ASK, THEN SUBSCRIBE, in ONE synchronous block — the video can loop before we get here, and a
bare addEventListener would then wait for an event already in the past, forever. waveVideo
fires this on EVERY exit (wrap, bail, decode timeout, autoplay refusal, settle), so it is a
signal that always arrives.

AND IT IS CAPPED HERE, INDEPENDENTLY. That guarantee only holds if the MODULE LOADED — a
chunk 404 or a parse error fires nothing, and the failure mode would be a document that never
appears. The document must never depend on the animation succeeding.

The 1200ms safety cap predates the video and would fire straight through a ~2s loop, undoing the
delay on every load. With the video ON it becomes the loop gate's own backstop (7s) plus the old
margin; with it OFF the constant is untouched. The pagination extension measures in BOTH page modes
now (gap widgets / break markers), so always wait for its first measure — the 1.2s cap covers any
mode where it never fires.

<a id="editor-archive-reads"></a>
### Every action that publishes or overwrites the record reads through one guard

`listSnapshots` now THROWS when it cannot read the archive rather than answering `[]` — because
`[]` meant "no history" and every one of these actions would then have written or exported an
empty history over Peter's real one (see provenance/snapshots.ts). But a throw reaching a click
handler is just a button that does nothing, so each action reads through `snapshotsForAction`: on a
failure the action is CANCELLED and says so, instead of quietly shipping a gutted record.

Cancelling is the safe direction for all of them and none of it touches typing: an export, a
cloud sync and a folder mirror are all re-runnable, and the archive is still on disk. What is
NOT re-runnable is a .studio the writer believes holds his proof, or a OneDrive copy overwritten
with one snapshot. Note it returns `[]` happily for a genuinely new document — an established
emptiness is not a failed read, and first-save must keep working forever.

A failed refresh must never REPLACE a good list with an empty one — the panel would then assert, in
the UI, the exact lie the storage layer no longer tells. Keep what we have and log.

THE EAGER LOAD IS WHERE A FAILED READ WOULD BECOME VISIBLE AS A LIE: leave `snapshots` at []
and the receipts panel renders "no snapshots yet" over a full archive — the storage bug's
exact claim, now made by the UI, at the moment the writer opens his thesis. It also had no
`.catch`, so the throw would only ever be an unhandled rejection. Say it plainly instead.
The LIST itself loads EAGERLY — rapid snapshot scrubbing is a core feature, so the reviewer never
waits for it. The OTS Bitcoin re-check does NOT run there: it re-writes the compressed snapshot file
per snapshot + does serial calendar round-trips (~10s), which was the startup lag. It runs only when
the receipts panel is opened (runOtsSweep), throttled. New snapshots are still stamped on creation.

THE SILENT-DISABLE SEAM on the word-nudge path. `createSnapshotIfChanged` reads the archive itself
and now refuses rather than write over a history it couldn't read — correct, but on its own it would
make provenance stop accruing with nothing but a console warning (enqueueSnapshotWork swallows the
throw). Peter would keep writing, believing he was building his authorship trace, and find the gap
when it was too late to fix. Reading through the guard there means the failure is SEEN. Typing is
untouched either way: that whole queue runs off the typing path. "Save version" is guarded for the
same reason — a save that silently did nothing is the worst possible answer at the moment the writer
is deliberately marking work. And a bundle exported from a failed read is a FALSE receipt.

The folder mirror separates the archive READ from the WRITE deliberately. Both used to land in the
same `.catch`, which would now report a transient archive fault as "your folder permission lapsed"
and drop the link — a wrong story and a needless interruption. A failed read means only: skip THIS
mirror. The link stays live and the next kick mirrors the full archive. A failed WRITE does mean
permission lapsed — stop claiming "synced" and prompt a reconnect.

The Drive mirror is a silent auto-mirror: a failed archive read skips this cycle rather than pushing
a short archive at Drive. `.catch(() => {})` already swallowed sync errors there; the read failure
joins them, but it must never reach `syncToGoogleDrive`.

The OneDrive write is throttled to at most one PUT per interval, with a trailing flush so the final
state always lands. Fewer writes ⇒ fewer races with the OneDrive desktop client ⇒ no machine-name
copies.

⚠ `oneDriveWriteNow`'s local-read CHECK IS DEFENCE IN DEPTH, NOT THE LOAD-BEARING GUARD — recorded
because it was claimed to be the latter, and a lane that trusts the wrong line stops guarding the
right one. PROBED + mutation-proved (`storage/cloudLocalRead.test.ts`): the PRE-FIX composition
`listSnapshots(id).then(s => syncToOneDrive(doc, s)).catch(() => {})` ALSO refuses — because
`listSnapshots` now THROWS on a failed read and the fire-and-forget `.catch` swallows the
throw before the sync is ever called. What actually stands between a failed local read and
Peter's archive is `readSnapshotsFromDisk`'s throw (M13: restore its `catch { return [] }`
and cells die). This check earns its place for two OTHER reasons, both worth keeping: it
makes the refusal VISIBLE (a named warning, not a silently swallowed rejection), and the
`SnapshotRead` union is what stops the next edit here writing `.catch(() => [])` — the one
caller shape that still destroys the archive, pinned as a known-negative in that file.

<a id="editor-no-auto-delete"></a>
### A failed VERIFICATION is not a forged snapshot

⚠ THIS LOOP USED TO `deleteSnapshot` EVERY SNAPSHOT WHOSE RECEIPTS WERE ALL "BAD", AND IT
DESTROYED PETER'S HISTORY — 79 Bitcoin-anchored snapshots down to 4, twice, reproduced in a
clean browser here (79 → 78 → 76 → 73, a few seconds after load, one per yielded tick).

THE CAUSE IS THE PREMISE, NOT THE LOOP. A chain that fails `verifyChain` has NOT been shown
to be forged — it has been shown to be unverifiable BY THIS BUILD, WITH THIS KEY. And the
commonest reason is completely innocent: `signingPublicKeyHex()` (provenance/receipts.ts)
returns the DEV key under `import.meta.env.DEV`, so every document signed by the production
service fails every chain the moment it is opened on localhost. Peter develops on localhost
and opens his real thesis there. Every receipt-bearing snapshot was therefore "bad" and was
deleted; the survivors were exactly the receipt-less ones (`snapReceipts.length > 0` spares
them), which is why the count always settled on the same small number.
A rotated key, an older bundle, a partial receipt set or a future key-id would each do the
same thing to a real user in production.

THE RULE, and it is this project's own, one level along: a failed READ is not an empty
archive (readSnapshotsFromDisk), a failed read is not an absent document (opfs.ts) — and a
failed VERIFICATION is not a forged snapshot. None of those may be answered with deletion.
Provenance is append-only; the writer's evidence is not ours to discard to make a check go
green. The receipt chain is reported as unverified (the ReceiptPanel already surfaces chain
status), and the snapshots STAY. Nothing here may delete provenance again — if a genuine
forgery case ever needs handling, it belongs behind an explicit writer-initiated action,
never an automatic background sweep.

The re-read before the purge exists for the same family reason: the recovery pass may have
appended, and we bail again rather than delete from a list we couldn't confirm.

<a id="editor-banner-kind"></a>
### The banner has two voices

KIND, not one voice for everything: the blind-overwrite guard's messages are GOOD
news ("nothing was overwritten"), and shouting them in the red ⚠ error banner told
the writer their thesis was in trouble at the moment it had just been protected.
The info variant is calm and themed (tokens with day fallbacks); the error variant
keeps its existing red.

`iw-nightable` on the INFO variant only: the night tokens (`--iw-ink` et al) are scoped
INSIDE that class, so without it these vars would silently resolve to their day
fallbacks on a night background. It also re-surfaces the banner to dolphin grey in
night, which is right. The ERROR variant must keep its red — being alarming is its
job — so it stays outside the themed surface. The info background stays a literal
`#faf7ff` rather than a token: `.iw-nightable` overrides it at night anyway, and a token here
would have to carry a day value that disagrees with `--iw-subtle-bg`'s `#fcfcfb`.

<a id="editor-side-reserve"></a>
### The footer band is three independent fixed elements

`TOOLBAR_SIDE_RESERVE_PX` is the visual px reserved on EACH SIDE of the centred footer toolbar for
the edge-anchored pills that share its band — SyncStatus (`right:0`, ~138px painted: max-w-7.5rem +
padding, ×1.12 scale) and ReceiptPanel's snaps pill (`left:0`, ~96px painted). Sized to the larger
of the two plus a ~12px gap. All three are independently `position: fixed` with no awareness of each
other, so without this reserve the centred toolbar grows straight into the sync pill on a narrow
window (measured: collision begins at ~650px viewport width).

THE SIDE-PILL COLLISION, AND THE ONE BUDGET THAT PREVENTS IT (2026-08-20).
MEASURED (viewport sweep, real browser): the footer pill is CENTRED (its wrapper is
`fixed left-0 right-0 flex justify-center`) while the sync pill (SyncStatus, `right:0`)
and the snaps pill (ReceiptPanel, `left:0`) are EDGE-anchored — three independently
positioned fixed elements sharing one band, with nothing making them aware of each
other. At ≥700px they never touch, which is why every earlier attempt (tested at
900–2000px) "passed" while Peter's screenshots still showed the sync pill sitting on
top of the toolbar's right edge: he runs a ~600px-wide window (half-screen on a
Retina Mac). Overlap begins at ~650px and worsens below it.

TWO EARLIER FIXES FAILED FOR THE OPPOSITE REASONS, and both lessons are baked in:

1. A bare `maxWidth: 58vw` on the box alone → the box shrank but the CIRCLES did
   not (their clamp keys off a different budget), so the row overflowed its own
   rounded border: "the right button is falling off".
2. Removing the cap entirely → nothing bounded the centred pill at all, so at a
   narrow window it simply grew into the sync pill again.

So: ONE number, `--iw-bar-budget`, is the maximum width the toolbar may occupy, and
BOTH constraints derive from it — the box's max-width and the per-circle
shrink clamp in index.css (`.iw-desktop-toolbar`, which inherits the var). They cannot disagree,
because there is only one of them. The reserve is per SIDE and is measured, not guessed. Divided by
the transform scale, because max-width is a LAYOUT property while the collision happens in VISUAL px
— a 421px layout pill paints 471px wide at ×1.12, and it is the painted box that hits the sync pill.

The pill counters browser zoom with `transform`, not `zoom`: `zoom` scales the positioned `bottom`
offset and the pill drifts up/down on zoom. ×1.12 = the "bigger pills" boost, desktop only — on a
phone the bar is `w-full`, so any upscale makes it VISUALLY 12% wider than the screen and the end
buttons clip.

⚠ A COLLAPSED ROW STILL HAS A WIDTH (2026-08-20 — the real cause of the toolbar's
proportions repeatedly looking "wrong again"). `max-height: 0` hides the style row but
does NOT remove it from the pill's WIDTH calculation: the pill is a flex column, so
its width is the widest child's max-content — and the style bar (font picker, size,
B/H/align/list/∀) is WIDER than the circle row. So the pill was being sized by a row
nobody can see, leaving the circles adrift in it (measured: 86px of empty pill to the
right of the last circle) and no amount of tuning the circle rules could fix it,
because they were never what set the width.
`width: 0` drops the row's intrinsic contribution so the VISIBLE row sizes the pill;
`min-width: 100%` then makes it fill whatever width that turns out to be, so it still
lays out correctly when it expands. Growing the pill when the style bar opens is
correct and intended — it just must not do so while collapsed.

Phone: the keyboard/URL-bar lift is NOT part of `bottom` — the dock (editor/toolbarDock.ts) writes
`translate3d(0,-kbOffset,0)` imperatively on the wrapper per frame. transform composites during iOS
pans; `bottom` (layout) does NOT apply mid-pan, which left the bar floating "all over the shop".
Never move the lift back into a layout property, and never transition transform there.

When the PDF panel is open: a side dock stops the centring box at the docked edge
(`--iw-pdf-room` right / `--iw-pdf-room-left` left) so the toolbar recentres over the writing; a
bottom dock lifts the whole toolbar above it (`--iw-pdf-room-bottom`).

<a id="editor-row-slots"></a>
### One row size, derived from the row itself

PHONE AND DESKTOP ARE ONE EXPERIENCE, SO THEY ARE ONE NUMBER (Peter, 2026-07-17:
*"there's only 6 slots not 7 which I think is a good number because it fits well on
phone… we want to keep the phone and desktop experience continuous"*). The phone
circle size is (100vw − 45px) / (the row + ▲ + ⋮), and index.css used to divide by a
literal 8 — a SECOND copy of ROW_SLOTS, in another language, that no lane would think
to update. The whole justification for six is that it fits the phone, so the phone's
fit must be derived from six rather than agree with it by coincidence.

⚠ 2026-08-20: this was STILL feeding the CSS var the static ROW_SLOTS constant (6)
rather than the row's actual live length — so once a 7th slot graduated to default-on
(the clock), the shrink formula kept dividing by 8 (6+2) instead of 9 (7+2), leaving
exactly one circle's worth of width unaccounted for. That's what "hung off the right"
in the screenshot — the ⋮ options button had nowhere to go. `toolbarSlots.length` is the
exact array rendered below (`toolbarSlots.map`), so it can never drift from what's on
screen the way a re-typed constant can.

Phone row layout: `iw-phone-toolbar` (index.css) sizes the EIGHT circles (▲ + 6 slots + ⋮ — S and ⚙
are SLOTS now; ◈/☁ live in the ▲ drop-up) to (100vw − 45px)/8 and caps each button's 44px min-WIDTH
at the same size; `justify-between` spreads the ~45px of slack as ~6px breathing-room gaps. `py-1.5`
(vs desktop `py-0.5`) gives the row vertical air — the footer RO mirrors whatever height results
into `--iw-toolbar-h` + the PM scroll reserve, so never hardcode the pill height anywhere.
`iw-slot-dragging` paints every circle's disc opaque while a drag is live so the lifted one passes
OVER its neighbours. A click synthesised from a just-finished touch-hold drag must not activate the
dropped button (or close the bars) — it is swallowed in the capture phase.

The music row is the second-bar layer the music slot opens, with the same collapse animation as the
style/review rows and MUTUALLY EXCLUSIVE with them by the TYPE (`activeBar` holds ONE id —
toolbarContract.ts). This lane owns the SHELL; components/MusicBar.tsx is the clearly-labelled STUB
the music lane fills. The review row stacks ABOVE the main toolbar like the style bar: the pill is
bottom-anchored, so it grows upward and the main row never moves.
