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
