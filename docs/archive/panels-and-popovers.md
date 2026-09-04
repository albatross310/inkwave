# Panels, popovers and the surfaces around the editor — the stories behind the rules

The **why** for the productivity clock drop-up (`components/ClockMenu.tsx`), the document-open
route (`routes/Edit.tsx`), the colour ratchet (`styles/colourScan.ts`), the PDF export/reflow
helpers (`components/pdfAnnotatedPages.ts`, `components/pdfReflow.ts`), the SCAS controller
(`scas/controller.ts`) and the word-cycle popover
(`editor/suggestions/ThesaurusPopover/ThesaurusPopover.tsx`).

Each source file carries its rule as a short imperative comment ending in a pointer to an anchor
here; this file carries the incident, the measurement and the hypothesis that was refuted.

Read the section that owns your area before proposing an alternative. Most of what is here has
already been measured, and several plausible alternatives have already lost.

Convention: `docs/archive/README.md`. Rule form: `docs/RULES.md`.

---

## `components/ClockMenu.tsx` — the toolbar clock and the ledger drop-up

<a id="clock-why-a-dropup"></a>
### Why it is a drop-up and not a route

Peter, 2026-07-17: "a new button with a picture of a clock on it in the toolbar for all these new
productivity features, with the ledger. Make the ledger a drop up rather than a new page."

The ledger stops being a route and becomes part of the writing surface: a Pomodoro you must
navigate away to reach is not one you would use while writing.

THREE HOUSE RULES, all live bugs elsewhere before they were rules:

- `iw-touch-guard` on the panel — any tap outside the contenteditable blurs it on iOS, the
  keyboard retracts, and the docked pill + its just-opened menu slide to the screen bottom.
- `iw-nightable` + theme tokens with day fallbacks, never a hard-coded hex. Nobody had looked at
  these panels in night mode when they were written.
- Nothing here ticks React. The face and the ring subscribe to the store's imperative tick
  channel (TimeFace/TimeRing) — this component re-renders only on real state changes.

TONE (§A5): a ritual, not a dashboard. Sexy here means considered — no red numbers, no scores,
no streak-shaming. A quiet day reads as a quiet day.

<a id="clock-type-ramp"></a>
### One type ramp, and what is actually true about the 16px floor

TYPE (Peter, 2026-07-17): "the entire text font of the panel needs to be increased. It's okay if
users have to scroll." / "Every font proportionally up." Sizes come from the ONE ramp
(`music/typeScale.ts`) — the same one `GoalsSection` already uses. NOT a second scale: two
lanes wrote competing ramps once and that is how this repo forks. A `text-[11px]`/`text-xs` class
anywhere in this file is a regression; the steps are SEMANTIC (`TYPE.label` because the thing IS a
label), which is what stops the ramp regrowing into nine near-identical sizes.

SCROLLING IS NOT A COST TO MINIMISE HERE. The panel is `maxHeight: 72vh` and overflows — that is
the accepted trade, not a bug. Do not shrink a step to kill a scrollbar.

THE 16px FLOOR — and what is actually true about it (MEASURED, `scripts/cssfloor.prove.mjs`):
iOS Safari zooms into any focused control under 16px and STAYS zoomed. But index.css ALREADY
floors `input, select, textarea` at `max(16px, 1em) !important` inside
`@media (pointer: coarse) and (hover: none)`, and the probe confirms in a real engine that this
beats an inline 13px on an iPhone 12 (computed 16px; desktop correctly leaves it 13px). So the
13px inputs these panels shipped were NOT zooming Peter's phone — they were backstopped.

The floor stays on the ramp regardless, for reasons the backstop does not cover:

- It is phone-ONLY. Any coarse device the query misses gets the authored size, unfloored.
- It is INVISIBLE HERE. A 13px in this file reads as 13px to everyone; that a stylesheet three
  directories away silently rewrites it on one device class is exactly the kind of spooky action
  that makes a number untrustworthy. The authored size should BE the shipped size.
- Peter asked for bigger text anyway. 16 is the ramp's floor because it is the ramp's floor.

`prodType.test.ts` fails the build if any control here slips under it, and DERIVES the CSS
backstop's 16 from this ramp rather than re-typing it.

<a id="clock-day-summary"></a>
### `daySummary` — the second implementation that broke §A6.1

⚠ THIS IS A SECOND PLACE THE DAY'S MINUTES ARE SUMMED — `aggregate.ts` is the other — and it is
exactly how §A6.1's rule got broken once already. THE BUG, caught live by `pdfposthoc.prove.mjs`
driving the real panel: this function reduced over ALL rows, so the moment the post-hoc add landed,
45 remembered minutes were reported back to the writer as "focused minutes". Every unit test was
green — they guard `aggregate.ts`, and the drop-up never calls it. **A guard on one implementation
of a rule says nothing about the other.**

So the split happens HERE too, and the two numbers are spoken as different KINDS of thing. If a
third summariser ever appears, it must do the same — or better, all three should call one rule.

<a id="clock-trigger-not-owner"></a>
### The clock slot is a TRIGGER, never an OWNER

The panel's open state is LIFTED to the editor (`ledgerOpen`), and this button only calls the
setter. That is load-bearing now that Peter has ruled the row stays SIX ("it fits well on phone,
and we want to keep the phone and desktop experience continuous"): `clock` competes for a slot and
lands in the ▲ overflow by default, so this component is often NOT MOUNTED. If it owned the state,
the countdown's "click to open" would silently do nothing whenever the clock sat in ▲ — a feature
that vanishes depending on where a button was dragged. Two access paths, one owner.

<a id="clock-nav-shell"></a>
### The nav shell — five buttons, and a sixth is one array entry

Peter, 2026-07-18: "The clock button opens a panel with FIVE buttons (more to add later)." So this
is a NAV SHELL, not one long scroll: a home screen of buttons, and each opens its own view. It
reuses the existing pieces UNCHANGED behind those buttons — the pomodoro, the goals section, the
report, the charts, the ledger — rather than reimplementing any of them (a second copy of any of
these is the failure).

The five, designed so a sixth is one array entry:

1. Start / stop work → WorkView (the pomodoro + the WHERE/WHAT start flow + the end summary)
2. Goals → GoalsSection
3. Reporting → the AI report modal (a lifted opener; closes this panel)
4. Progress tracking → the charts modal (a lifted opener; closes this panel)
5. Manage projects → ProjectsView (today's sessions, notes, reading, reflections, titles)

"Manage projects" is the OLD drop-up's ledger content — today's sessions, the reading indicator,
the reflection journal, the per-document title controls — now behind its own nav button rather
than stacked under the timer. Nothing there is a second implementation of the ledger; it renders
the same pieces.

<a id="clock-reading-indicator"></a>
### The reading indicator shows only what we saw, and has no progress bar

Peter: "a reading indicator on the ledger, next to a pdf name".

SHOWS ONLY WHAT WE SAW. A PDF that is open but unscrolled does not appear — that is the honest
state, not a detection failure: an open PDF nobody is scrolling is a tab you forgot about, and
counting it is exactly how a reading number stops being true. So an empty section reads "no reading
right now", never "0 minutes read".

NO PROGRESS BAR — considered and rejected (§A3.2). We hold whether you scrolled, never where, so
there is nothing to draw a progress bar FROM, and a page-by-page trace of the writer's private PDFs
would be a far more sensitive object for no feature gain. If a progress reading ever seems needed,
that is Peter's call, not a field to add here.

<a id="clock-posthoc-form"></a>
### The post-hoc add — a friend letting you correct the record

Peter: "a manual add for if you forget to use the timer".

§A5's register decides every choice: **a friend letting you correct the record, not a supervisor
auditing your timesheet.** So it is COLLAPSED by default (an always-open form is a standing
question about what you failed to log), it never nags, and using it is never scolded — the
confirmation says what landed and stops talking.

**DO NOT MAKE HIM PRECISE.** Rough duration, rough category, done. A form demanding start and end
times won't get used on a Tuesday, and this whole feature dies if the ritual becomes data entry.
Hence PILLS, not number inputs: every answer is one tap. The note is optional and a skipped note is
not a failure.

The honesty lives in the ROW (`entered: 'post-hoc'`), not in this form's copy — which is why the
form can afford to be this relaxed. See types.ts.

---

## `routes/Edit.tsx` — opening a document, and the load choreography

<a id="edit-critical-path-split"></a>
### The critical-path split, and the double-mount fix

CRITICAL-PATH SPLIT: the editor graph (Tiptap/PM, KaTeX, the 30k-word list, citations, Clerk)
is the bulk of the app's JS. Lazy-loading it means the tiny shell chunk hydrates immediately —
waves + drift on screen — while the editor chunk downloads IN PARALLEL with the OPFS document
read, instead of everything executing serially before anything can mount.

The import is kicked EAGERLY at module scope (2026-07-11): `lazy(() => import(...))` alone only
starts the fetch on the component's FIRST RENDER — i.e. after setDoc — so the chunk fetch+eval
was actually SERIALIZED behind the whole storage read (measured on Chromium: chunk request at
4.0s, the moment the doc resolved). Kicking it at module scope restores the designed parallelism:
the fetch+eval overlap the OPFS/IndexedDB load, and any storage stall no longer adds to boot.
(Browser only: the prerender/SSR pass must not eval the editor graph at module scope.)

DOUBLE-MOUNT FIX (2026-07-11, "the editor mounts TWICE per load"): the module is consumed via
STATE, NOT React.lazy/Suspense. `lazy` always suspends its first render (even with the
promise long resolved), and React retries suspended boundaries at TRANSITION priority — a
TIME-SLICED render. @tiptap/react's useEditor (default immediatelyRender) creates the editor
synchronously inside that sliced render, and its 1ms not-yet-mounted safety timer
(scheduleDestroy) fired between slices: editor #1 destroyed mid-render, the mount effect built
editor #2 — two ~950ms creations and every `[editor]`-keyed effect (the whole reveal chain,
pagination-ready, reveal-imminent, editor-revealed) running TWICE per load. Holding the
resolved component in state mounts it in ONE default-lane (non-interruptible) render+commit
task, so the timer can never interleave — one editor, one reveal chain, and creation still
starts early (in-render). Do not reintroduce lazy/Suspense here.

<a id="edit-one-shell"></a>
### ONE persistent loading shell, and the phone ordering guard

The old shape rendered the waves surface in THREE tree positions across a load — the `!doc`
return, the Suspense fallback, then the editor's own surface — and each swap REMOUNTED
`.inkwave-editor-surface`, recreating the wave pseudo-layers: the two predictable flashes during
load. Now a single shell instance spans `!doc` + the lazy editor chunk + the editor's pre-reveal
settle. It renders AFTER (so on top of) the mounting editor — both are opaque fixed surfaces, DOM
order stacks them; the editor's floating chrome keeps its explicit z-indexes above, exactly as
before — and unmounts in the SAME React commit the editor reveals (`inkwave:editor-revealed` is
dispatched in the same task as `setSettled(true)`, so React batches shell-unmount + reveal + the
wave coast start into one paint). The editor's surface underneath is phase-synced to the same wall
clock (`--wave-phase`, set pre-paint), so the swap is pixel-identical.

`'up'` → covering; `'fading'` → 0.5s opacity cross-fade (doc/text/pills fade in atomically
underneath, over the still-coasting waves); `'down'` → unmounted.

THE SHELL IS PRERENDERED (build-time: no window → phone=false), and React production hydration
does NOT correct attribute mismatches — so on a phone the shell used to run the whole load
DESKTOP-classed and only gained `.is-phone` when shellUp changed at reveal: the wave rule-set
(coast duration/distance vars) switched under a RUNNING animation mid-coast → position jump, early
animationend, early shell drop (Peter's "jumps to the last section", 2026-07-10). The class is
corrected in the first post-hydration commit instead — the water is still display-gated
(`.iw-water-ready` decode) then, so the swap can never be seen. It is a LAYOUT effect because the
correction must land before the first post-hydration paint; racing the atomic-water gate (slow
cold hydration) would land the desktop→phone rule swap mid-drift and restart the running wave
animations.

PHONE (2026-07-11, the iOS "goes white" fix): ONE visible water until rest, and the shell must NOT
fade — fading the only water exposed the body parchment through the transparent covered editor
MID-COAST. Instead the shell stays fully OPAQUE (`'up'`) and the covered editor sits ABOVE it
(z-raised, transparent — `.iw-wave-covered.is-phone`), so the parchment + chrome fade in OVER the
still-decelerating water. At `inkwave:wave-rest` the shell drops and the editor uncovers in one
commit — parchment-to-parchment, no mid-motion swap. (wave-rest ALWAYS arrives: the rest handoff
is a resolved-clock timer over compositor-only playback; the 30s load watchdog in Scroll.tsx is
the one backstop.)

ORDERING GUARD (2026-07-11): wave-rest is compositor-clocked while the reveal is a main-thread
timer + React commit — on a slow phone the coast can END before the paper above has finished its
0.8s fade-in. Dropping the shell then would flash parchment through the half-faded paper. So the
drop waits for BOTH: the waves at rest AND the fade complete (revealedAt + 850ms). The still water
lingering a few hundred ms is invisible next to a pale flash.

<a id="edit-strictmode-lock-race"></a>
### The StrictMode double-invoke race behind "another session is open"

⚠ 2026-08-20 — the actual cause behind "another session is open" appearing after a completely
ordinary refresh with only one real tab involved (reproduced 100% of the time in isolated
single-tab headless testing — no second tab, no other browser context, nothing else running).
`entry.client.tsx` wraps the app in `<StrictMode>`, which in DEV deliberately
mount→cleanup→remounts every effect once to surface exactly this class of bug — and this effect
had no cleanup at all, so BOTH invocations ran their full async claim sequence for real. TWO
consequences, both observed directly via `navigator.locks.query()`:

- On a brand-new tab (no stored id yet), each invocation calls `newDocument()` independently
  and claims its OWN fresh random id — so the tab ends up holding TWO document locks at
  once, with only the SECOND invocation's id ever written to sessionStorage. The first id's
  lock is now an ORPHAN: nothing releases it, ever, for the rest of that page's life.
- On a reload (both invocations resolve the SAME stored id from sessionStorage), they RACE
  for that one lock via `claimDocLock`'s `{ifAvailable:true}` request — Web Locks does not
  special-case "same page", so the loser sees it as unavailable exactly as it would from a
  genuine second tab, and calls `setBlocked(...)`. Whichever invocation's setState call lands
  LAST wins the final render — so even though the winner ALSO successfully opened the
  document, the loser's blocked screen can still be what's on screen, PERMANENTLY (nothing
  ever retries after this point; matches the 8+ second observed persistence).

FIX: the standard React cancellation-token pattern, but it has to do more than skip stale setState
calls — it must also RELEASE any lock a cancelled invocation already claimed, or the orphan leak
still happens even with mismatched UI state avoided. `claimedId` tracks whatever THIS invocation
currently holds; every commit point clears it (the claim is now "real", owned by the component for
its lifetime) and every early-exit / cancellation path releases it first.

<a id="edit-tab-identity"></a>
### Whose document, and who gets the blocked screen

THIS TAB's own document — `?doc=`, else the per-tab sessionStorage identity, else (brand-new tab
only) the last-doc hint. See `storage/tabDoc.ts` for why the per-tab identity is authoritative and
the URL is not: OneDrive's sign-in redirect returns to a bare `/`, so a tab must be able to
remember its document with no help from the URL. This is what stops another tab's document switch
from re-pointing this tab on reload.

ONE LIVE TAB PER DOCUMENT (tabDoc.ts): two tabs on one file blind-autosave over each other and one
tab's words are destroyed — `saveDocument` writes the whole file with no union and no generation
check. So if another LIVE tab is already editing this document, this tab does NOT open it. A plain
reload re-claims normally (the lock follows the page, and claimDocLock retries past the unload
race), so this only ever fires for a genuinely concurrent second tab.

WHO GETS THE BLOCKED SCREEN. Only an EXPLICIT request for this document — a `?doc=` link/bookmark,
or this tab's own remembered identity — earns the choose-how screen: the writer meant THIS
document, so silently opening a different one would be the wrong-doc switch this whole mechanism
exists to stop. A brand-new tab that merely inherited the origin-wide last-doc hint had no opinion
about this file, so it falls through to open the next document no live tab holds (never block a
fresh tab on a doc it didn't choose).

<a id="edit-fresh-tab-blank"></a>
### The IndexedDB fall-back is a RECOVERY, and a fresh tab is not recovering

⚠ NOT FOR A BRAND-NEW TAB (2026-08-28, Peter: "when I open a new tab it always keeps reverting to
this one thing Honours Proposal … what we need is for new tabs to open as blank"). This walk is
what actually did the reverting — removing the last-document hint was necessary and not
sufficient, because a tab with no identity fell through to here and opened the most recent free
document, which is the same document every time.

The walk is still right for the case it was written for: a tab that HAD an identity and found that
document gone (deleted, or never synced to this device) should land on the writer's
next-most-recent work rather than a blank page. That is a recovery, and a recovery should try. A
fresh tab is not recovering from anything — it has no opinion about any document, and answering it
with someone's thesis is a guess that collides with whichever tab already has it open.

<a id="edit-read-failure"></a>
### A read failure is not an absent document

We do NOT know that the writer has no work — we know the opposite is possible, and their document
may be sitting on disk perfectly intact. So: never mint a document (a blank page IS the bug: it
tells them, wordlessly, that their thesis is gone), never touch the active-doc pointer (repointing
it at a blank is how the real one gets lost from view), say so, and put the recovery surface one
click away.

That conclusion is what sent Peter to a backup file, which then overwrote the real thing. Say what
happened, offer the retry that usually works, and put Storage — the recovery surface that can SEE
and export every document on the device — right there rather than buried in a menu they have no
reason to trust right now.

<a id="edit-shell-is-the-editor"></a>
### The shell is a CSS function of the editor

The persistent shell is the SHARED empty-editor facsimile — the same `Scroll` chrome + an empty
`.ProseMirror` the live editor uses — so the prerendered landing page (doc=null, shellUp=true →
shell only) is a direct CSS function of the editor, and the editor reveals under it with no visual
jump. `key={doc.id}` → switching documents in place cleanly remounts the editor (sessions,
snapshots, sync reconnect all re-run for the new doc). No Suspense here — the shell on top provides
the loading visuals, and the editor must mount in a default-lane render.

---

## `styles/colourScan.ts` — the palette ratchet

<a id="colourscan-why"></a>
### Why a ratchet, and the number that justified it

CLAUDE.md's THEMING section makes a promise: "Adding a new scheme later = one more
`:root[data-theme=…]` block; components don't change." Measured against master (2026-08-30) that
promise is false, and the number says how false: 892 colour literals sit in production TS/TSX with
no token anywhere near them — 127 of them `#5c2d8a`, the app's own ink, which HAS a token. A
literal in a component is invisible to every `:root` block ever written, so each one is a surface
that a new palette cannot reach and that only a human eye reports. Peter had been reporting them
one at a time for a week.

Nothing stopped the drift, so this is the thing that stops it: a RATCHET. Every file carries the
count it had when the gate landed; the gate fails when a file EXCEEDS its cap, and a file the
baseline has never heard of is capped at ZERO. Removing literals never fails, so the migration —
and the three colour lanes in flight while this was written — can only make the gate greener.

WHAT IS AND IS NOT A VIOLATION:

- BARE `background: '#fff'` — counted. It cannot theme. This is the defect.
- FALLBACK `var(--iw-ink, #5c2d8a)` — NOT counted. It is CLAUDE.md rule 2, the sanctioned
  intermediate form, and it is the shape a lane fixing a night bug writes on its way from
  bare to tokenised. Capping it would fail the gate on the fix. It is REPORTED instead
  (`scanTree().fallback`) because it is not the destination either: a fallback only ever
  applies when the token is undefined, so a live one means the palette has a hole.

COMMENTS ARE STRIPPED BEFORE SCANNING, deliberately and not as a nicety. This repo's comments must
name the colours they forbid in order to forbid them — this file's own header names `#5c2d8a`, and
index.css explains `--iw-on-ink` by quoting the white-on-#cbb8f2 bug it fixes. CLAUDE.md records
three separate lanes in one round whose guards fired on their own documentation, and the tempting
fix each time was to delete the sentence. A guard that cannot survive its own explanation gets
disabled.

`COLOUR_RE` deliberately does NOT match named CSS colours (`white`, `black`): `black` is also an
English word and a font weight, and over-collecting prose is how a guard earns the reputation that
gets it deleted. Named colours are rare here and the migration catches them by eye.

<a id="colourscan-strip-comments"></a>
### `stripComments` is a state machine, not a regex

A plain `.replace(/\/\/.*$/gm, '')` truncates any line holding a URL in a string literal, and a
naive block-comment strip eats a regex or a template. So this is a small state machine over
code/string/line-comment/block-comment. It is not a parser and does not need to be: the only
question it has to answer correctly is "is this hex inside a comment".

<a id="colourscan-token-contract"></a>
### The token contract — the quieter failure

Everything above counts literals. This half checks the OTHER failure, and it is the quieter one: a
`var(--iw-x, #fallback)` that reads a token nobody ever declared is INDISTINGUISHABLE at a glance
from one that works — it renders the fallback, in every theme, forever, with no error. The reader
lane found `--iw-panel-bg` that way (declared nowhere, read by two live surfaces); this sweep also
found `--iw-score-gap` and `--iw-gap-rule` in src/music/ScorePage.tsx.

It is DERIVED FROM SOURCE on both sides — the tokens components actually read, against the tokens
index.css actually declares — rather than a hand-written list, which is the drift that
`contrastWalkerContract.test.ts` exists to stop one directory over.

The dangling check has to separate colour tokens from the layout ones (`--iw-toolbar-h`,
`--iw-kb-offset`, `--iw-tap-x`, `--iw-align`…), which are set imperatively from JS and are
correctly absent from the stylesheet. Doing that with a hand-written list of layout names is that
same drift, so it is derived instead: a token is a colour token when a call site passes it a
colour. `transparent` and `currentColor` count — they are values of a colour property, and a token
whose only fallback is `transparent` is still a colour a palette may want to re-point.

<a id="colourscan-normalise"></a>
### `normaliseColour` — two bugs that MANUFACTURED findings

Both were caught only by reading the list it produced rather than by trusting its count:

1. The first cut stripped trailing alpha zeros with a regex that could never fire, so
   `rgba(…,0.10)` was reported as drift from `rgba(…,0.1)` — 2 of its 14 "findings" were the
   instrument's own.
2. The fix then ran the numeric normaliser over HEX too: `#000000` is all digits, so it became
   `Number('000000')` = `#0`, and `--iw-page-num` was reported as drift from itself. A
   normaliser that changes what it is comparing is worse than none.

Hence the two branches are kept apart: hex is expanded and lowercased and NEVER arithmetic; only
the components inside rgb()/hsl() are compared as numbers. `sameColour` exists for the same reason
in the other direction: `#fff` and `#ffffff` are the same paint, and a guard that called them a
mismatch would force a cosmetic rewrite of every call site to say nothing.

<a id="colourscan-runtime-written"></a>
### `runtimeWritten` — two spellings, because one alone is a false instrument

`el.style.setProperty('--iw-x', …)` and React's inline-style key form
`{ ['--iw-x' as string]: '6px' }`. Scanning only for `setProperty` finds 13 properties and MISSES
`--iw-tap-x`, `--iw-row-slots` and `--iw-wave-x` — which is exactly enough of a gap to make a
"these are all runtime channels" exemption quietly wrong.

This is corroboration, NOT the line the dangling check draws. The line is "is it a COLOUR token",
derived from the fallbacks call sites pass — a runtime-written property is fine, and an undeclared
COLOUR token is the bug (`--iw-panel-bg`, `--iw-score-gap`, `--iw-gap-rule`). Several of these must
stay imperative for measured reasons: CLAUDE.md records that declaring `--iw-wave-x` as an
inheriting custom property invalidated the whole page subtree, p50 417ms → 50ms.

---

## `components/pdfAnnotatedPages.ts` — the marked-up PDF, as pages

<a id="pdfpages-one-mechanism"></a>
### One mechanism behind both Print and Export, and why it re-renders

Peter: "we need a three dots button with an export and print button that export/print the marked
up pdf as a pdf … or to printer." The marks are not in the PDF bytes: highlights, underlines,
strikes and sticky notes live on `_iw.highlights` and are drawn as DOM overlays (see
pdfHighlights.ts). "Export the marked-up PDF" therefore means PRODUCING A NEW DOCUMENT that has
them. This module makes that document once, as an array of page images, and Print and Export are
two ways of handing the SAME pixels to the writer.

⚠ IT DOES NOT REUSE THE ON-SCREEN CANVASES, and the brief's first candidate was exactly that.
Three facts in PdfViewer.tsx rule it out, each of which would silently degrade or blank a page:

1. Only pages near the viewport are rendered sharp at all; the rest hold a BASE canvas drawn at
   0.2–0.45× (BASE_SCALE_MIN/MAX) — a print of that is a smear, and it is the state most pages
   of a long PDF are in at any moment.
2. On touch, `evictFarPages` frees far sharp canvases outright (iOS canvas-memory budget). A
   print built from what happens to be resident would vary with how the reader scrolled.
3. The on-screen canvas is sized for the READER'S ZOOM, which is a viewing choice, not a print
   resolution — at fit-to-width on a small panel it is well under 150 dpi.

So each page is re-rendered from the pdf.js document at a chosen print scale, sequentially, and
released immediately after it is encoded. That also gives us the resolution guarantee the
on-screen path cannot: see `planAnnotatedRender`.

The marks are painted ONTO the page canvas rather than kept as overlay elements, so the exported
bytes and the printed sheet are the same picture by construction — the divergence CLAUDE.md keeps
recording as "two rules, one pane" is unrepresentable here.

`planAnnotatedRender` is honest about limits rather than silently truncating (the brief's
requirement, and this repo's standing rule that a failure must not be answered by quietly dropping
the writer's work): a document too large to hold at the 72-dpi floor returns `ok: false` with a
reason naming the page count, instead of exporting the first N pages and looking like it worked.

<a id="pdfpages-marks-without-geometry"></a>
### `marksWithoutGeometry` is about GEOMETRY, not about which view made the mark

⚠ The difference matters, because the obvious assumption is wrong. A mark made in the READER view
is identified by the text it covers, but `PdfReaderView.createFromSelection` also stores page rects
from `pdfReflow.rectsForRange`, "so the two views agree by construction"; notes made there get
rects too. So reader-made marks DO normally export. What cannot export is any mark whose `rects`
came back EMPTY — `rectsForRange` returns `[]` when the block is missing, the page has no measured
size, or no text segment overlaps the range — plus anything else that reaches storage without a
rectangle.

Such a mark is real and must not be deleted; it simply has no position to paint at. The caller
COUNTS these and tells the writer, because the failure this avoids is the silent one: a marked-up
export that is quietly missing marks looks exactly like a correct export.

<a id="pdfpages-what-is-painted"></a>
### What is painted, and what is editing furniture

Deliberately NOT painted: the × delete handles and the selection outline. Those are editing
furniture — controls that exist to change the document, not marks the reader made in it. A print
with a red ✕ beside every highlight is a screenshot of the app, not the annotated source.

Deliberately PAINTED: an EMPTY sticky note. It is a coloured box the writer placed on purpose,
and omitting a mark because it happens to hold no words is exactly the deletion-by-omission this
codebase refuses everywhere else. (It loses its on-screen dashed "type here" border: that is an
affordance for a control, and there is nothing to click on paper.)

`wrapNoteText` mirrors the on-screen note's CSS: `white-space: pre-wrap` (explicit newlines are
kept) plus `overflow-wrap: break-word` (a single word longer than the box is broken rather than
allowed to bleed out of it). Pure — `measure` is the only thing it needs from a canvas.

<a id="pdfpages-sequential"></a>
### Sequential and yielding, and one canvas at a time

A `Promise.all` over 200 pages would allocate 200 canvases before the first encode and take the
tab down on iOS (the same budget `evictFarPages` exists to respect). Each canvas is zeroed
(`width = 0`) the instant its JPEG exists — the viewer's own eviction path uses that trick because
GC alone is too late for iOS's canvas accounting. Peak canvas memory is therefore ONE page; the
accumulating cost is the encoded JPEGs, which is what `planAnnotatedRender` budgets.

<a id="pdfpages-print-html"></a>
### The printable document — one size, and blob: URLs

`@page size` can only name ONE size, so it takes page 1's; a PDF with mixed page sizes still
prints, with the odd pages scaled to the sheet width by `width: 100%`. Stated rather than
silently wrong — mixed-size PDFs are rare and a refusal would be worse than a scaled page.

The images arrive as blob: URLs, not data: URLs. A 200-page data: document is tens of megabytes
of base64 built on the main thread, which is the exact stall CLAUDE.md records for the old
hand-rolled btoa in the PDF store.

---

## `components/pdfReflow.ts` — reflowing a PDF page into paragraphs

<a id="pdfreflow-why"></a>
### Why it exists, and why the two directions live in one file

Peter asked two things that turn out to be one thing: "do we have a way of altering the line
spacing on the pdf to make it wider? Or to change the font", and later "build the reader view for
pdfs". A fixed PDF layout structurally CANNOT do the first — every glyph is at a coordinate the
publisher chose — so the answer to both is to stop drawing the page and re-set the TEXT.

This module is PURE and knows nothing about pdf.js: it takes the text items already placed in
viewport coordinates (the same items `textExtentsOf` and the pdf.js TextLayer read) and answers
three questions:

1. which characters form which paragraph → `buildPageReflow`
2. where in the reflowed text is this phrase → `anchorInPage` (page view → reader view)
3. which page rectangles does this text range cover → `rectsForRange` (reader view → page view)

(2) and (3) are the SAME mapping read in opposite directions, which is why they live in one file:
two implementations of "where is this text on the page" is exactly how the two views would drift
apart, and a highlight that moves when you switch views is worse than one that admits it is lost.

⚠ NOTHING HERE MAY GUESS. `anchorInPage` returns null rather than a plausible offset, because a
null is reported to the reader ("this mark could not be placed") while a wrong offset silently
colours words they never marked — the refusal `src/reader/marks.ts` was written around.

<a id="pdfreflow-lines"></a>
### Lines by vertical OVERLAP, and why banding is two passes

The line rule is vertical OVERLAP, not equality of `y`: a superscript, a smaller footnote marker
and an italic run all sit at slightly different tops on the same printed line, and requiring
equal tops shatters every line that has one into two paragraphs.

TWO PASSES, and the separation matters. Banding by y then sorting each band by x is a TOTAL
order; a single sort whose comparator asks "do these overlap vertically?" is not transitive
(A overlaps B, B overlaps C, A misses C), so `Array.sort` may return any of several orders for
the same page — a reflow that is not a function of its input, which every anchor here depends
on being.

<a id="pdfreflow-paragraph-breaks"></a>
### The four paragraph-break signals, and why (c) is the shyest

- (a) a vertical gap much bigger than the leading — the blank line between paragraphs;
- (b) a first-line INDENT — the other convention, used when there is no blank line;
- (c) the previous line stopped well short of the right margin, so the paragraph ended there;
- (d) the glyph size changed — a heading, a pull-quote, a footnote block.

⚠ (c) IS DELIBERATELY THE SHYEST OF THE FOUR, and it is a FRACTION OF THE MEASURE, not a
number of ems. It is a BACKSTOP for text that separates paragraphs by neither extra leading
nor indent — rare, because a document doing neither gives its own reader no way to see a
paragraph either. Ragged-right prose ends its lines a whole long word (≈5 ems) short as a
matter of course, so an em-based threshold either misses paragraph ends or shatters every
ragged paragraph into one block per line — MEASURED: at four ems the fixture in
pdfReflow.test.ts ('KNOWN-NEGATIVE: ordinary ragged-right lines…') split into two. Under
two thirds of the measure is a line that stopped early on purpose.

<a id="pdfreflow-anchor"></a>
### The anchor is a literal slice, and null is an answer

THE RETURNED `text` IS A LITERAL SLICE OF THE BLOCK, never the caller's string. That is what lets
`locateMark` (src/reader/marks.ts) re-find it later with a plain indexOf: the normalisation and
de-hyphenation happen ONCE, here, at creation, instead of being re-guessed on every load.

Returns null when the phrase is not in this page's text — the refusal. A selection that spans two
pages, or lands on a scanned image with no text layer, has no honest anchor and gets none.

<a id="pdfreflow-rects"></a>
### `rectsForRange` — derived, never a second source of truth

The page rectangles covered by [start,end) of a block, NORMALISED to the page box — exactly the
shape `redrawOverlays` already draws. This is what makes a highlight made in the reader view show
up in the page view: the rect is not a second source of truth, it is derived from the same segs.

Within one item the x position is interpolated by character count. That is the same approximation
the pdf.js text layer makes when it stretches a span to the item's measured width, so a selection
in either view lands on the same glyphs.

<a id="pdfreflow-nearest-block"></a>
### `nearestBlock` — a text box anchors to the nearest paragraph

Peter: "yes anchor text boxes at nearest text." A note dropped at page coordinates has no meaning
in a reflowed column (the coordinates describe a layout that is no longer being drawn), so the
note is attached to the paragraph it was nearest and travels with it. Paragraph-level placement,
which he accepted; the alternative is a note that floats in the margin of nothing.
