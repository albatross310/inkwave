# Inkwave — Agent Readability: Build Specification

**Version:** 0.1 (working draft; §6 added 2026-09-06 after Peter's out-of-band point, which
demoted the lite export from "the fix" to "one of two")
**Date:** September 2026
**Status:** Design specification only. No `/ai` route, hosted reader, published checksum, or
sources-omitted export is implemented by this document. **The export format is not changed by this
spec** (§2) — nothing under `src/provenance/` is touched.
**Domain note:** the canonical domain is **iwzero.me**, not `iwzero.com`. `inkwave.studio` currently
302s to it. Every URL in this spec is `https://iwzero.me/...`.

---

## 0. Product claim

A `.studio` file should be legible to a machine reader that has never heard of Inkwave, without that
reader guessing, and without it downloading tens of megabytes of Bitcoin proofs to reach a page of
prose.

The claim this feature may make:

> The format is documented at one stable, static, no-JavaScript address, findable by search and
> linked from the verification page every export already points to, with a reference reader
> published beside it.

It must never claim:

- that an agent is *obliged* to read the page, or that Inkwave can compel any reader's behaviour;
- that anything in this feature is part of the provenance record, or is signed, hashed, or anchored;
- that fetching the page proves anything about the document;
- that a reader which ignores the line has failed to read the file — the hybrid text header must
  keep working entirely on its own.

**Nothing here is a protocol.** Every route in this spec is an affordance a user or an agent may
ignore, and the format itself is untouched. If any claim below becomes false when someone simply
opens a `.studio` in a text editor, that claim is wrong.

---

## 1. Why (measured, not assumed)

Three real exports were handed to an assistant with no knowledge of Inkwave, the repo, or the format.
Recorded in `CLAUDE.md` § "What a `.studio` file looks like to an agent that has never heard of
Inkwave (2026-09-06)". In short:

| Export | File size | Readable text |
|---|---|---|
| A 91-word brainstorm | 14,225 B | 554 chars |
| A proposal, 477 words | 286,467 B | 3,109 chars |
| A proposal, 424 words | 2,133,530 B | 3,006 chars |

1. **The hybrid header worked.** `composeTraceFile()` puts wrapped prose first, then
   `TRACE_DATA_MARKER`, then two lines of English saying the rest need not be read. The cold reader
   understood the file immediately, with no parser and no format knowledge. This is the thing to
   protect.
2. **Size defeated the tooling.** The reader's file tool refused anything over 256 KB, so two of
   three files could not be opened by the normal path at all. `MAX_TRACE_BYTES` (120 MB) is the DoS
   bound, not the agent bound.
3. **The size is the sources, not the proofs — measured, and it inverts the obvious fix.** Byte
   breakdown of the 2,133,031-byte export:

   | key | bytes | share |
   |---|---:|---:|
   | `pdfs` (4 embedded source papers) | 2,040,622 | 95.7% |
   | `snapshots` (6, incl. their `contentJson`) | 68,418 | 3.2% |
   | `document` | 15,054 | 0.7% |
   | `bibliography` (6 CSL entries) | 5,217 | 0.2% |
   | `text` | 3,020 | 0.1% |
   | everything else | ~2,700 | 0.1% |

   Within `snapshots`: `contentJson` 37,433, `ots.proofBase64` **5,796**, `receipts[].lockedSet`
   2,256. **Stripping every proof and locked set from this file saves 0.4%.** The file is large
   because it is carrying Ridge, Evnine, Gert and Ruiz Fernández — which is the feature, not the
   problem. Any design that makes a `.studio` smaller by discarding what the writer attached is
   solving the wrong thing.
   *Corollary:* blob interleaving still makes truncation tear a snapshot rather than degrade
   gracefully, but it is a tidiness issue, not a size one.
4. **`document.contentJson` is TipTap/ProseMirror and the file never says so.** `bundle.text` makes
   the walk unnecessary, and nothing tells a reader to prefer it.

§2–§5 address 4 cheaply. Problems 2 and 3 have one answer between them and it is §6: the reader
never ingests the file, it **unpacks** it — text and metadata to stdout, PDFs and images to disk
where a multimodal agent can open the ones it needs. Making the file smaller (§7) is a distant
second and, on this evidence, mostly beside the point.

---

## 2. No pointer line in the file — decided 2026-09-06

Earlier drafts of this spec added a `Format: inkwave-studio v1 · docs …` line to
`composeTraceFile()`. **That is dropped. The export format does not change at all.**

Peter: "I don't think the doc should give any instructions how to read it actually. Users can just
learn how to tell AIs to read the doc online, and instructions can exist in the URL's Google search
header so AIs can figure it out quickly if the user just asks them to 'try and read it'."

Four reasons this is right, the first being the one that makes the rest academic:

1. **The file already identifies itself.** Every export carries
   `══════ INKWAVE RECORD · verify at iwzero.me/verify ══════`, in the clear, near the top. An agent
   holding that string has the product name *and* the domain. It can search, or fetch `iwzero.me`
   directly. A second URL adds no discoverability that the marker does not already provide — the
   pointer was answering a question the file had answered three lines earlier.
2. **It was the only injection-shaped surface in the design.** §8 existed because of it. Remove the
   line and a document instructing its reader stops being a thing Inkwave does at all, rather than
   something Inkwave does carefully.
3. **It had become the least-used path anyway.** With §6.9 (standing memory), §6.4 (the user's turn)
   and §6.7 (an attached file), the in-file line was the last and weakest route, and §0 already says
   that if the pointer is ever load-bearing the design is wrong. It was not load-bearing. So delete
   it.
4. **A header line is in every file forever.** For a format whose whole claim is a faithful record of
   what someone wrote, an unremovable line addressed to machines is a cost paid on every document
   ever exported.

**Consequences.**

- `composeTraceFile()`, `TRACE_DATA_MARKER`, `parseTraceFile()` and every hash are untouched. The
  back-compatibility analysis the earlier draft required is moot; nothing changes, so nothing can
  break. This spec now requires **no change to `src/provenance/` at all.**
- Discoverability moves entirely to §3: the existing marker already sends a reader to
  `/verify`, so `/verify` must link to `/ai`, and `/ai` must be findable by the search an agent
  would actually run.
- The `text`-key fact that the pointer line was carrying is format documentation and belongs on
  `/ai`. An agent reading the top of the file does not need it — it already has the prose.

## 3. The page: `https://iwzero.me/ai`

### 3.1 It must be static HTML with no JavaScript requirement

This is the single most likely way to ship this feature broken. `vercel.json` rewrites
`/((?!api/).*)` to `/__spa-fallback.html`, and `react-router.config.ts` sets `ssr: false` — so any
route **not** listed in `prerender()` returns an empty SPA shell to a fetcher that does not execute
JavaScript, which is most of them. Requirements:

- `/ai` is added to the `prerender()` array in `react-router.config.ts` alongside `/`, `/about`,
  `/verify`, `/privacy`;
- the prerendered HTML contains the full documentation text in the initial response body;
- **acceptance test:** `curl -s https://iwzero.me/ai | grep -c 'inkwave-studio v1'` returns ≥ 1 —
  run against the deployed site, not the dev server, because the rewrite is Vercel-side.

### 3.2 A plain-text mirror

Also publish `https://iwzero.me/ai.txt` as a static file in `public/`, byte-identical in content to
the page's prose. Many fetchers handle `text/plain` more reliably than HTML, and it cannot be broken
by a routing change. Add `https://iwzero.me/llms.txt` as a copy or a redirect to it, following the
emerging convention; keep `/ai.txt` canonical.

### 3.3 Content of the page

Format facts only, in this order:

1. **What a `.studio` file is** — one paragraph: hybrid text-then-JSON, single self-contained file.
2. **The fast path** — read the top of the file down to the marker line; that is the document. Most
   readers need nothing else.
3. **The record** — one JSON object on one line after the marker. Key order is insertion order:
   `v`, `summary`, `text`, `exportedAt`, `document`, `snapshots`, `receipts`, `signingKey`, …
   `summary` and `text` are near the front, so the first few KB after the marker contain the whole
   readable document for short files.
4. **Key reference** — `text` (canonical plain-text copy, prefer this), `summary.*`,
   `document.contentJson` (TipTap/ProseMirror; named explicitly so nobody has to infer it),
   `document.title`, `snapshots[]` (`createdAt`, `trigger`, `wordCount`, `contentJson`),
   `bibliography[]` (CSL-JSON), `viewSettings`.
5. **What to skip and why it is large** — `ots.proofBase64` (OpenTimestamps), `receipts[].lockedSet`,
   `document.library[].pdfs` / top-level `pdfs` (base64 source PDFs). Name the sizes.
6. **Gzip** — files may begin `1f 8b`; gunzip first.
7. **The reference reader** — §4.
8. **Verification** — verification is a browser operation at `/verify`; the page must state plainly
   that reading the JSON does not verify anything, so no agent reports a file as "verified" because
   it parsed.
9. **Format version history** — `v: 1` and what would change it.

### 3.4 Discoverability — the file points at `/verify`, so `/verify` points at `/ai`

With §2 gone, this is the only route from a file to the documentation, and it costs nothing:

- **`/verify` carries a visible link to `/ai`,** worded for a machine reader as much as a person —
  something like "Reading a `.studio` file programmatically? The format is documented at /ai." An
  agent that followed the marker line already in every export lands on `/verify` and is one hop away.
- **`/ai` is written to be found by the search an agent runs.** Title and meta description carry the
  literal strings someone would search — `.studio file format`, `Inkwave`, `read a .studio file`,
  `inkwave-studio v1` — because the search result snippet is, as Peter put it, where an agent asked
  to "try and read it" will look first. Put the one-sentence answer *in the meta description*, not
  only in the body: for many agents the snippet is all they see before deciding whether to fetch.
- **`/ai` and `/ai.txt` are in `sitemap.xml`;** `public/robots.txt` already allows both.
- **Acceptance test:** searching `.studio file format` and `inkwave studio file` on a major engine
  returns `/ai` in the first page of results, checked after launch — and re-checked, because this is
  the one requirement in the spec that can silently stop being true.

### 3.5 Stability

The URL is a contract printed into every file ever exported. It must not move, must not redirect,
must not become an SPA route, and must not require cookies or consent. If the page is ever retired,
it must remain as a static document pointing to its successor. Add `/ai` and `/ai.txt` to
`sitemap.xml`; `public/robots.txt` already allows both.

---

## 4. The reference reader

A ~130-line Python 3 script (`studio_read.py`, stdlib only) exists and works against all three
exports in §1: it finds the record, prints title, word count, timestamps, signing key, per-snapshot
OTS status, bibliography and text, strips the blobs, handles gzip, and offers `--history`, `--diff`,
`--json`, `--text`. It reduced the 2,133,530-byte export to ~3 KB of output.

Requirements:

- committed to `scripts/studio_read.py` with a test against a fixture export;
- downloadable from `https://iwzero.me/studio_read.py` (a static file in `public/`, served
  `text/plain`) and shown in full on `/ai`, so an agent that cannot execute code can still read the
  logic;
- **stdlib only, no network, read-only.** It must never write, upload, or phone home. An agent
  running an unfamiliar script on a user's file is only acceptable if that is provably all it does;
- versioned in a header comment against the format version it targets.

---

## 5. Not just Python

`/ai` must also carry a ~15-line JavaScript equivalent (find marker → slice from first `{` →
`JSON.parse` → read `.text`) inline in the page. The point of the page is that a reader in any
language can do the job in a few lines; a Python script alone implies a dependency that does not
exist.

---

## 6. The out-of-band path — the primary flow

The abandoned pointer line (§2) assumed the agent meets the file first. The better flow is the other
way round: **the user hands the agent the URL before handing it the file.** Peter, 2026-09-06 — "what if
the user provides the AI with the URL first, then the AI can know not to read it through but can just
get the py script from online and run it on the doc."

That inverts the whole problem, in two ways.

**It fixes the trust model.** §8 exists because a line inside a document, addressed to a reader, is
injection-shaped. When the user supplies the URL in their own turn, the *user* is the instruction
source, which is the only source an agent should be taking instructions from. Nothing in the document
is asking for anything. The in-file line stays, but it drops from "how this is meant to work" to "a
fallback for a file that arrives with no covering note" — which is the right weight for it.

**It fixes size properly, not by shrinking anything.** The script streams the file on disk and prints
a few KB. The agent's context never holds the record at all. A 2,133,530-byte export and a 14 KB one
cost the same to read. That is strictly better than a lite export, which buys a smaller file by
throwing the proofs away.

### 6.1 What the flow needs to be true

It is not universal, and `/ai` must be honest about the four conditions:

1. **The agent can execute code** — a coding agent, a terminal, a notebook, a sandbox. A pure chat
   interface with no execution cannot do this.
2. **The file is on a filesystem the agent can reach.** In a chat UI the file is usually ingested at
   upload, before any script could run — the context cost is already paid by the time the agent has
   a shell. This path is for agents that see a *path*, not an attachment.
3. **Either network egress to iwzero.me, or the script in hand.** Many agent sandboxes have no
   egress or a domain allowlist, and `iwzero.me` will not be on it. This is the most common way the
   flow will fail in practice; §6.3 (paste it) and §6.7 (attach it as a file) are the two answers,
   and §6.7 is the one people will actually use.
4. **The user is willing to have a downloaded script run against their document.** See §6.2. This is
   a real ask and the design must earn it rather than assume it.

### 6.2 Running a fetched script on your own document is a trust action — treat it as one

A provenance product must not be the reason someone learns to pipe a URL into an interpreter.

- **Never publish a `curl … | python` one-liner.** Not on `/ai`, not in the README, not in a
  tweet. Download, then read, then run — as three visible steps.
- **Publish a SHA-256 of `studio_read.py` on `/ai` and in `scripts/`,** and keep it correct across
  updates. An agent that fetched the script can state the digest it got; a user can compare.
- **The §4 constraints are what make this askable at all** — stdlib only, no network, read-only,
  no writes, no uploads. These stop being nice properties and become the load-bearing promise of
  §6. A test must assert the script imports nothing outside the stdlib and opens no socket.
- **Pin by version.** `/ai` serves the current script at a stable URL and each released version at
  `…/studio_read-<version>.py`, so a user can pin.

### 6.3 The script must also be pasteable

Because condition 3 fails often, `/ai` shows `studio_read.py` **in full, inline, in the page**, and
`/ai.txt` contains it verbatim. A user with no egress can paste it; an agent that fetched the page
already has it and needs no second request. Same reason §5 requires the fifteen-line JavaScript
version: an agent in a JS-only sandbox should not be blocked on Python.

### 6.4 What the user actually says

`/ai` carries a copy-paste block for the user — not for the file, and not addressed to an AI in the
second person by Inkwave. Something of this shape, which the user sends in their own words:

```text
This is a .studio file (Inkwave). Don't read it into context — it can be megabytes of
timestamp proofs. The reader and the format are at https://iwzero.me/ai — the script is
stdlib-only, read-only, and prints the text, metadata, bibliography and snapshot history.
```

The distinction matters and is not pedantic: the user is instructing their own agent, which is
legitimate and needs no defences. Inkwave writing that same sentence *into the document* would be the
thing §8 forbids.

### 6.5 Read the docs *before* the file — ordering, and its limits

Peter, 2026-09-06: "what if you tell the code the URL first, then give it the file after it's read the
site." This is the strongest form of §6 and it earns its own rule, because the ordering buys something
the URL alone does not.

**What ordering buys.**

1. *The format is established from a trusted source before untrusted content arrives.* The agent
   learns what a `.studio` file is from a page the **user** pointed it at. By the time the document
   appears, the file cannot be the thing that teaches the agent how to treat the file. Every
   injection concern in §8 is about a document that arrives first and explains itself; reverse the
   order and the document has nothing left to explain.
2. *The decision not to ingest is made before the ingest.* An agent that already knows a `.studio`
   file may be megabytes of base64 will reach for the path and the reader, rather than opening it,
   discovering the problem, and having already paid for it.
3. *Nothing in the file competes with what the user supplied.* Since §2 removed the in-file pointer,
   there is no second URL for a reader to weigh against the user's. The only address a `.studio` file
   contains is the long-standing `iwzero.me/verify` in the marker, which is Inkwave's own and goes to
   the verification page, not to instructions.

**What ordering does not buy, and `/ai` must say so.**

- **It is not durable *within a conversation*.** Context gets compacted, sessions restart, a second
  file arrives a week later. Ordering is a property of one conversation, not of the file or the
  format — which is precisely what §6.9 fixes, by moving the pointer into the user's standing
  configuration so the ordering holds across every future session. Even then: any guarantee that
  depends on "the agent read the docs first" is not a guarantee.
- **It does not survive attachment-based UIs.** Where a file is ingested at upload, the cost is
  paid before the first token of any turn (§6.1, condition 2). Ordering cannot help there; only
  §7 can.
- **It is advisory.** Nothing compels a reader to have visited the page, or to behave differently
  having done so.

**Therefore the same discipline as §0 applies:** ordering is an affordance, not a control. The
security properties must live in things that are true regardless of reading order — the script is
read-only and offline (§6.2), and the page is static and instruction-free (§8.1). The third leg —
a carefully descriptive pointer line — is gone, because §2 removed the line entirely. If a claim in this spec would become false when someone opens the file first,
that claim is wrong.

### 6.6 Version negotiation

The script reads `v` from the record and, on an unknown version, prints what it can and says plainly
which version it targets and which it found. It must never silently half-parse a future format — a
reader that quietly drops fields is worse than one that refuses, because nothing downstream can tell.

### 6.7 Offline fallback: an instructions file the user attaches

Peter, 2026-09-06 — where the agent has no network at all, the user downloads the instructions and
attaches them like any other file. This is the answer to §6.1 condition 3 when pasting is impractical
(most people will not paste 200 lines by hand) and it is the only path that works in a fully
air-gapped sandbox.

**The artifact.** `/ai` offers a download button — "Save these instructions for an AI with no
internet" — serving `inkwave-format-v1.txt`: one plain-text file, byte-identical to `/ai.txt`,
containing the format documentation *and* the full reader script. Plain text, not PDF or HTML: it
must survive being attached anywhere and read by anything. Target a few KB; if it grows past what a
person will happily attach, the documentation has gone wrong.

**Header, kept short.** First lines: format version (`inkwave-studio v1`), document date, canonical
URL, and the SHA-256 of the reader script it contains. Staleness is a small worry and this spec
previously over-weighted it — the format is at `v: 1` and a copy still describes it correctly however
old it is, and §6.6 makes the reader announce a version it does not recognise. The header earns its
place for the digest and the URL, not for the date.

**Forgery is not this feature's problem — corrected 2026-09-06.** An earlier draft of this section
built out a threat model around someone sending a victim a `.studio` plus a doctored
`inkwave-format-*.txt`. Peter: "I don't see why it matters… as long as it's not running any
executable code — it's just parsing text. The issue of forgery isn't really the problem, and AI
reading the doc is not the way forgery is prevented." That is right on both counts, and the draft was
wrong:

1. **Forgery is answered at `/verify`,** against the published Ed25519 key and the Bitcoin anchors,
   in a browser, by a person. That is the entire anti-forgery story and it does not involve a reader
   at all. Nothing an agent does while reading a document detects tampering, and this spec must never
   imply otherwise — see §0, which already forbids the claim, and which the deleted passage was
   quietly walking back.
2. **A documentation file confers no new capability.** It describes a format. A doctored copy can
   misdescribe one — the reader then parses badly, which is a bug, not a compromise. And an attacker
   able to send you a forged instructions file could simply send you the payload directly; routing it
   through Inkwave-branded documentation buys them nothing they did not already have. The attack
   surface is not new, so it is not this spec's to invent.

**The one narrow thing that does hold.** §6.3 puts the reader *script* inside `/ai.txt`, and therefore
inside the downloadable file — so this artifact is not purely "parsing text": it carries code a user
is invited to run. That is the only part with any leverage, and the §6.2 answer already covers it:
stdlib-only, read-only, no network, and a published SHA-256. Keep the digest in the header — less as
a security control than as version hygiene, so anyone can tell whether the copy in their hands is the
one Inkwave published. A build that shipped documentation *without* the script would not need even
that.

**Still never ship the instructions file inside a `.studio` export, and never auto-attach it** — but
for the reasons that survive, not for forgery. Bundling documentation into the artifact re-creates
exactly the shape §8 exists to avoid: an untrusted file that explains how it should be read. And it
would put a copy of the docs, frozen at export time, inside every file ever exported, to drift out of
step with `/ai`. The user downloads and attaches it deliberately, or it does not travel.

**Acceptance tests** (added to §9): `inkwave-format-v1.txt` is byte-identical to `/ai.txt`; its
header carries version, date, canonical URL and the script digest; the digest matches the served
`studio_read.py`; and no `.studio` export path emits or references the instructions file.


### 6.8 What the reader is *for*: feedback, not extraction

Peter, 2026-09-06: "I don't want AIs editing docs. It's more to send them for feedback, while
allowing them to access all relevant info such as rough build timeline, references, pictures and the
like."

That is the use case, and it changes what "read this file" should mean. A reader optimised to yield
the smallest possible text blob is optimised for the wrong job. Someone giving feedback on a draft
wants more context than the prose, not less:

- **the prose** — `text`;
- **the sources** — `bibliography` (CSL-JSON) *and* the actual papers in `pdfs`, which is the whole
  point of embedding them;
- **the build timeline** — `snapshots[]` with timestamps, triggers and word counts, and the diffs
  between them. This is the record of how the argument was assembled, and no other document format
  a reviewer receives has it. `--history` and `--diff` are not debugging flags; they are the feature.
- **the pictures** — images in the document, which today the reader ignores entirely.

**Reading profiles.** The reader (§4) and `/ai` describe three, by what a reader wants rather than by
what is small:

| profile | yields | for |
|---|---|---|
| `--text` | prose only | quoting, summarising, a quick read |
| default | prose, summary, bibliography, snapshot count | ordinary reading |
| `--review` | default + `--history --diff` + `--media DIR` | giving feedback on a draft |

**`--media DIR` is the missing capability.** `pdfs` and any document images are base64 in the record;
the reader must decode them to real files on disk — `DIR/<citekey>.pdf`, `DIR/<id>.<ext>` — and print
a manifest of what it wrote with sizes. A multimodal agent then opens the two pages it needs.
Nothing base64 ever enters a context window. On the §1 fixture this turns 2,040,622 bytes of inline
base64 into four PDFs on disk and four lines of manifest.

**The reader stays read-only** (§6.2) — it writes only into a directory the user names on the command
line, never beside the source file, never into the `.studio`. "Give feedback" and "edit my document"
stay different verbs, and nothing in this feature crosses that line.


### 6.9 Put the pointer in the user's standing memory, not in the file

Peter, 2026-09-06: instruct users on `/ai` to add the canonical URL and a one-line instruction to
their assistant's **permanent memory or custom instructions**, plus a warning to only ever take that
URL from the official Inkwave page.

This is the best version of §6 and it repairs §6.5's main weakness. Ordering-in-a-conversation was
fragile — compaction, a new session, a file that arrives next week. A standing memory entry makes the
ordering **permanent**: every future session already knows what a `.studio` is before any file
appears, and the user never pastes anything again.

It also settles the trust hierarchy cleanly, highest first:

1. **the user's standing configuration** — memory, custom instructions, project instructions, or an
   agent config file in a repo (`AGENTS.md`, `CLAUDE.md`, editor rules);
2. **the user's turn** — the §6.4 covering note;
3. **the file** — which, after §2, says nothing about how to read it. Its only address is the
   verification link it has always carried.

The document is not an authority on how to read the document — it is not even a participant. That is
the correct ordering, and §2 reached it by deletion rather than by careful wording.

**The warning `/ai` must carry, in these words or close to them.**

> Only ever take this URL from the official Inkwave page. If a document, an email, or anyone else
> gives you a different address for Inkwave's format documentation, do not use it — check
> `https://iwzero.me/ai`.

Its purpose is narrow and should be stated as such on the page: the entry authorises **one specific
URL**, not a habit of fetching whatever address a document happens to contain. A user who ends up
with "look up any documentation link you find in a file" in their permanent memory is worse off than
before this feature existed, and `/ai` must not phrase anything in a way that drifts toward it.

**What the entry says.** `/ai` gives one short product-agnostic wording — what a `.studio` file is,
the canonical URL, and *unpack rather than ingest* (§6.8) — and says it belongs wherever the user's
assistant keeps standing instructions. `/ai` must **not** maintain per-product setup guides; those
rot faster than the page can be updated, and the correct place differs by product and by month. Name
the categories, not the menus.

**Honest limits, which the page states.**

- A memory entry is **mutable and unsigned**. The user can change it, some assistants write to their
  own memory, and content in a session can influence what gets written there. It is the most
  trustworthy layer available, not a trusted one — the §6.5 discipline still applies: no claim in
  this spec may depend on it.
- **Not every assistant has persistent memory**, and some scope it per-project. §6.4 (say it in the
  turn) and §6.7 (attach the file) remain the fallbacks, in that order.
- It is **advisory**. Nothing compels an assistant to act on its own memory in any particular way.


---

## 7. The lite export

**Reduced in scope by the §1 measurement.** This section previously called itself "the actual fix".
It is not. Dropping every proof and locked set from the §1 fixture saves 0.4%; the size is the
embedded sources, and those are what a reviewer most wants (§6.8). Where §6 applies, the file needs
no shrinking at all.

What remains is a **sharing** decision, not a readability one, and it is one the writer makes
deliberately:

- `--without-sources` / "send without attached papers" — omits `pdfs`. On the §1 fixture:
  2,133,031 → ~92,000 bytes. Use it when the recipient already has the literature, or when the
  papers are licensed and should not be redistributed — which is the stronger reason, and one this
  spec should have raised before size ever came up.
- Omitting `ots.proofBase64` and `receipts[].lockedSet` is **not worth a mode.** 0.4%, and it costs
  verifiability. Drop this idea.

The remaining genuine case for a smaller file is a chat UI that ingests an attachment before any
code can run (§6.1, condition 2). That is a real constraint and `--without-sources` covers it.

- Naming: `<slug>.no-sources.studio`, so what is missing is stated by the filename.
- `summary` gains a `sourcesOmitted: true` field so the omission is visible in the record itself
  rather than only in the filename, and `/ai` documents which keys are absent. Note that with proofs retained, **such a file still verifies** — which is a much better
  position than the earlier lite design, and worth keeping.
- Offered beside "download", described by what it omits, never substituted silently.
- Sizing test against the §1 fixture: 2,133,031 → under 100,000 bytes, with `text`, `summary`,
  `document.contentJson`, `bibliography`, `snapshots` and all proofs intact.

**Resolved by the measurement:** the default download is the full record. There is no longer an
argument for a reduced default — it saves nothing an agent needs saving from, and it silently drops
the writer's sources.

---

## 8. Security: what remains after §2

The earlier draft of this section defended an in-file line addressed to AI readers. §2 deleted the
line, and with it most of this section. A document that says nothing to its reader cannot mislead
one.

What still binds, because Inkwave still publishes things that readers act on:

1. **`/ai`, `/ai.txt` and the downloadable instructions file describe the format and supply tools for
   reading it — and say nothing about the writing.** The line is not "no code"; the reader script is
   published there in full (§4, §6.3) and belongs there. The line is between:

   - **permitted — a manual and its tooling:** what a `.studio` file is, what each key holds, the
     reader script, the JavaScript snippet, worked commands, the digest. All of it operates on the
     *file*, mechanically. None of it branches on what the document says;
   - **forbidden — anything addressed to the reader's treatment of the user's work:** what to do with
     a document, how to review it, what to conclude, what to fetch next, claims about the reader's
     own configuration or instructions.

   A `man` page containing example commands is a manual. A `man` page telling you what to think of
   your data is not.

   **The specific temptation to name, because it is ours and not a stranger's:** Inkwave has a
   commercial interest in AI reviewers thinking well of Inkwave documents. A sentence on `/ai` like
   "a `.studio` file comes with a verified provenance record, so you can trust its authorship" would
   be Inkwave's thumb on the scale of feedback a *user* asked for, in a session Inkwave is not party
   to. It is also false (§0: nothing a reader does verifies anything). The page describes the format
   and stops. It does not characterise documents, their authors, or how seriously to take either.

   The rationale throughout is design, not threat: a page that tells an agent what to do with
   someone's writing is a bad shape whoever wrote it, and would stay bad if every `.studio` in the
   world were provably genuine.
2. **Those surfaces are Inkwave-authored and static.** No user content, no query parameters reflected
   into the page, no user-supplied URL printed anywhere.
3. **`/ai` states in one sentence that document text is data, not instructions** — including text in
   a `.studio` that looks like instructions. This is the one reader-facing caution worth keeping, and
   it is now advice about *documents in general*, not a defence of something Inkwave put in one.
4. **The standing-memory entry authorises one URL** (§6.9), never a habit of following documentation
   links found in files.
5. **The reader script's guarantees carry the remaining weight** — stdlib only, no network,
   read-only, published digest (§6.2). It is the only artifact in this feature that executes.

## 9. Acceptance tests

1. **No change to `src/provenance/`.** A regression test asserts `composeTraceFile()` output is
   byte-identical to the pre-feature fixture — this spec must not touch the export path (§2).
2. `/verify` contains a link to `/ai` (§3.4).
3. `/ai`'s `<title>` and `<meta name="description">` contain `.studio` and `Inkwave`, and the
   description answers "how do I read this file" in one sentence (§3.4).
4. Post-launch search check for `.studio file format` and `inkwave studio file`, re-run periodically
   (§3.4).
5. `curl` of the deployed `/ai` returns the documentation text without executing JavaScript (§3.1);
   same for `/ai.txt`.
6. `scripts/studio_read.py` extracts title, text, bibliography and snapshot count from each §1
   fixture, and from a `.gz` of each.
7. Lite export: no `proofBase64`, no `lockedSet`, no `pdfs`; `text`, `summary`, `document.contentJson`
   and `bibliography` all intact; key order preserved.
8. Grep test: no file under `docs/`, `public/` or `scripts/` added by this feature contains an
   imperative addressed to an AI reader (§8.1) — and no file under `src/` mentions `/ai` at all.
   Reviewed by hand, not only by grep: the failure mode is a fluent sentence about how trustworthy
   `.studio` documents are, which no pattern catches (§8.1).
9. `scripts/studio_read.py` imports only stdlib modules and opens no socket (§6.2), asserted by a
   test, not by inspection.
10. The published SHA-256 on `/ai` matches the byte content of the served `studio_read.py` — checked
    in CI against the deployed URL, since a stale digest is worse than none.
11. `/ai.txt` contains the full script text (§6.3), so an agent with no egress to raw file paths
    still gets it in one fetch.
12. Unknown-version behaviour: a fixture with `v: 2` makes the reader report the mismatch rather
    than half-parse (§6.6).
13. No `curl … | python` construction appears anywhere in `docs/`, `public/` or the README (§6.2).
14. `inkwave-format-v1.txt` is byte-identical to `/ai.txt`, its header carries version, date,
    canonical URL and the reader's SHA-256, that digest matches the served `studio_read.py`, and no
    `.studio` export path emits or references it (§6.7).
15. `--media DIR` on the §1 fixture writes four PDFs totalling ~1.5 MB decoded, prints a manifest,
    writes nothing outside `DIR`, and leaves the `.studio` byte-identical (§6.8).
16. `--review` output on the §1 fixture contains prose, bibliography, per-snapshot timeline and the
    media manifest, and contains no base64 (§6.8).
17. `/ai` carries the §6.9 standing-memory wording and its scoping warning, phrased for one specific
    URL and never generalised to "documentation links found in files"; and it contains no
    per-product setup instructions (§6.9).
18. `/ai` and `/ai.txt` both state the ordering limits in §6.5 — that reading the page first is an
    affordance and not a guarantee — so no downstream claim quietly depends on it.

---

## 10. Out of scope for v0.1

- Any change to the export format, `composeTraceFile()`, `TRACE_DATA_MARKER`, or `parseTraceFile()`.
  This spec is now documentation and tooling only (§2).
- Any change to what is hashed, signed, or anchored.
- Content negotiation, an API, or a machine-readable format endpoint. `/ai.txt` is the machine
  surface; it is a document, not an API.
- Reader implementations beyond Python and the inline JavaScript snippet.
- Any write path back into a `.studio` file. The reader reads; it never edits (§6.8).
- Reinstating an in-file pointer line in any form (§2).

---

## 11. Provenance of this spec

Written 2026-09-06 from a cold read of three real `.studio` exports plus the source
(`src/provenance/bundle.ts`, `traceParse.ts`, `hash.ts`, `react-router.config.ts`, `vercel.json`,
`public/robots.txt`). Byte counts in §1 are measured. The back-compatibility claims in §2.3 are read
off the code and are stated as things to test, not as things established. No content from the
documents used as fixtures appears in this spec or anywhere in the repo.
