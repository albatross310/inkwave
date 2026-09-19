# Directed narration for Read along

**Status: agreed product direction, not a shipped feature.** The current implementation provides
EPUB/PDF/text import, saved playback and a basic local Kokoro proof. The model comparison is in
[READALONG-VOICE-MODEL-COMPARISON.md](READALONG-VOICE-MODEL-COMPARISON.md). The cloud GPU worker,
book director, designed cast and character-colour interface below still require implementation,
model auditions and deployment access.

## Two product experiences, one voice system

Peter explicitly wants both a **separate ebook/audiobook creator** and voice features integrated
into the **main editor and every other text-content surface**. The existing separate Read along
window is not, by itself, the finished integration.

The dedicated creator is a book-production workspace: create or import a book, arrange chapters,
set book metadata, analyse the manuscript, review/correct the cast and direction, audition voices,
render chapters or the whole book, and export the ebook and its audio. Ebook packaging/export and
audiobook export are separate deliverables; current EPUB import does not imply EPUB creation exists.

Integrated voice controls should let people listen without leaving the text they are working with:
play from a selection or current position, pause/resume, choose a voice or saved cast, see progress
and change reading speed. Relevant content includes editor documents, PDF/ebook views, saved web
articles, correspondence and generated prose. Each surface needs a deliberate integration;
opening the separate creator is not the only route to hearing text.

Both experiences share document identity, narration profiles, actor references, pronunciation,
source-to-audio mappings, generation jobs, saved recordings and the credit ledger. A book opened
from the editor in the creator keeps its voices; returning to the editor or another device should
reuse the same accepted audio for the same content version. The creator exposes deeper casting,
direction and production controls while ordinary text surfaces retain compact listening controls.

Use one shared playback controller with surface-specific text adapters, so separate panels do not
accidentally play over each other or maintain divergent copies of the cast. Reading must not modify
the source document. Voice metadata and source versions need explicit ownership and persistence.
Showing or editing text must not automatically submit it to a worker or spend credits; the user
initiates generation and sees the applicable quote. Source edits invalidate the appropriate audio
dependencies while preserving previous takes for recovery.

Implementation sequence remains the accepted model audition, a representative document cost and
quality benchmark, the shared voice/profile/job layer, then creator and surface integrations on
that layer. The prepared MOSS audition and current local reader do not implement these experiences.

Existing integration targets, checked from source on 15 September:

| Surface | Integration point |
|---|---|
| Main editor and email draft bodies | `src/editor/TiptapEditor.tsx`, using document/selection positions |
| PDF page and reflow readers | `PdfViewer.tsx`, `PdfReaderView.tsx`, `PdfSidePanel.tsx` |
| Website/article reader | `SourceBrowser.tsx`, using its extracted `ReaderDoc.blocks` |
| Received email and draft previews | `GmailMailboxPanel.tsx`, using the selected message's explicit text |
| Snapshots and comparisons | `SnapshotView.tsx`, `DocView.tsx`, `RichDiffView.tsx`, choosing one source version |
| Comments, annotations and reference notes | Per-note controls or the shared selected-text action |
| Reflections, goals, reports and lesson notes | The relevant panel's explicit prose content |
| Imported books and public explanatory pages | Existing Read along plus shared content/selection adapters |

The website/article reader already exists; its narration integration remains work to do. A live
cross-origin website frame must use supported extraction rather than assuming DOM access. Do not
use global page-body text as a universal source: that would mix menus, duplicate previews,
comparison deletions and unrelated documents. No ebook-creator route currently exists.

## Product requirements

- Natural, high-quality narration comparable enough to leading hosted voices to be pleasant for
  a whole book. Free robotic voices do not satisfy the requirement.
- A separate synthetic voice actor and persona for every character, plus a narrator. Personality
  and speech habits are analysed from the book and used to choose or generate a suitable voice.
- Prefer prompt-generated identities over a small fixed voice list. Default narrator preference:
  adult Australian woman, intelligent, grounded, restrained, with dry awareness of absurdity.
  Character accents follow the text or an explicit casting choice; do not call US/UK presets Australian.
- Every character's identity remains stable across scenes and chapters. Emotion changes performance,
  not the character's underlying identity. Store approved references and generation configuration.
- Each document has a persistent narration profile across Inkwave documents, imported PDFs/EPUBs
  and saved web articles. It retains the narrator, cast/personas, approved voice references,
  pronunciation choices, character colours, accepted recordings and listening position. Reopening
  an unchanged document reuses its existing voices and audio rather than recasting or charging
  for generation again. Cross-device restoration requires private durable storage and a stable
  document identity; a title or website URL alone is not sufficient to identify a content version.
- Keep editing, reading and listening in one document workflow. When source text or direction
  changes, retain previous recordings and regenerate only the affected dependency scope; changes
  to casting or wider narrative context may affect several scenes. Cross-device narration
  profiles, website-reader voice integration and editor-to-reader profile binding are proposed
  features, not capabilities already supplied by the current PDF/EPUB importer.
- Dialogue attribution and colours follow the same character IDs. Narration remains neutral. Colour
  is accompanied by a speaker legend/label and remains legible in both reader themes.
- The director analyses the whole book and chapter before producing scene-level direction. A line
  can carry motives, addressee, subtext and context, but should not become an isolated soundbite.
- Prefer coherent scene/exchange generation. Stateful turn-by-turn synthesis with actual prior
  acoustic/text context is also eligible. Compare natural rhythm empirically rather than imposing
  one request shape on every model.
- Pre-render chapters or whole books, save progress, replay without inference, and resume after
  process or machine interruption. Corrections should regenerate an exchange, not an entire book.
- Public Inkwave demonstration, initially very low traffic. One queued production job at a time is
  sufficient. Keep account and credit handling proportionate to the demo while supporting the
  requested prepaid, at-cost model choices. Visitors need no GPU or provider key.
- Website and coordination remain on Vercel. As of 15 September 2026, the preferred deployment
  is rented cloud GPUs, which connect outward to claim work and can scale independently of the
  website. The Windows 11 Pro / GTX 1070 experiment is a fallback, not a release prerequisite.
  Playback uses saved audio and does not require an active GPU or a connection to the Mac.
- No GPU purchase or cloud charge until an explicit budget/choice is authorized. Compare short
  rentals and actual accepted-audio throughput before buying an RTX 3090 or larger card.
- Pricing direction proposed by Peter on 15 September: user-funded credits, model/quality choice
  and a verifiable no-markup policy. Distinguish paid-job compute, analysis, storage and payment
  costs from profit. Quote before rendering, reserve a maximum, then release unused credits;
  publish the cost basis and return any reconciliation surplus rather than retaining it as margin.
  Payment integration remains unimplemented; audition measurements will determine final tariffs.
- Reconsider the GTX 1070 as an optional owner-subsidised free narration queue while cloud GPUs
  provide paid narration/cast options. Availability depends on the desktop remaining online.
  It is not a substitute for the cloud MOSS audition or evidence that advanced models run on Pascal.
- Latest listening feedback: Peter says the working local Kokoro voice sounds quite good, while
  the Read along interface remains flawed. Treat Kokoro as a serious free-tier candidate and
  assess reader usability separately from voice quality. The present q8 runtime is CPU-only;
  a dedicated GTX is not required. On-device browser deployment and low-end hardware limits
  still need verification before advertising a supported minimum configuration.

## Preliminary PDF cost model

Price imported words and the selected rendering mode, not PDF page count. For illustration only,
15 pages at 400 words/page means 6,000 words, or 40 minutes at 150 spoken words/minute. A sparse
slide deck and a dense two-column paper can differ substantially. Scanned PDFs need a separate
OCR step; the current importer requires a text layer.

With the 14 September RBA reference rate (A$1 = US$0.7149), Runpod's advertised A5000 rate
US$0.27/hour yields approximately A$0.063/0.189/0.378 for 10/30/60 billable minutes. The A6000
US$0.53/hour yields A$0.124/0.371/0.741 for the same durations. These are compute-only scenarios,
not measured per-PDF prices. Scene generation, voice design, the director, startup, accepted
retakes, storage, payment fees, FX and applicable taxes must be included or explicitly subsidised.
Automatic scaling has its own rates and billable startup/idle rules; do not reuse Pod rates as
serverless quotes. [Runpod rates](https://www.runpod.io/pricing),
[serverless billing](https://docs.runpod.io/serverless/pricing),
[RBA reference](https://www.rba.gov.au/statistics/frequency/exchange-rates.html).

At the current Australian domestic-card rate, an A$10 total payment incurs A$0.47 in basic Stripe
processing fees, leaving A$9.53 before other applicable charges. Credit top-ups should amortise
the fixed fee and display their usable value clearly. These September rates are time-sensitive;
Stripe advertises a scheduled domestic-rate reduction from 1 October 2026.
[Stripe Australian pricing](https://stripe.com/au/pricing).

## Director records

Use three layers, each versioned and linked to the exact source text hash:

1. **Book record:** synopsis, timeline, relationships, recurring names/aliases, unresolved facts,
   pronunciation lexicon and the overall tension/character arcs. The analysis must cover every
   chapter, with hierarchical consolidation/retrieval where a whole novel exceeds practical context.
2. **Cast record:** stable character ID, display name, persona, evidence spans, voice-design prompt,
   chosen audition, reference audio/transcript, model revision/seed, pronunciation rules and colour.
   Distinguish evidence from casting choices when age, accent or traits are unspecified.
3. **Scene record:** source range, scene state, emotional trajectory and participating actors. Each
   spoken span records speaker, addressee, intent/subtext, evidence/confidence and supported delivery
   notes. Preserve narration and dialogue tags as source text; this is an audiobook, not an automatic
   rewrite into a screenplay.

The reader should allow cast and attribution review before a long render. Uncertain attributions
must be visible and correctable. The system should not replace uncertainty with an invented actor
assignment or permanently freeze an early chapter-summary mistake.

## Source and performance are separate

Spoken spans refer to exact UTF-16 ranges in the imported source. They must be ordered, in bounds,
non-overlapping and collectively preserve the narrated source. The original text remains the book;
director notes are metadata. Imported text and model output are data, never instructions to run
shell commands, access unrelated files or contact arbitrary URLs.

Each renderer adapter declares its actual capabilities: new identity design, persistent reference,
non-spoken instruction channel, inline controls, scene speaker limit, prior-audio continuation,
context budget and native timing. Compile only supported controls. Do not send motive prose as
ordinary speech input and assume it will remain silent. A generic processor accepting an instruction
field is not evidence that a particular checkpoint was trained to obey it.

Audition unsupported or uncertain controls through A/B tests. If context/direction does not improve
the result, expose that limitation instead of presenting unused metadata as a working director.

## Rendering and alignment

Choose scene boundaries from the actual conversation and model limits, not a fixed line count.
Carry compatible prior acoustic context across boundaries where the model supports it. Preserve
speaker identities through references/prompts rather than generating a fresh timbre from the same
English description on every request.

Store a master take and a browser-playable derivative with stable media timing. Long-book delivery
should use a compressed format compatible with Safari/Chrome; the existing local WAV baseline and
1.5 GB archive cap are not a finished whole-book storage strategy. Align against the final playable
asset or account explicitly for encoding delay. Keep source span IDs and actor IDs independent of
codec chunk boundaries.

Check omissions, repetitions, wrong speakers, voice drift, spoken directions and audible seams.
Alignment alone is not proof of faithful delivery. When word timings are absent or inconsistent,
use disclosed passage tracking while retaining correct character colour; never fabricate words'
timestamps to make the interface look synchronized.

A cache identity includes source hash/range, model/revision, actor reference hash, accepted direction
and encoding/timing schema. A changed persona or direction must select a new take, while preserving
older recordings for recovery. Job retries reuse completed verified assets and record failed takes.

## Vercel-to-worker boundary

The proposed flow is `browser → Vercel job service ← outbound cloud GPU worker`.
Vercel stores durable job state and coordinates short API calls. GPU inference never occupies a
multi-hour serverless request. Use persistent object storage for source, plans, references and
accepted audio, with explicit retention/deletion behaviour disclosed to uploaders.

A public visitor receives a private unpredictable job receipt; no public listing reveals book text
or audio. Each worker has a separate registration credential stored privately on the machine and
server, never in browser code or Git. No home inbound port or Mac-to-desktop connection is needed.

Minimum states: queued, analysing, awaiting cast review, queued for rendering, rendering, complete,
paused and failed. Worker claims are leased and acknowledged, with heartbeat and checkpoint writes.
An expired worker lease can resume unfinished work; it must not overwrite completed audio or turn a
failed storage read into an empty job. One active production claim is sufficient for the demo.

The first MOSS audition is prepared in `tools/readalong-moss/`, with three voice descriptions,
two connected original scenes, a pinned runtime, cloud lifecycle scripts and a local review page.
It is not a deployed GPU worker and has not yet produced MOSS audio. Account access and an
explicit audition budget are pending. The retained Windows preparation script is optional.

## Acceptance before public release

- Blind listening comparison against suitable premium hosted references, using the same original
  scenes and a bounded retake allowance. Test restraint as well as dramatic extremes.
- Australian authenticity where requested; clear cast separation; the same actor returning later;
  implied meaning and response timing; no persistent overacting or synthetic promotional delivery.
- Exact source preservation, visible attribution uncertainty and stable character colours.
- Measured VRAM, RAM, wall time, failed takes and total cost per accepted scene/chapter. Do not use
  GPU-hour price as a proxy for finished narration cost.
- An uninterrupted chapter and then a complete book, including resume after restart and selective
  correction of one scene. Test browser playback and archive limits on realistic book sizes.
- Actual cloud GPU checks and a real Vercel deployment, including private job access, worker
  reconnection and honest offline/queued status. A local mock test cannot establish those properties.
