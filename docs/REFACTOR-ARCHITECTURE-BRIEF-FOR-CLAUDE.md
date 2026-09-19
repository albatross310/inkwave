# Inkwave refactor architecture brief for Claude

## Purpose

Perform a detailed, read-only architecture and refactoring study of the current Inkwave repository.
The result will be handed to Astra for staged implementation. Do not refactor production code during
this phase: the deliverable is the architecture, work-package specification, evidence, and validation
plan that make the later implementation safe.

The earlier surveys are inputs, not authority:

- `REFACTOR-PERFORMANCE-REPORT.md` describes an older June tree and contains recommendations that
  have already landed.
- `docs/REFACTOR-QUEUE.md` is newer and identifies several unresolved structural seams.
- `CLAUDE.md` contains the live architecture and invariants, but also retains dated findings that may
  now be stale. Verify claims against the branch.

Do not merely expand or reformat those documents. Re-derive the architecture from current code.

## Operating constraints

1. Start with `git status`, the current branch, recent history, and the complete uncommitted diff
   inventory. The worktree may contain Peter's active work. Do not modify, format, restore, stage,
   commit, delete, or move any existing file.
2. Read `AGENTS.md`, `CLAUDE.md`, `docs/RULES.md`, `docs/REFACTOR-QUEUE.md`, and the relevant build
   specs before drawing conclusions.
3. Read archive entries selectively when a live rule points to them. Do not treat a historical
   diagnosis as proof that the same mechanism remains live.
4. Peter's prose and real documents must never enter the repository, fixtures, logs, screenshots,
   prompts, or reports.
5. Use read-only inspection and non-mutating analysis. Do not run formatting or generation commands.
   Do not rebuild while another process is actively changing the same worktree unless Peter confirms
   the tree is stable.
6. Report progress to Peter at approximately 20%, 40%, 60%, 80%, and completion.
7. Label every conclusion as one of:
   - **MEASURED** — produced by a repeatable measurement;
   - **TRACED** — established directly from the current import/call/data flow;
   - **INFERRED** — plausible but not yet measured;
   - **STATED-NOT-PROVED** — documented or proposed, but not established.

## Non-negotiable invariants

The architecture must preserve these unless Peter explicitly authorises a product change:

- A failed, corrupt, timed-out, or stale read is never equivalent to an absent or known-empty value.
- Snapshot history is grow-only except for an explicit, confirmation-gated writer deletion.
- Verification failure never authorises automatic provenance deletion.
- The document mutation path and explicit snapshot path each have one owner.
- Canonical page-break positions remain stable across zoom, device, editor, snapshot, and print.
- SCAS never retroactively re-flags committed text; verdicts freeze at commit.
- `TiptapEditor` mounts once and `shouldRerenderOnTransaction: false` remains effective.
- No O(document) work may be moved onto a keystroke merely to make code look simpler.
- The document shell's global CSS remains an explicit React Router stylesheet link.
- Gmail remains send-only and browser-to-Google; tokens and message bytes do not cross an Inkwave
  server. A send with no authoritative response remains `unknown`, not `failed`.
- Supabase stores minimal account/entitlement data only. The service-role key stays server-side and
  RLS remains enabled on exposed tables.
- User-gesture APIs must remain synchronous with the gesture. A lazy import or unrelated `await`
  must not be inserted before OAuth popups, file pickers, downloads, clipboard writes, or similar
  activation-bound calls.
- Path-based guards must be updated and mutation-proved whenever their target code moves.

## Questions the architecture must answer

### 1. Current system map

Trace the actual runtime architecture, including:

- route and hydration entry points;
- first-load shell, editor import, editor creation, reveal, pagination-ready, and water handoffs;
- the ProseMirror transaction path from input through SCAS, productivity capture, document rebuild,
  autosave, snapshots, signing, OTS, and cloud mirrors;
- document identity, tab identity, single-open ownership, write freezing, open conflict resolution,
  local canonical state, and cloud write-back;
- citation capture, source reader, browser extension, PDF storage/viewing, and citation navigation;
- snapshot creation, archive caching, compression, patching, export, verification, and `/snapshot`;
- productivity, email, music, auth, billing, Supabase, and serverless boundaries;
- feature flags, probe flags, debug globals, local/session storage preferences, and build-time gates;
- production, route, feature, worker, and probe chunk boundaries.

Provide two diagrams in text or Mermaid:

1. a module/dependency diagram at subsystem level;
2. a sequence diagram for edit → autosave → snapshot → OTS → mirror.

The diagrams must distinguish synchronous keystroke work, deferred main-thread work, workers,
network calls, and persistent writes.

### 2. Coupling and ownership audit

For every production file over roughly 500 lines, determine:

- whether the size is generated data, cohesive complexity, or mixed responsibility;
- its state/effect/ref count where applicable;
- its direct and transitive import role;
- which responsibilities can be named independently;
- hidden ordering or shared-ref dependencies that make extraction risky;
- whether splitting would reduce rerender scope, bundle reachability, test collection, or cognitive
  load—or would merely add files and imports.

At minimum, study:

- `src/editor/TiptapEditor.tsx`
- `src/routes/SnapshotView.tsx`
- `src/components/PdfViewer.tsx`
- `src/components/SourceBrowser.tsx`
- `src/editor/extensions/PaginationExtension.ts`
- `src/editor/Scroll.tsx`
- `src/editor/textRenderProbe.ts`
- `src/editor/scrubRaster.ts`
- `src/components/CitationPanel.tsx`
- `src/components/ClockMenu.tsx`
- `src/editor/suggestions/ThesaurusPopover/ThesaurusPopover.tsx`
- `src/styles/index.css`

Do not recommend splitting `waveSceneData.ts` merely because it is long; it is generated data. Apply
the same test to every other large file.

### 3. Performance architecture

Establish current baselines and identify costs by phase:

- HTML/CSS/JS bytes before the shell paints;
- bytes and parse/evaluation work before the editor becomes interactive;
- static dependencies reachable from `TiptapEditor`;
- optional panels or heavy packages present before use;
- editor creation, library hydration, document open, first canonical pagination, and reveal timing;
- keystroke, Enter, selection movement, SCAS tick, autosave-build, pagination, zoom, and scroll work;
- snapshot archive read/decompress/parse/compress/write costs at realistic document and history sizes;
- `/snapshot` memory, parse, warm-window and scrub costs;
- PDF/source-reader first-open and steady-state costs.

Use existing probes where they still answer the question. Before trusting one, establish that its
known-positive and known-negative can fail in the current branch. Prefer ABBA or alternating runs
for timing comparisons that share a browser/process.

Investigate these hypotheses specifically, without assuming they are correct:

1. The complete 325 KB word-frequency array is still parsed even though runtime SCAS needs only the
   frozen 4,500-word pool.
2. `SourceBrowser`, PDF, citation, ledger, verifier, receipt, email, and cloud UI code can be moved
   behind honest lazy boundaries.
3. `ScasController.lookup()` rebuilds identical sets unnecessarily.
4. Viewport-windowed SCAS decoration rendering is implemented but lacks the final real-browser proof
   needed to graduate.
5. Paragraph-index and paragraph-count walks remain on the transaction path.
6. Synonym prefetch repeatedly scans an unchanged set of rendered words.
7. OTS backlog drain/upgrade performs one full archive rewrite per snapshot.
8. Cloud mirrors independently repeat archive/bundle work that could be shared safely.
9. Verification re-canonicalises and re-decodes the same receipt data.

For each performance recommendation, state the expected causal mechanism, measurement needed, target
metric, rollback, and what result would falsify the recommendation.

### 4. Duplication and drift audit

Find duplicated rules, not just similar-looking code. Examine:

- the three page-break implementations;
- `ClockMenu.daySummary` versus productivity aggregation;
- OneDrive/Google Drive filename, sync, listing, opening, picker, and cache contracts;
- production API handlers versus Vite development handlers;
- JCS, byte codecs, hash helpers, word counting and seeded randomness;
- inline/block MathLive node-view lifecycle;
- reader/PDF annotation palettes, gestures and dock behaviour;
- modal, backdrop, Escape, focus, drag and touch-guard implementations;
- IndexedDB request/transaction wrappers;
- OPFS binary stores for PDFs, media and MusicXML;
- localStorage preference readers/writers;
- `inkwave:*` event names and payload assumptions;
- duplicated static inline styles and theme tokens.

For each proposed abstraction, identify the shared invariant and the legitimate differences. Reject
an abstraction if callers only look alike but have different failure semantics.

### 5. Dead code, diagnostics, and tooling

- Run or construct a conservative dead-export analysis and manually classify results as live,
  route/framework-required, test-only seam, dynamic/string-referenced, or removable.
- Check package dependencies against current imports.
- Classify every `scripts/*.mjs` file as durable gate, reusable harness, generator/admin tool,
  one-shot diagnostic, or obsolete.
- Propose how durable browser proofs should converge on shared harness code or Playwright projects.
- Identify probe-only imports, globals and destructive known-negative switches that production builds
  should not ship.
- Assess missing lint, API typecheck, extension typecheck, CI, bundle budgets, dependency-cycle checks,
  and targeted coverage—not as generic best practice, but against observed failure modes here.

### 6. Target architecture

Describe a target architecture with named owners. At minimum decide whether the target should contain:

- a small editor composition root plus focused hooks/controllers;
- a document I/O coordinator separate from provider adapters;
- a snapshot repository with batch mutation support;
- common cloud browser/picker shells;
- typed application events and preferences;
- a production API adapter shared by local development;
- separate production and probe builds;
- lazy feature boundaries and explicit chunk budgets;
- pure engines beneath React surfaces for PDF, source-reader, snapshot scrub and toolbar interactions.

Show the proposed directory/module tree. For every new boundary, state:

- its single responsibility;
- public API;
- state it owns;
- side effects it owns;
- dependencies it may import;
- dependencies it must not import;
- tests that prove the boundary is real.

### 7. Staged implementation plan

Produce independently revertible work packages, ordered by value per risk. Each package must include:

- objective and non-goals;
- exact files likely to change;
- prerequisites;
- current behaviour to characterize first;
- proposed API/module boundary;
- migration steps;
- likely LOC and bundle/timing effect;
- risks and rollback;
- targeted unit and browser validation;
- completion criteria;
- whether Astra may implement it autonomously or must ask Peter for a decision.

Separate the plan into:

1. guardrails and deletion;
2. startup payload and lazy boundaries;
3. small pure performance/deduplication work;
4. SCAS windowing proof/graduation;
5. storage and cloud orchestration;
6. `TiptapEditor` decomposition;
7. large secondary component decomposition;
8. canonical page-break and snapshot-format projects.

Do not group unrelated refactors into one work package. If two changes cannot be reverted separately,
explain why.

## Decisions Claude must not make silently

Call these out for Peter rather than choosing by architectural taste:

- any snapshot/archive format migration;
- any change to canonical page-break behaviour;
- any change to hashed or signed byte shapes;
- any change to SCAS semantics or pool membership/order;
- any removal of writer-visible recovery tooling;
- any change to email/provider permissions;
- any change to what content leaves the browser;
- any replacement of the current water/reveal behaviour;
- any abstraction that unifies two stores with different failure meanings;
- any deletion of a browser proof that is the only guard for a live invariant.

## Required deliverables

Write the final architecture to:

`docs/INKWAVE-REFACTOR-ARCHITECTURE.md`

It must contain:

1. executive recommendation;
2. measured current-state inventory;
3. current architecture diagrams;
4. responsibility and dependency map;
5. performance findings with evidence;
6. duplication/dead-code/tooling findings;
7. proposed target architecture and module tree;
8. ranked opportunity register with impact, effort, risk and confidence;
9. staged implementation plan;
10. invariant-to-test matrix;
11. rollback and data-migration strategy;
12. unresolved decisions for Peter;
13. an Astra handoff section containing self-contained work-package prompts.

Also write a short machine-readable work-package index to:

`docs/INKWAVE-REFACTOR-WORK-PACKAGES.json`

Each entry should include:

```json
{
  "id": "R01",
  "title": "",
  "stage": 0,
  "priority": 0,
  "risk": "low|moderate|high|critical",
  "depends_on": [],
  "files": [],
  "objective": "",
  "acceptance": [],
  "tests": [],
  "browser_proofs": [],
  "requires_peter_decision": false
}
```

The JSON must agree with the prose plan and be detailed enough for Astra to select one package at a
time without reinterpreting the whole survey.

## Quality bar for the handoff

The document is ready for Astra only when:

- every high-priority claim points to current code or a repeatable measurement;
- no recommendation from an older report is carried forward without checking whether it already
  landed;
- every risky stage has a rollback and data-recovery story;
- every new abstraction has a named invariant rather than “reduces duplication” alone;
- each package can be implemented and reviewed independently;
- performance work specifies a before/after test that can disprove the hoped-for win;
- line-count reduction is treated as a consequence, not the sole success criterion;
- the current dirty worktree is preserved exactly.

