# The rule library

A **rule** is a comment that tells the next reader what must stay true. A **story** is a comment
that explains how we found out. Rules live beside the code; stories live in `docs/archive/`
(see `docs/archive/README.md`).

This file exists so rules are written in a standard shape and so a future pass can spot the
duplicated and the overlong ones quickly. Peter, 2026-09-04: *"when rewriting rules try to
standardise them and keep a working library… that will help future refactoring of comments and
future identifying of unnecessary/verbose rule inclusion."*

---

## The form

```
// ⚠ <THE RULE, IMPERATIVE, ONE LINE>. <One clause of consequence if broken.>
// → docs/archive/<file>.md#<anchor>
```

- **Imperative, present tense.** "Release only this tab's rule", not "we decided to release…".
- **The consequence, not the history.** *Why it matters if broken* is a rule; *how we discovered
  it* is a story.
- **⚠ only when breaking it causes damage** a test will not catch. Overused, it stops meaning
  anything.
- **A pointer, not a summary.** If the story is worth keeping, link it; do not paraphrase it.
- **No dates or round numbers in the rule line.** Those belong in the archive entry.

### Length budget

| kind | budget |
|---|---|
| a rule | 1–2 lines |
| a rule needing a consequence spelled out | ≤4 lines |
| a file header | ≤12 lines, or a numbered list of rules |
| anything longer | it is a story — archive it and leave a pointer |

---

## The patterns

Most rules in this repo are instances of nine recurring shapes. Naming the shape makes a rule
shorter (the shape carries the reasoning) and makes duplicates visible. When you write a new rule,
say which pattern it is; when you find two rules of the same pattern about the same mechanism, one
of them is redundant.

### R1 — An unknown is not a known-empty
A failed read, an absent answer, a timeout: none of them means "there is nothing there". The
commonest bug family in this codebase and the cause of six data-loss incidents.
> *"`readSnapshotsFromDisk` returns [] ONLY on NotFoundError; every other fault THROWS."*

### R2 — One definition, not two
A rule implemented twice agrees today and drifts the first time either side changes. Includes
constants, regexes, origin lists, and "the same formula in another language" (a CSS value that
restates a TS constant).
> *"`migrateSlots` resolves against `livePopulation()` — never a private copy."*

### R3 — A guard must be proved to fire
A test nobody has watched fail is decoration. Every guard needs a known-negative; every probe needs
a VOID path for "I cannot tell".
> *"Assert the matcher fires on known-bad copy AND is silent on an honest control."*

### R4 — A mechanism with no surface does not exist
If the writer cannot see whether a feature is on, it is indistinguishable from one nobody built —
and so is a feature that silently degraded.
> *"`via` is rendered, never inferred."*

### R5 — Measure in the real context
A harness that measures in a fiction certifies the fiction. Canvas parity measured outside a real
`.ProseMirror`, a probe against a page that never mounted, a build compared against a
non-deterministic build.
> *"Canvas-vs-DOM parity MUST be measured inside a real .ProseMirror."*

### R6 — A control that cannot fail proves nothing
If the assertion is satisfiable by the broken mechanism, it is not evidence. Ask of every green
check: what would have to be true for this to fail?
> *"The probe created frames from the top page, where the initiator IS Inkwave — so it passed by
> construction."*

### R7 — Decided once while the world kept moving
A value computed at one moment and used at another: an effect cleanup with the wrong lifetime, a
flag read in two places, a cached signature keyed on a counter, a rule applied at navigation time
to state that outlives navigation.
> *"React runs cleanup on every dependency change, so the code said something narrower than I meant."*

### R8 — Refuse rather than guess
When the right answer is unknown, do nothing and say so. Never store an unknown MIME as a photo,
never fabricate a join key, never invent an attribution.
> *"A hallucinated bar mis-anchors every note pinned to it and looks like a correct answer."*

### R9 — Scope by what the mechanism actually needs
A bound that sounds tighter but is the wrong axis fails silently: `initiatorDomains` where the
question was "which tab", `typeof window` where the question was "is there a store".
> *"Scoped by TAB, not by initiator — a navigation inside the frame is initiated by the framed page."*

---

## Spotting a rule that should not be there

- **It restates the code.** `// increment the counter` above `n++`.
- **It is a second instance of R1–R9 about the same mechanism.** Keep one, delete the other.
- **It has a date, a round number, or a measurement in it** and no imperative. That is a story.
- **It explains a decision nobody can act on.** "We considered X and chose Y" with no rule attached.
- **It is longer than its budget** and the excess is narrative.

Keep it, however tempting, when: it names a **non-obvious consequence**, it records a **refuted
hypothesis** someone would otherwise retry, or it is the only place a **cross-file invariant** is
written down.
