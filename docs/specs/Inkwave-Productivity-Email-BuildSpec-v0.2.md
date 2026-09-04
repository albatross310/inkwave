# Inkwave — Productivity & Email Layers: Build Specification

**Version:** 0.5 (working draft — adds dual email surfaces and multi-message composition, see §D2)
**Date:** September 2026
**Status:** Design spec for three connected layers — (A) Productivity Tracking & Reporting, (B) Email-in-Workflow including an optional Gmail mailbox, and (D) Subdocument Workspaces & Multi-Container Sync — built on Inkwave's existing local-first, zero-retention, provenance architecture. The decisions from v0.1 §C4 remain in force; v0.3 defined the subdocument workspace, v0.4 defined separate send-only and connected-mailbox permission tiers plus Inbox/Drafts/Sent synchronisation, and v0.5 defines isolated and contextual email surfaces with safe multi-message sending.

---

## 0. Framing and phasing

Inkwave today is a rich-text writing tool with a provenance spine (client-side edit history, hashing, and OpenTimestamps/Bitcoin anchoring), storing everything in the user's own documents (zero cloud retention). These layers extend that identity in three directions:

- **Productivity layer** turns the provenance/session telemetry Inkwave *already collects* into a daily/weekly/monthly reflection on how the user worked — a Pomodoro rhythm, a work tracker, and an AI-written report. This converts Inkwave from an occasional-use "authorship insurance" tool into a daily companion.
- **Email layer** brings email *composition* into Inkwave so that (i) email writing counts toward the productivity stats, and (ii) emails inherit Inkwave's provenance. The actual sending happens through the user's existing provider (Gmail/Outlook/etc.), so Inkwave never becomes an email host.
- **Subdocument workspace** lets pages and emails live in an ordered horizontal sequence, either inside one `.studio` container or shared deliberately across several containers. It adds spatial navigation without turning a browser tab into the unit of authorship or weakening the existing per-document provenance boundary.

The guiding staging decision (set by product owner):

- **MVP (Phase 1):** productivity layer end-to-end + email *writing* integrated into the workflow so it shows up in the daily report, with provenance provided by Inkwave's **existing OTS spine only** (no DKIM). **Gmail is the first (and MVP) provider** for sending (§B3). The AI report ships two paths from day one: a free manual **paste-back**, and a **backend** path (login required) with a few free submissions per user per month before an **Insignia** subscription is needed (§A7.2, §C6).
- **Phase 2:** richer AI reporting, BYO-key seamless mode, and email *sending* via provider APIs.
- **Phase 3 ("crown jewel"):** full DKIM capture + a provider public-key archive ("trust base") + combined DKIM/OTS verification at `inkwave/verify`.

Everything below is written so Phase 1 is shippable on its own and Phases 2–3 slot on without rework.

---

## PART A — PRODUCTIVITY TRACKING & REPORTING LAYER

### A1. Goals and non-goals

**Goals**
- Give the user a daily rhythm (Pomodoro-style focus sessions) and a sense of closure/reward at day's end.
- Track *objective* work metrics (time worked, words written, breaks taken, edits) with zero extra effort, reusing provenance telemetry.
- Produce a readable daily/weekly/monthly report with an honest split between *measured* facts and *AI-judged* interpretation.
- Keep the whole thing consistent with Inkwave's privacy posture: local-first, zero-retention, encrypted at rest, user-controlled AI export.

**Non-goals (for now)**
- Not a surveillance/scoring tool. No shaming, no imposed "productivity score" presented as objective truth.
- Not a team/manager analytics product. Single-user, personal reflection only.
- No collection of data that isn't feeding a concrete feature (see data minimisation, A3).

### A2. Core concepts

- **Session:** a contiguous stretch of work in a document, bounded by inactivity gaps beyond a threshold (default 5 minutes) or an explicit Pomodoro boundary.
- **Break:** the gap between sessions.
- **Master ledger:** a per-month, user-owned document that aggregates session metadata across *all* documents the user worked in. This is the single source of truth for the productivity layer and the thing the AI report is generated from.
- **Report window:** daily / weekly / monthly view over the ledger.
- **Measured vs judged:** measured fields are computed locally from telemetry and are exact/deterministic; judged fields come from the AI and are labelled as interpretation, never presented as measurement.

### A3. Data model

#### A3.1 The master ledger

- One ledger file per calendar month, e.g. `inkwave-ledger-2026-07`.
- Stored exactly like any other Inkwave document: in the user's own storage, encrypted at rest. Inkwave's servers never hold it. This is what preserves zero-retention while still allowing cross-document aggregation.
- Written to in the background as the user works in *any* document (append/update on session close, on save, and on app idle/exit).
- Doubles as a **signed provenance ledger**: each appended row (or each daily block) is hashed into Inkwave's existing provenance chain, so the ledger itself is tamper-evident and can be OTS-anchored. This reframes the ledger from "a privacy liability that aggregates everything" into "your verifiable monthly work record" — an on-brand feature, not a risk.

#### A3.2 Session metadata schema (measured fields)

Each session row (the atomic unit) contains only metadata — **never document prose** in the persistent ledger:

| Field | Type | Notes |
|---|---|---|
| `session_id` | uuid | |
| `doc_id` | string | which document (stable id, not title, to avoid leaking titles if not wanted) |
| `doc_label` | string (optional) | user-visible title; can be suppressed per-doc |
| `start` | ISO-8601 | session start |
| `end` | ISO-8601 | session end |
| `active_minutes` | number | time actually editing (excludes idle within session) |
| `words_start` | int | word count at session start |
| `words_end` | int | word count at session end |
| `words_added` | int | gross additions |
| `words_deleted` | int | deletions (editing/restructuring signal) |
| `net_words` | int | `words_end - words_start` |
| `edit_events` | int | number of discrete edit operations |
| `break_before_min` | number | gap since previous session |
| `pomodoro` | bool | was this a timed Pomodoro block |
| `doc_type` | enum | `note`, `essay`, `email`, `other` (email sessions flagged here — see Part B) |

**Data minimisation (explicit rule):** the ledger stores none of: geolocation, IP, keystroke-level content, or the prose itself. Location in particular is *not* collected — it adds sensitivity (habits + whereabouts) for no feature benefit. The best protection for data is not holding it. Anything added later must clear a "does a real feature need this?" bar.

#### A3.3 Derived daily/weekly/monthly aggregates

Computed **client-side** from the ledger, never requiring the AI:

- Per day: total active minutes, session count, net/gross words, break count and durations, deep-vs-shallow ratio *by heuristic* (e.g., high add-to-delete ratio + long sessions → drafting; high delete + short → editing), busiest hours histogram.
- Per week: day-by-day rollups, weekday patterns, break-vs-output correlations (descriptive only).
- Per month: trend lines, week-over-week deltas.

Aggregating client-side is also what keeps AI payloads small regardless of window (see A6): you send compact rollups, not raw logs, so a monthly report doesn't degrade or blow up token counts.

### A4. Capture: how telemetry is collected

- Hook the existing edit stream (the same events the provenance spine already listens to). No new instrumentation of content — you're deriving counts from events you already have.
- Session boundary detection: inactivity timer (default 5 min) + explicit Pomodoro start/stop + document switch.
- Pomodoro timer UI: configurable work/break lengths (default 25/5, long break 15 after 4), start/pause/stop, gentle end-of-session chime. A Pomodoro block writes a `pomodoro: true` session.
- On session close: compute the session row and append to the current month's ledger (background write; debounce to avoid churn).
- Multi-document: because capture is global (any open doc contributes), the ledger naturally spans documents; `doc_id`/`doc_type` disambiguate.

### A5. The daily loop

**⚠️ REVISED 2026-07-17 — the tone rule is REVERSED. Read this before the strikethrough below.**

Owner decision, verbatim: *"tbh I think it's too nice and not enough humour. We need it to be quirkier and read like a comedian wrote it"* and *"**It doesn't need to be kind. It needs to be honest.**"*

- **Honest first, funny second, kind third.** The report reads like a sharp friend who has seen your week, not a wellness app. Quirky, specific, willing to name a bad day a bad day.
- **The distinction that survives the reversal — and it is the whole thing:** *productivity guilt* is **a standard imposed on the writer**; *accountability* is **a goal the writer set** (§A5b). "You only managed 200 words, poor effort" is imposed, worthless, and still banned. "You said you'd finish the lit review by Friday and you've opened it twice" is honest, is *his own words quoted back*, and is the point. **The goals section is what gives the report standing to push.** Without a stated goal there is nothing to be accountable *to*, and criticism collapses back into guilt.
- Still forbidden, because they were never about kindness: **scoring, ranking, grading, or comparison to other people**; asserting causation the data can't support (§A6.2); presenting judgement as measurement (§A6.1).
- Streaks/rewards: reward *showing up and reflecting*, not raw output — a thinking-heavy, low-word day still counts.

~~Design rule: the tone must be kind and reflective, never shaming. A low-output day should read as understanding, never as a scolding. Productivity-guilt tooling gets deleted and is bad for users; this is a hard constraint, not a nicety.~~ — **superseded.** The original rationale (guilt tooling gets deleted) stands as a warning against *imposed* standards; it is not a licence for vagueness or flattery.

### A5b. Goals and plan (NEW, 2026-07-17) — what the report is accountable to

Owner: *"each doc has the writers goals in it and a rough plan — and the AI's prompts need to include the goals so it can give users a kick up the butt if they're not meeting their goals."*

- **Per-document**, authored by the writer: a **goal** (what this document is for, what "done" looks like) and a **rough plan** (milestones, rough dates — deliberately informal; a plan nobody writes is worse than a vague one).
- Stored on the document, like any other content: user's own storage, never Inkwave's servers.
- **The goals travel in the AI payload** (they are the writer's own words about their own intent, so they belong to the same consent tier as diary notes — opt-in, see §A7.3) and the fixed prompt instructs the model to hold the writer to them: progress against the plan, drift, avoidance, the thing that keeps getting deferred.
- **This is what makes §A5's honesty legitimate rather than rude.** The model is not judging whether the writing is good enough; it is reporting the gap between what the writer said they'd do and what the ledger shows they did.
- **Honesty boundary:** with no goal set, the report **must not invent a standard to measure against**. No goal ⇒ describe, don't push.
- Open: whether goals are per-document only, or also per-window (a weekly intention). Owner's call, later.

### A6. The AI report

The report is where the LLM earns its place: turning aggregates into a readable narrative and adding *judgment* fields the client can't compute mechanically.

#### A6.1 Measured vs judged (the honesty core)

- **Measured layer** (from the ledger, client-side): time, words, breaks, edit counts, histograms. Graphed as hard data. Deterministic. Never round-tripped through the LLM (see A6.4).
- **Judged layer** (from the AI): qualitative reflection ("your deepest writing came in the first 25 minutes after a break"), and optional *judged fields* the client can't derive (e.g., per-session `phase: deep|shallow`, inferred effort/momentum, thematic progress if content is shared).
- Judged fields are always visually **labelled as AI assessment** (distinct styling/series/annotation), never mixed into the measured bars as if they were measurements. This protects credibility with a discerning (e.g. academic) audience and avoids "vibes-as-numbers."

#### A6.2 Report windows and statistical honesty

- **Daily** = descriptive recap only ("here's what today looked like"). One day is statistically noise for *pattern* claims, so daily must not assert causal break/productivity claims.
- **Weekly** = the default and the sweet spot: enough sessions for genuine patterns, recent enough to act on, natural review cadence, one AI round-trip per week.
- **Monthly** = trend view ("are things improving").
- Confident *pattern* claims (breaks help/hurt, best time of day) are permitted only at weekly+ where there's enough data.

#### A6.3 Windowing and the daily→weekly backfill

- Daily runs are cheap and rewarding; weekly is the default aggregate.
- **Backfill design:** the weekly run reuses dailies already generated and only produces the *missing* days, then synthesises the week. Cap backfill (e.g., one month) to bound cost/context.
- **Paste-compatible batching:** to keep the copy-paste round-trip usable (see A7), a single AI call emits *all* missing dailies **plus** the weekly summary in one structured response, which Inkwave parses into per-day sections. (Parallel per-day "agents" are only worth it in a programmatic/API mode, not the manual paste mode.)

#### A6.4 Data-integrity rule (critical)

**Never round-trip measured numbers through the LLM.** LLMs can silently "tidy," round, or hallucinate numbers, and for a traceability/authenticity brand that would corrupt the very thing being sold. Therefore:
- Inkwave computes and graphs the measured CSV *itself*, client-side; those numbers never leave for the model to touch.
- The model contributes only the narrative markdown and any *new judged* fields.
- The client then merges: measured bars (ground truth) + judged fields (labelled interpretation).

### A7. The round-trip and privacy model

Because Inkwave is zero-retention and the AI providers are third parties, the analysis is designed so the *user* sends their data, not Inkwave.

#### A7.1 Export → analyse → paste-back (MVP path)

1. **Compile:** Inkwave assembles an analysis-ready payload from the ledger for the chosen window (compact rollups + the fixed prompt). This compilation is itself the reason the round-trip returns to Inkwave — the user can't easily assemble it elsewhere.
2. **Transparent prompt:** the payload begins with a **fixed, publicly-visible first half** (the exact instructions and output schema Inkwave asks the AI to follow) and an optional **user-written second half** (customisation), layered over sensible defaults so most users never need to write a prompt.
3. **User runs it** in their own Claude (or other) session.
4. **Structured output:** the model returns (a) a markdown narrative and (b) a **CSV of judged fields** wrapped in a clearly-delimited fenced block (```` ```csv … ``` ````). CSV is chosen over JSON because the data is flat (rows = sessions/days), and because the user can open it in Excel — reinforcing data ownership.
5. **Paste-back:** the user pastes the *whole* reply into Inkwave; Inkwave scans for the fenced CSV block, parses it forgivingly (handle quoting, whitespace, extra prose), validates columns against the expected header, and on failure shows a graceful "couldn't read the table — paste the full reply / here's the format" message.
6. **Merge & graph:** Inkwave graphs its own measured CSV + the model's judged CSV, clearly distinguished, and renders the markdown narrative. "Download .md / .csv" buttons reinforce that the data is the user's to keep.

#### A7.2 Modes (decided)

Two paths ship at launch; a third is optional later.

- **Path 1 — Manual paste-back (free, no login, maximal privacy).** The user runs the compiled prompt in their own Claude/other session and pastes the reply back; Inkwave graphs client-side. No key, no cost to Inkwave, and the user is the one sending their own data. This path is always free and always available — the privacy-pure core is never paywalled.
- **Path 2 — Backend (login required; freemium → Insignia).** Inkwave's backend makes the AI call on the user's behalf, so there's nothing to copy-paste. Gated by login, with **a few free submissions per user per month**; beyond that quota it requires an **Insignia** subscription (§C6). Because the payload transits Inkwave's backend, this path **does not carry the pure "we never handle your data" guarantee** of Path 1 — it must be clearly disclosed at the point of use. Backend policy: send only what's needed (metadata unless the content tick-box is set), **log/store nothing** (process in memory, discard), use a cheap model (Haiku/Sonnet — Opus is unnecessary for narrative-from-data and ~5× the cost), and operate under a zero-retention arrangement with the model provider.
- **Path 3 — BYO-key (optional, later).** For power users: the user supplies their own API key and Inkwave calls the provider **client-side (device → provider directly)**, so nothing transits Inkwave's servers — seamless *and* zero-retention for Inkwave. Friction (developer-console signup + per-token billing) makes this a power-user option, not the default.

Whichever path is used, the **measured-vs-judged** and **data-integrity** rules (A6.1, A6.4) still hold: Inkwave graphs its own measured numbers client-side and never round-trips them through the model.

#### A7.3 The content tick-box

- By default, only **metadata** is exported (how you worked).
- An **opt-in, off-by-default** control lets the user include the *actual text* of chosen documents for richer, content-aware feedback (quality, structure, thematic progress).
- **Per-document**, not a blanket toggle: the export screen lists the window's documents (from the ledger), metadata always included, content include-tick beside each — so the essay can be shared while the private journal stays metadata-only.
- Full prose balloons tokens, so content-included analysis is best on the **daily** window (one day's text); weekly/monthly should use summaries or stay metadata-only.
- Clearly labelled at the point of consent ("this sends the text of these documents to your AI"). This is exactly where the user-sends-it-themselves path matters most.

### A8. Visualisation

- All graphs render **client-side** from the merged data. No server round-trip, consistent with privacy.
- Libraries: whatever Inkwave already ships for rendering; charts kept simple (bars for time/words, histograms for hours, line for trends).
- Measured series and judged series are visually distinct (e.g., solid measured bars, hatched/annotated judged overlays) with a legend that says which is which.

### A9. Failure handling and edge cases

- **Parse failure** on paste-back: graceful fallback + show expected format; never silently drop data.
- **Multi-device:** the ledger lives in the user's own storage; cross-device consistency relies on *their* sync (their cloud), never Inkwave's servers. Concurrent appends from two devices must be merge-safe (append-only rows keyed by `session_id`; last-writer-wins only on the same session).
- **Missing days / gaps:** handled by the backfill logic (A6.3); gaps are shown honestly, not fabricated.
- **Time zones / DST:** store UTC + offset; aggregate in the user's local day.

### A10. Phase-1 acceptance criteria (productivity)

- Pomodoro timer with configurable work/break lengths and a gentle end chime.
- Background session capture writing to a per-month encrypted ledger, spanning all documents.
- Client-side daily/weekly/monthly aggregates and graphs (measured only) with no AI required.
- Export → paste-back flow producing a markdown narrative + judged CSV, merged into graphs, with the measured/judged distinction visible.
- Transparent fixed prompt + optional user prompt + content-off-by-default per-document tick-box.
- Kind, non-shaming daily reward loop.

---

## PART B — EMAIL-IN-WORKFLOW LAYER

### B1. Goals and the "why email" rationale

The primary reason to bring email in is **workflow integration**: for many users, email is a large share of their daily writing and work. If it's composed inside Inkwave, it (i) counts toward the productivity stats, making the daily report *complete* rather than missing a big chunk of the user's actual output, and (ii) inherits Inkwave's provenance. Sending still happens through the user's existing provider, so Inkwave never runs mail infrastructure and there's nothing for the user to switch — which also makes it a genuinely low-friction adoption hook ("compose here, send through your Gmail").

**MVP scope (explicit):** integrate email *composition* so it appears in the productivity ledger, with provenance from Inkwave's **existing OTS spine only** (no DKIM). Full DKIM capture and verification is Phase 3.

### B2. MVP: compose-in-Inkwave, count it, provenance it, hand off to send

#### B2.1 Compose

- An email is a first-class Inkwave document with `doc_type: email` and structured header fields (To, Cc, Bcc, Subject) plus a body.
- Because it's an ordinary document, all existing behaviour applies for free: edit history, provenance hashing, and — crucially — **session capture**, so composing an email produces normal session rows in the ledger tagged `doc_type: email`.
- This alone delivers the primary goal: email writing now shows up in daily/weekly/monthly productivity (e.g., "2h10m writing, of which 40m on email across 6 messages").

#### B2.2 Provenance (MVP — OTS only, no DKIM)

- On "finalise"/send, Inkwave hashes the composed email (headers + body) and anchors it through the **existing OpenTimestamps spine**, exactly as it does for documents.
- This yields **draft-provenance**: a durable, independently-verifiable record that *this exact content existed by time T* (verifiable against Bitcoin at `inkwave/verify`, no inbox and no trust in Inkwave required).
- **Honesty boundary (must be stated in-product):** OTS proves *content existed by time T*. It does **not** by itself prove *sending*, *delivery*, or *origin*. So MVP provenance is "I had written exactly this by this time," which is genuinely useful for priority/commitment/"I told you so on this date" cases — but it is not yet proof of sending. Do not market it as proof of sending until Phase 3 adds DKIM.

#### B2.3 Sending — two options

- **B2.3a Handoff (simplest MVP):** an "Open in [provider]" action pre-fills the provider's compose window (Gmail/Outlook compose URL, or `mailto:` for simple cases) with To/Subject/Body; the user hits send in their provider. No OAuth, no API verification, shippable immediately. Limitations: best for plainer emails (URL/`mailto` length and formatting limits), and the user could edit before sending, so provenance is of the *Inkwave draft*, not necessarily the sent bytes.
- **B2.3b Provider API send (Phase 2):** Inkwave sends directly via the provider API (see B3). Seamless, supports rich email, and — importantly — because Inkwave controls the exact bytes, it can then fetch the *sent* message and provenance the actual sent content (bridging toward the crown jewel).

**Decision:** MVP targets **Gmail API send** (`gmail.send`) as the primary path (§B3), because it enables sent-byte provenance and a seamless in-app experience. The **handoff** (B2.3a) is retained as the interim/fallback while Google OAuth verification is completed, and for any provider not yet API-integrated.

### B3. Provider integration (Gmail first)

Email sending is provider-specific; abstract it behind a single `MailSender` interface with per-provider adapters. **Gmail is the first adapter and the MVP target;** others follow as demand appears.

- **Gmail (first / MVP):** Gmail API, OAuth scope **`gmail.send` only** (send without inbox-read — minimal permission, on-brand). Note Google's restricted-scope **verification** (and possible security assessment) is required for production — a real but surmountable hoop; the compose-URL handoff (B2.3a) covers the gap while verification is pending.
- **Outlook / Microsoft 365:** Microsoft Graph API (`Mail.Send`), Azure app registration + Microsoft OAuth. DKIM is applied by Microsoft's outbound servers exactly as with Gmail — it is *not* a Gmail-only mechanism (DKIM is the open standard RFC 6376; every serious provider signs outbound mail). So the same capture approach works cross-provider.
- **Generic SMTP:** the universal fallback — most providers support SMTP send (via OAuth or app-password). Broadest coverage for least per-provider work; good first adapter for "any provider."
- **Proton:** the awkward, ironically-most-on-brand case: **no open cloud API.** Integration is only via **Proton Mail Bridge** (local IMAP/SMTP, paid plans). Treat as a Bridge/SMTP adapter, not a cloud API.

**Scope discipline:** "integrate with any provider" = N separate adapters, each with its own auth and verification. **Gmail ships first** (largest single audience, and it unlocks the Phase-3 provenance path); generic SMTP (for breadth) and Graph follow as demand appears.

#### B3.1 Gmail capability tiers — never silently broaden permission

Gmail integration has two explicit connection modes. They share a client adapter but not a consent
promise:

1. **Send only (default/minimal):** request only `https://www.googleapis.com/auth/gmail.send`.
   This is the current direct-send feature. It cannot list or read the mailbox.
2. **Connected mailbox (optional):** a separate writer action requests:
   - `https://www.googleapis.com/auth/gmail.readonly` to view Inbox and Sent; and
   - `https://www.googleapis.com/auth/gmail.compose` to create, read, replace, and send Gmail drafts.

Both mailbox scopes are Google **restricted** scopes. `gmail.modify` is deliberately absent from the
first mailbox build. It may be requested later only when the product actually implements mailbox
mutations such as mark-read/unread, archive, star, trash, or label changes. The full
`https://mail.google.com/` scope is forbidden: Inkwave has no reason to bypass Trash and permanently
delete mail.

- Choosing Send only must leave Inbox/Drafts/Sent disconnected rather than showing dead controls.
- Choosing Connected mailbox uses Google's incremental authorization and shows the exact added
  capabilities before opening consent.
- Existing send-only users are never upgraded automatically, including after deployment.
- Disconnect clears in-memory tokens and the local Gmail account/index cache. It does not delete
  Inkwave documents or mail from Gmail.
- Revoking a scope degrades only the features that require it. A lost mailbox grant must not disable
  local email writing or provider handoff.
- Do not add a scope to the OAuth request or Google consent configuration before the corresponding
  user-facing feature exists and can be demonstrated; minimum-scope review treats future-use scopes
  as unjustified.

#### B3.2 Mailbox information architecture

The connected mailbox has three primary views:

- **Inbox:** thread-first, newest activity first. Each row shows sender, subject, received time,
  unread/attachment indicators, and a short Gmail-provided snippet. Opening a thread fetches its
  messages on demand.
- **Drafts:** one row per Gmail draft, using Gmail's stable `draft.id`. Opening a draft materialises
  or reconnects an editable Inkwave email document. The message ID inside a Gmail draft is not an
  identity because Gmail replaces it whenever the draft is updated.
- **Sent:** thread/message list carrying the Gmail `SENT` system label. Sent messages are read-only;
  “use as new draft” creates a new local email identity rather than editing history.

Mailbox lists are provider views, not `.studio` containers and not provenance records. A remote
message becomes an Inkwave subdoc only through a deliberate action: open a Gmail draft for editing,
start a reply/forward, or save a received/sent message into a workspace. Merely browsing Inbox must
not manufacture local documents, snapshots, ledger sessions, or sync memberships.

The centred, content-height email surface (§D2) is shared by local drafts and connected Gmail
drafts. Received and sent mail use the same visual language in read-only mode, with
sender/date/provider state replacing compose controls. Inbox/Drafts/Sent navigation must integrate
with overview mode without turning every remote row into a mounted editor.

#### B3.3 Fetch, cache, and rendering boundaries

- Inbox and Sent list by Gmail system label. Fetch lightweight metadata/snippets for visible rows;
  fetch full MIME only when a message/thread is opened.
- Prefer a thread index for Inbox/Sent so conversation UX does not duplicate a row for every message.
  Drafts remain draft-resource-first because `draft.id` is the stable writable identity.
- Full remote bodies are memory-only by default. A small local index may cache provider IDs, thread
  IDs, labels, headers, snippet, attachment presence, and the last Gmail `historyId` for responsive
  reopening. “Save to Inkwave” or opening a Gmail draft may persist content locally as an ordinary
  Inkwave document.
- HTML mail is untrusted. Render sanitised content in an isolated, non-scriptable surface; never
  execute scripts, forms, event handlers, embedded objects, or arbitrary styles from a message.
  Plain text is the baseline and fallback.
- Remote images are blocked by default because fetching them can disclose the reader's IP address,
  time, and message-open event. “Load images” is a per-message writer action; no sender allow-list is
  inferred silently.
- Attachments load only after an explicit click, retain provider filename/type/size metadata, and are
  validated before preview. No attachment is copied into a `.studio` document unless the writer asks.
- Links show their real destination and open outside the message surface. Message content never gains
  authority to invoke Inkwave actions.
- Tokens, MIME bodies, and attachment bytes travel directly between the writer's browser and Google.
  No Inkwave endpoint proxies, logs, stores, or analyses them.

#### B3.4 Foreground synchronisation and conflict rules

The first mailbox build uses foreground synchronisation. It does not use Gmail push notifications,
because Gmail watch delivery requires Google Cloud Pub/Sub/backend infrastructure and would introduce
a server-side mailbox event path.

- On connection/open, fetch the current label/thread/draft index and record Gmail's `historyId`.
- While the mailbox is visible, poll conservatively and use `users.history.list` for incremental
  changes. When the stored history point is no longer valid, rebuild the remote index; never interpret
  history expiry or a failed read as an empty mailbox.
- Pause mailbox polling while the page is hidden/offline and refresh on visibility/reconnect.
- Coalesce requests, honour Gmail retry/rate-limit guidance, and expose `offline`, `refreshing`,
  `current`, `permission needed`, and `failed` states. Never show stale data as current merely because
  it exists in cache.

For Gmail drafts:

- Persist a provider reference on the local email document containing Gmail account identity hash,
  stable `draft.id`, current message ID, last remote history marker, and the last successfully synced
  canonical MIME/content hash. Never persist an access token.
- After a local edit, save locally first, then queue a throttled Gmail draft create/update. A Gmail
  failure leaves the local draft intact and visibly unsynced.
- Before replacing a Gmail draft, compare the current remote draft with the last successfully synced
  hash. If only local changed, upload; if only remote changed, import; if both changed, preserve both
  by creating a local conflict copy and ask the writer to resolve. Timestamps never decide content.
- Gmail's draft update replaces the contained message and changes its message ID. Continue tracking
  by stable `draft.id` and update the recorded message ID after every successful replacement.
- Sending a connected draft records the exact current Inkwave draft first, then uses `drafts.send`.
  On success, clear the draft mapping, retain the returned sent message ID/thread ID, and show it in
  Sent. A response timeout is “send status unknown”, not “failed”: refresh Sent/draft state before
  offering a retry, preventing duplicate mail.
- The existing direct `messages.send` path remains available for local drafts that were never synced
  to Gmail.

#### B3.5 Mailbox OAuth, verification, and launch boundary

- `gmail.readonly` and `gmail.compose` require Google's restricted-scope verification for a public
  launch. Google may also require a recurring security assessment; the exact assessment depends on
  Google's review and data-handling classification.
- Inkwave's design keeps restricted Gmail data out of Inkwave servers. This is both the privacy rule
  and the narrowest review posture, but it does not remove Google's authority to require verification.
- Pre-launch development may use the owner/test accounts behind an experimental feature flag and the
  unverified-app warning/user cap. Public UI must not advertise the mailbox as generally available
  until the scopes are approved.
- Use a separate staging OAuth project/client while building or changing restricted scopes, so the
  working send-only client and its consent surface are not destabilised by unfinished permissions.
- Verification materials must include the public privacy policy, exact scope justifications, a demo
  of Inbox/Drafts/Sent, disconnect/deletion behaviour, and proof that Gmail data is not sent through
  Inkwave infrastructure.

### B4. Phase 3 — the crown jewel: DKIM capture + key archive + combined verify

This is the differentiated, uniquely on-brand feature; it is explicitly **later**, after people are using the MVP.

#### B4.1 What DKIM adds

- Every message a real provider sends is DKIM-signed: a cryptographic signature by the sending domain over the signed headers + body hash. A valid signature proves **origin** (the domain sent it) + **integrity** (content unaltered). This is the piece OTS lacks (OTS proves existence-by-time, not origin).
- Capturing the DKIM-signed *sent* message therefore upgrades provenance from "I had this content by T" (OTS/draft) to "the provider cryptographically vouched this exact content was sent at ~T" (DKIM) — and OTS then adds durable, independent time.

#### B4.2 The durability problem and the "trust base" solution

- DKIM public keys **rotate** and are removed from DNS; once gone, a captured signature can no longer be verified by a third party (they can't fetch the key). So a captured signature alone **decays** — it is not automatically permanent.
- **Solution (decided):** Inkwave maintains its own archive of providers' DKIM public keys, timestamped as observed — a **trust base / key notary** — so that verification years later uses the *archived* key, not live DNS. When Inkwave captures a signed message it records the message + the DKIM-Signature + the *public key valid at signing*, and OTS-anchors the bundle.
- **Hosting & governance (decided):** the trust base is **self-hosted by Inkwave**, but it is deliberately **not a black box.** Every change to the registry (new key, rotation, retirement) is recorded **append-only** and attested with **Inkwave's own provenance architecture** (hash-chained + OTS-anchored), and the registry is **held in public** so anyone can audit it independently. Its ultimate home is **Inkwave³** — a still-to-build *provenance-lite public layer* where a read-only, publicly-viewable, provenance-attested version of a document (or, here, the key registry) lives. Until Inkwave³ exists, it sits on a provenance-aware public page of the Inkwave site. The principle: the registry that underpins all email verification is itself publicly verifiable, not something users must take on trust.
- **Why the archive stays small — DKIM keys are per-domain, not per-user.** A provider signs *all* its users' mail with the domain's key(s): `gmail.com` signs every Gmail user's mail with `gmail.com`'s selector key(s). So the registry is keyed by **(domain, selector)** across rotation history, *not* by user — a handful of keys per major provider, growing only with distinct *sending domains* (custom-domain / Workspace senders each bring their own key) and rotations, never with user count. That is what makes a public, provenance-tracked archive tractable.
- This is a legitimate, known pattern (public DKIM key archives exist) and gives Inkwave a defensible network asset: a growing, timestamped, publicly-auditable registry of provider signing keys underpinning long-term verifiability. It is one of the few places Inkwave holds anything server-side — but it holds **public keys only** (never user content), so it doesn't compromise zero-retention of user data, and being public + provenance-tracked it's auditable rather than a trusted black box.

#### B4.3 The capture flow (per sent email)

1. Send via provider API (B3).
2. Fetch the *sent* message (Gmail `messages.get`, Graph equivalent) including the `DKIM-Signature` header and full raw MIME.
3. Resolve the DKIM public key from the domain's DNS (`selector._domainkey.domain`); archive it in the trust base with an observation timestamp.
4. Assemble a **verification bundle:** `{ raw_message, dkim_signature, dkim_public_key, provider, observed_at }`.
5. Hash the bundle; anchor via the existing OTS spine.
6. Store the bundle reference in the document's provenance record and in the ledger row.

#### B4.4 The verify page (`inkwave/verify`)

Given a bundle (or a shared `email + hash + proof` package), the verifier checks, independently and trustlessly:

1. **OTS:** the bundle hash is anchored in Bitcoin at/before time T (existence + durable time).
2. **DKIM:** the signature validates against the archived public key (origin: the provider signed it; integrity: content unaltered).
3. **Consistency:** the presented email matches the bundle hash.

Result: a permanent, portable, self-service proof that *the provider cryptographically vouched this exact content as sent at the stated time* — verifiable by anyone, forever, without access to the user's inbox and without trusting Inkwave. This is strictly stronger than "open your Gmail and show them," and it survives DKIM key rotation via the archive.

**Honesty boundary (Phase 3):** even here, the claim is "signed/transmitted by the provider," not "delivered to / read by the recipient." Don't overclaim delivery.

#### B4.5 In-product copy migration when sent-message proof ships

The current email disclosure deliberately says that the Bitcoin record proves only that the draft
existed by a given time and does not prove sending. **Update that disclosure when—and only when—the
individual message has a successfully verified Phase-3 sent-message bundle.** This is an explicit
product task in the DKIM/Gmail timestamp integration, not optional copy polish.

- After Gmail accepts the send, fetch the immutable Gmail message ID, `internalDate`, and full raw
  sent MIME; preserve the provider response and the exact bytes returned by `messages.get`.
- Validate the DKIM signature over the body and every header actually named by its `h=` list, archive
  the corresponding public key, then hash and OTS-anchor a versioned sent-message bundle containing
  those facts. Record which fields are DKIM-covered rather than assuming that every header is signed.
- Gmail's `internalDate` is provider metadata and useful evidence of provider acceptance time, but it
  is not by itself a publicly verifiable signed timestamp. Bitcoin independently proves that the
  complete evidence bundle existed **no later than** its anchor time. A future provider-signed receipt
  may tighten the time claim further.
- Once both DKIM verification and the Bitcoin anchor succeed, replace the current draft-only wording
  for that message with copy equivalent to: **“The provider's signature verifies the captured body
  and signed headers as the message it transmitted; the Bitcoin timestamp makes this evidence
  permanently independently verifiable.”** Show the Gmail acceptance timestamp and Bitcoin anchor
  time separately; never collapse them into one supposedly exact time.
- If sent-copy fetch, DKIM validation, key archival, or OTS anchoring fails or remains pending, retain
  the present draft-provenance wording. A successful API send alone must never unlock the stronger
  claim.
- Even the upgraded copy must not claim recipient delivery, inbox placement, opening/reading, or an
  envelope recipient such as Bcc unless separate verifiable evidence covers that fact.

### B5. Privacy and permissions (email)

- **Minimal scope:** send-only (`gmail.send` / Graph `Mail.Send`); never request inbox-read for the send/provenance features.
- **Zero-retention of user content:** the email body is a normal encrypted Inkwave document; the trust base stores only **public keys**, never user content.
- **"Encrypted," precisely:** email composed and stored in Inkwave is encrypted *at rest on the user's device*. This is **not** end-to-end-encrypted email (that requires the recipient to use PGP/S-MIME). State the true claim ("stored encrypted on your device; we never hold it"), never imply E2E email.
- **AI + email:** if an email's content is ever included in a productivity report, it flows through the same content tick-box/consent path as any document.

### B6. Phase-1 (MVP) acceptance criteria (email)

- Compose an email as an Inkwave document (`doc_type: email`) with header fields + body.
- Email composition produces session rows in the ledger, so it appears in the productivity report.
- On finalise, the email content is hashed and OTS-anchored (existing spine) → draft-provenance verifiable at `inkwave/verify`.
- "Open in provider" handoff pre-fills the provider compose window for sending.
- In-product copy accurately states what the MVP provenance proves (content existed by T) and does not claim proof of sending.

### B7. Connected-mailbox acceptance criteria

- Send only remains usable with exactly `gmail.send`; mailbox controls clearly offer a separate
  connection and never imply existing read access.
- Connected mailbox requests exactly `gmail.readonly` + `gmail.compose` for Inbox/Sent/Drafts; no
  `gmail.modify` or full-mail scope appears in this phase.
- Inbox and Sent list real Gmail threads newest-first and fetch full content only on open.
- Drafts round-trip To/Cc/Bcc/Subject/body through Gmail's stable draft ID; a remote update cannot
  silently overwrite an independently changed local draft.
- Sending a synced draft records locally before `drafts.send`, then resolves the returned sent ID.
  An unknown response state is reconciled before retry so duplicate sends are not created.
- Browsing remote mail creates no Inkwave document, provenance snapshot, ledger row, or `.studio`
  membership until the writer explicitly saves/edits/replies.
- Message HTML is sanitised and isolated; remote images and attachments require explicit actions.
- Failed/expired Gmail reads never render as an empty mailbox and never delete cached or local work.
- Disconnect removes Gmail connection/cache state without deleting local Inkwave documents or Gmail
  content.
- No OAuth token, message body, attachment, recipient list, or mailbox index reaches an Inkwave
  server.

---

## PART C — CROSS-CUTTING ARCHITECTURE

### C1. Privacy posture (unifying principles)

1. **Local-first, zero-retention of user content:** all user documents, the ledger, and email bodies live in the user's own storage, encrypted at rest; Inkwave's servers never hold user content. The only server-side asset introduced is the Phase-3 **public-key** archive (not user data).
2. **User sends their own data to AI:** the default productivity path is export/paste-back (the user's own AI session); the seamless path is client-side BYO-key (device → provider). The Inkwave-pays tier is opt-in and disclosed as weakening the pure story.
3. **Data minimisation:** collect only what a live feature needs. No location, no keystroke content, no prose in the ledger. What you don't hold can't leak or be subpoenaed.
4. **Precise claims:** every privacy/authenticity statement must be exactly true. "Zero retention" = *we never store your content*, not "no data ever reaches an AI." "Encrypted" = at-rest on device, not E2E email. OTS = existence-by-time, not proof of sending. Overclaiming on a trust brand is existential.
5. **Verifiability over promises:** since a provider-controlled client is the residual trust, harden it by making it checkable — open/auditable client, reproducible builds, and (ideally) a native/installable app the user updates deliberately rather than silently-served web JS.

### C2. Encryption model

- **In transit:** TLS always.
- **At rest:** default on for documents, ledger, and emails.
- **Key custody:** default **recoverable** (a recovery mechanism so ordinary users don't lose months of work), with an **advanced opt-in true zero-knowledge** mode (client-derived key, no recovery) for maximalists. Be honest about which is active: if Inkwave holds any recovery key, do not claim "we cannot read it." Use vetted libraries (libsodium / WebCrypto AES-GCM); never roll your own crypto.
- **Encryption ≠ signing:** confidentiality (encryption) and authenticity (the provenance/DKIM/OTS spine) are complementary; "private *and* provably yours" is the combined pitch.

### C3. Honesty & wellbeing constraints (product-wide)

- Reports are **reflective, not judgmental**; no shaming, no output-only scoring presented as objective worth.
- **Measured vs judged** always visually separated; AI judgments never masquerade as measurements.
- Pattern/causal claims only where the data supports them (weekly+), never from a single day.

### C4. Resolved decisions

1. **MVP email send path:** **Gmail API** (`gmail.send`) is the primary MVP path; the compose-URL **handoff** is the interim/fallback while Google verification is pending and for not-yet-integrated providers. (§B2.3, §B3)
2. **Encryption default:** **recoverable** by default, with an **opt-in true zero-knowledge** mode for maximalists. (§C2)
3. **AI access at launch:** ship **both** the free **paste-back** path and the **backend** path (login; a few free submissions/user/month → **Insignia** subscription). BYO-key is a later optional power-user path. (§A7.2, §C6)
4. **Trust base:** **self-hosted by Inkwave**, **append-only + provenance-attested with Inkwave's own architecture**, and **public / auditable**; ultimate home is **Inkwave³** (provenance-lite public layer, still to build). (§B4.2)
5. **First provider adapter:** **Gmail**, then generic SMTP / Graph as demand appears; Proton via Bridge. (§B3)
6. **Mailbox access is optional and step-up:** retain send-only as the minimal default; Inbox/Sent use
   `gmail.readonly`, draft sync uses `gmail.compose`, and `gmail.modify` waits for real mutation UX.

**Remaining to build / decide later:** **Inkwave³** (the provenance-lite public read-only layer); the exact free-quota number for the backend path; **Insignia** price point; the security-assessment scope for Gmail's restricted scope.

### C5. Suggested build order

1. **P1a:** Pomodoro + session capture + per-month ledger + client-side measured graphs (no AI). Ships value immediately, zero AI cost/risk.
2. **P1b:** Email as `doc_type: email` document → counts in ledger; OTS draft-provenance; **Gmail** send (handoff first while verification pending, Gmail API as target).
3. **P1c:** AI report — the free **paste-back** path (markdown + judged CSV, transparent prompt, content tick-box) **and** the **backend** path (login, free quota → Insignia).
4. **P2a:** Gmail-API send fully verified; optional **BYO-key** client-side path.
5. **P2b-mail-1:** Gmail connection tiers + browser-only mailbox client; metadata/index and failure states.
6. **P2b-mail-2:** Inbox + Sent thread UX; on-demand safe MIME rendering; remote images off by default.
7. **P2b-mail-3:** Gmail draft create/update/send, local-first mapping, conflict preservation, and unknown-send reconciliation.
8. **P2b-mail-4:** Only if the corresponding UX exists, add `gmail.modify` for mark-read/archive/star/labels.
9. **P2c:** Additional provider adapters (generic SMTP, Graph); Proton via Bridge.
10. **P3:** DKIM capture + public, provenance-attested **trust base** + combined `inkwave/verify`; begin migrating the registry toward **Inkwave³**.

### C6. Monetisation & tiers (Insignia)

- **Free, always:** the full productivity layer, client-side graphs, OTS provenance, and the **manual paste-back** AI path (the user brings their own AI). Nothing about the privacy-pure core is paywalled.
- **Insignia (subscription):** unlocks the **backend AI path** beyond the monthly free allowance (a few free submissions/user/month, then Insignia), and over time the seamless provider-API email sending, richer reporting, and the Phase-3 verification features. "Insignia" (a mark / seal) fits the provenance/authenticity brand.
- **Principle:** paywall *convenience and scale*, not *privacy or ownership*. The free tier must stay genuinely useful and fully private; Insignia is for people who want Inkwave to do the work for them (backend AI, direct sending), not a gate on the core value.
- **Open:** exact free-quota number and Insignia price point are TBD (§C4 remaining).

---

## PART D — SUBDOCUMENT WORKSPACES & MULTI-CONTAINER SYNC

### D1. Product intent and terminology

The workspace replaces the assumption that one browser view contains exactly one long piece of
writing. A writer may keep several related units beside one another — an essay page, a note, a draft
email, a reply, or another page — and move through them as a spatial sequence. This is not a second
document system: every unit remains an ordinary Inkwave document and retains the same editing,
ledger, provenance, and local-save behaviour it has today.

- **Subdocument (subdoc):** one independently editable unit in a workspace. A subdoc has a stable
  `subdoc_id`, a `doc_type` (including `email`, `note`, or `essay`), its own content and optional
  type-specific fields. “Subdoc” describes placement; it does not mean the content has weaker
  identity or provenance.
- **Workspace:** an ordered presentation of subdocs. It owns order, the active item, and workspace
  display metadata; it does not own the meaning of the subdoc's prose.
- **`.studio` container:** the portable and syncable file that carries a workspace manifest plus one
  or more subdoc bundles. A one-subdoc `.studio` is simply the smallest workspace container.
- **Membership:** the explicit statement that a subdoc is carried by a particular container. A
  subdoc may have one or many memberships. For example, a project email may belong to both
  “September email” and “Project Kookaburra”.
- **Sync target:** a writer-authorised destination for one container (local folder, OneDrive,
  Google Drive, or another existing adapter). Provider credentials and file handles never travel
  inside the `.studio` file.

The distinction between membership and copying is load-bearing: adding one subdoc to two containers
does not create two unrelated drafts. Both memberships name the same stable `subdoc_id`, and editing
it schedules both containers to receive the new revision.

### D2. Isolated email surface

Email has two deliberate presentations over the same underlying email subdocs. The presentation is
not inferred from message count, title, recipient, or content; the writer can switch it explicitly.

#### D2.1 Isolated email — the default

An email must no longer look like a small panel placed on top of an unrelated paper page. New email
work opens in **isolated mode** by default: when the active subdoc has `doc_type: email`, the email
itself is the writing surface.

- On desktop the isolated email is centred at 75% of the resolved ordinary-page width; on phone it
  remains full-width. It grows to its content height and must not manufacture an empty page-height
  tail after a short message. Its header, body,
  record/send controls, status, and concise provenance disclosure form one continuous box.
- The isolated box is resizable. Dragging either side changes both sides by the same amount around a
  fixed horizontal centre, so the box never walks left or right as its width changes. Width is
  clamped to the available editor window. A bottom-centre handle sets an optional minimum height;
  without that explicit resize, the box continues to end after its content. Double-click/Enter/Home
  resets the relevant axis, arrow keys provide a non-pointer equivalent, and the local preference is
  restored without changing document content or provenance. Phone keeps full width and exposes only
  the vertical resize.
- The editable body begins immediately beneath the email header/actions inside that box. There is no
  second paper surface visibly continuing behind or beneath it.
- To, Cc, Bcc, Subject, body, send state, and recorded-at state remain part of the active email
  subdoc's document state; layout does not create a parallel email store.
- Long emails continue vertically within their email surface using the existing page/scroll rules.
  The workspace's horizontal navigation must never steal an ordinary vertical reading gesture.
- The long-form provenance explanation is available from an inline disclosure/help control. The
  surface always retains a short, visible statement of the honesty boundary: recording proves the
  draft existed by the shown time; it does not prove delivery or reading.
- The isolated layout must work before Gmail is configured. Record and provider-handoff remain
  available; direct Gmail send appears only when configured.

Isolated mode is the shortest path from writing to sending. It is also the shared default pattern
for focused Inkwave tools: the active thing occupies the page, while a richer contextual workspace
remains available when the writer needs to think around several related things.

#### D2.2 Contextual email studio — journal, compare, annotate, batch

The current paper-style composition remains as an explicit **contextual studio mode** rather than a
legacy layout. Its purpose is different from an ordinary mail client: the writer can place one or
more complete email boxes inside a larger writing page and keep thinking material around them.

- Every email box contains its own To/Cc/Bcc/Subject, message body, record/send controls, and status.
  The body is always visibly inside the box; the ambiguity where the body looked like unrelated
  prose beneath the header panel is forbidden in both live and snapshot views.
- Prose, headings, journal entries, planning notes, and annotations may appear before, between, or
  after message boxes. That contextual material is never included in outgoing email bytes unless
  the writer explicitly moves/copies it into a message body.
- Review comments may appear inline over a message body, but comment text, reviewer identity,
  selection metadata, and studio annotations never leave with the email. Unresolved tracked
  suggestions block record/send until the writer accepts or discards them; Inkwave never silently
  chooses which version becomes the outgoing body.
- A contextual page may hold several related emails: variants for different recipients, a sequence
  of follow-ups, or a monthly/project correspondence journal. “Duplicate as new email” creates a new
  stable email identity prefilled from the source; the copies diverge independently thereafter.
- Each email box is backed by its own email subdoc and stable `subdoc_id`. Contextual studio mode is
  a workspace presentation of those subdocs, not an `emails[]` field or a second mail/provenance
  store. Switching a message between isolated and contextual presentation neither copies it nor
  changes its hash, history, memberships, or send state.
- The surrounding journal/page content has its own document identity. Saving or snapshotting that
  context may prove the journal existed, but it does not claim that any embedded message was sent.
- Only the actively edited message mounts a live message editor/signing session. Other boxes use
  faithful static previews until selected, preserving the one-live-editor/write-owner rule.

This isolated/contextual pair is the reusable Inkwave application pattern: focused tools default to
their own centred, content-height surface, while studio mode composes several tool objects with
ordinary writing. Future music and other Inkwave tools should reuse the pattern rather than inventing
separate shells.

#### D2.3 Batch send contract

Contextual studio mode may send several messages in one deliberate operation. “Send all” means one
reviewed batch action with per-message results; it never means an invisible loop over everything in
the container.

1. The writer selects messages (or explicitly chooses all unsent messages). The confirmation lists
   every recipient set and subject, calls out Bcc, and excludes already-sent items by default.
2. Inkwave validates every selected message and creates its local frozen snapshot **before any**
   message is transmitted. If any selected item cannot be read or recorded, the batch does not begin;
   nothing is treated as empty and nothing is sent partially during preflight.
3. One provider authorisation may serve the batch, but each email is submitted as its own provider
   message. Sending is paced/queued rather than burst concurrently so provider rate limits and
   message-specific failures remain intelligible.
4. Once transmission begins, results are per email: `sent`, `failed before acceptance`, or
   `status unknown`. A later failure cannot roll back an earlier accepted message, and the UI must
   never collapse a mixed batch into a single green “sent” state.
5. `status unknown` is used whenever the provider may have accepted the bytes but the response was
   lost. Send-only mode tells the writer to check Sent before retrying; connected-mailbox mode
   reconciles the provider state first. Blind retry is forbidden because it can duplicate mail.
6. A sent message becomes read-only history in place. “Edit as new draft” creates a new subdoc ID;
   it does not rewrite the recorded/sent item. Failed, unsent items remain editable and locally safe.
7. Batch membership/order and surrounding annotations are not part of any individual email's sent
   bytes or OTS claim. Each email retains its own snapshot, outcome, and provider message ID when one
   is returned.

### D3. Spatial sequence and navigation

#### D3.1 Presentation model

- The active subdoc is centred at a readable page size. Its immediate previous and next neighbours
  may be visible at the sides as non-editable previews when space permits.
- Only the active subdoc owns a live Tiptap editor, signing session, autosave loop, and document
  write lock. Neighbours are inert previews. This preserves the one-live-editor/write-owner rule and
  prevents a zoomed-out workspace from mounting many expensive editors at once.
- Left and right arrow controls are always available when a neighbour exists. They have accessible
  labels containing the neighbour's type/title and are usable by keyboard and touch.
- Moving between subdocs saves/flushes the outgoing active subdoc before transferring edit ownership.
  A save failure blocks the switch and reports the failure; it is never interpreted as an empty
  subdoc.
- Navigation changes the active subdoc in the workspace. It must not mutate browser history and must
  not require a page reload.

#### D3.2 Trackpad, wheel, touch, and keyboard contract

- **Two-finger horizontal trackpad gesture:** while the pointer is inside the workspace, a deliberate
  horizontal gesture moves one item left/right and suppresses the browser's back/forward navigation.
  Interception is armed only inside the workspace and only after horizontal intent wins over vertical
  intent by a tested threshold. Vertical scrolling remains native.
- The gesture is latched: one physical swipe advances at most one subdoc until the gesture settles.
  Small diagonal movements do nothing; they must neither switch documents nor block vertical scroll.
- At the first/last subdoc, a deliberate horizontal workspace gesture is consumed and gives a gentle
  edge response rather than escaping into browser history.
- **Shift + wheel/trackpad scroll:** maps the dominant scroll delta to previous/next subdoc, using the
  same intent threshold, latch, and edge behaviour.
- **Touch:** a two-finger horizontal swipe performs workspace navigation. A one-finger gesture keeps
  its existing caret, selection, and vertical-scroll behaviour. The two-finger rule prevents normal
  text selection from becoming document navigation.
- **Buttons and keyboard:** the visible arrows are the baseline access path. When focus is not inside
  an editable field, Left/Right Arrow may navigate; inside an editor or header field, text-editing
  keys always win. A later settings surface may offer additional remappable shortcuts.
- Browser back/forward is suppressed only for a gesture that the workspace has positively claimed.
  Global interception outside the workspace is forbidden.

#### D3.3 Overview (“manage all”) mode

- Default shortcut: **Command/Ctrl + Shift + Space**. A visible toolbar control provides the same
  action, so the feature is not discoverable only by hotkey. Escape returns to the active subdoc.
- Overview zooms out to show lightweight thumbnails for the ordered subdocs. Thumbnails are static
  previews; no hidden editors or signing sessions are mounted.
- The writer can select, open, reorder, rename, create, remove-from-workspace, and manage membership
  from overview. Destructive operations remain explicit and confirm-gated.
- Overview distinguishes type (email/page/etc.), unsaved/unsynced state, and membership destinations
  without exposing recipient addresses or body snippets by default. An email thumbnail may show its
  subject; addresses require deliberate expansion.
- Reordering changes only workspace presentation metadata. It does not alter a subdoc's content hash,
  receipt chain, timestamps, or intrinsic identity.
- The active item remains stable across entering/exiting overview, reload, and sync round-trip.

### D4. Creation and membership choices

Creating a subdoc is a two-part decision: what to create, and where it should live.

1. Choose type: page/note, essay, email, or another supported `doc_type`.
2. Choose placement:
   - **Add to this `.studio`:** include it in the current container and sequence.
   - **Create a separate `.studio`:** create a new one-subdoc container. The current workspace may
     optionally retain a linked placement pointing to that same subdoc.
   - **Add to existing `.studio` document(s):** choose one or more existing containers. This is the
     path for a project email that also belongs in a monthly email container.

The choice must be changeable later. Membership management supports adding a container, removing a
container, and making a new standalone container without changing `subdoc_id`. “Remove from this
workspace” is not “delete the subdoc everywhere”. Permanent deletion is a separate action that lists
all affected memberships and requires confirmation.

If a new subdoc is added to multiple containers, the UI shows each destination before creation. It
must never silently add a second sync destination based on title, type, recipient, project name, or
other inferred intent.

### D5. Data and archive model

#### D5.1 Stable identities

```ts
type SubdocId = string
type StudioContainerId = string

interface WorkspaceItem {
  subdoc_id: SubdocId
  position: string          // stable fractional/order key; display order, never content identity
  added_at: string
}

interface StudioWorkspaceManifest {
  v: 1
  container_id: StudioContainerId
  title: string
  items: WorkspaceItem[]
  active_subdoc_id?: SubdocId
  updated_at: string        // display/sync hint only; never conflict authority
}

interface SubdocMembership {
  container_id: StudioContainerId
  subdoc_id: SubdocId
  role: 'embedded' | 'linked'
  added_at: string
}
```

- `subdoc_id` identifies the authored unit everywhere. It is not derived from title, container,
  position, or content hash.
- `container_id` identifies the portable `.studio` container and survives rename/move/provider sync.
- `position` is container-specific. The same subdoc may appear at different positions in different
  containers without becoming different content.
- `active_subdoc_id` is a convenience for reopening a workspace. It is not provenance and must not
  override an explicit open request.
- Membership is many-to-many. The local membership index is derived from successfully read manifests;
  an unreadable manifest is an error, never an empty membership list.

#### D5.2 `.studio` container format

- The workspace archive is the new `.studio` baseline. Its `subdocs` map embeds each subdoc as an
  independently verifiable document bundle rather than inventing a second provenance format.
- Pre-launch `.studio` files may continue to open where the new reader accepts their shape naturally,
  but backward compatibility is best-effort only: do not add legacy-specific migrations, branching
  save paths, format shims, or acceptance requirements. If an old file cannot be read safely, report
  that explicitly and leave it untouched.
- A linked item may reference a separately carried subdoc, but portable export must offer an explicit
  **self-contained** mode that embeds linked items so the recipient does not receive a broken
  workspace.
- The manifest contains no OAuth tokens, provider account identifiers, filesystem handles, or local
  absolute paths.

Conceptual outer shape (names are normative; byte encoding remains an implementation decision):

```ts
interface StudioWorkspaceArchiveV2 {
  v: 2
  manifest: StudioWorkspaceManifest
  subdocs: Record<SubdocId, ExportBundleV1>
  exported_at: string
}
```

#### D5.3 Local canonical state

- Each subdoc has one canonical local working copy, regardless of the number of container memberships.
  Containers are export/sync projections of that canonical state, not competing autosave stores.
- Workspace manifests are stored independently from subdoc bodies so reordering does not rewrite the
  live editor content or create a provenance snapshot.
- A subdoc edit first commits locally. Only after that succeeds are all affected containers queued.
  The UI may report partial sync success, but must never report the edit as lost because one projection
  failed.
- Assets remain referenced/deduplicated under the existing asset rules. A container projection includes
  the assets required by its embedded subdocs according to the existing explicit-export versus sync
  policy; membership must not duplicate large media into local working state.

### D6. Multi-container sync semantics

- Editing a subdoc schedules every **embedded** membership for sync. A linked placement schedules the
  subdoc's owning container, not an unauthorised rewrite of the linking container's content payload.
- Containers sync independently and expose per-target state: `local`, `queued`, `syncing`, `synced`,
  `failed`, or `conflict`. “Synced” is never a single boolean when multiple destinations exist.
- A failure in one target does not cancel or roll back successful writes to other targets. The failed
  target remains queued/retryable with its last confirmed revision visible.
- Before overwriting a container, the adapter re-reads the remote archive and merges grow-only
  provenance history. A failed remote read aborts that target's write. It is never treated as an empty
  archive.
- Same-subdoc reconciliation uses ancestry/content hashes and the existing conflict classifier, never
  `updated_at`. If one revision contains the other's ancestry, the descendant wins and histories
  union. If neither contains the other, the result is `diverged`: preserve both by forking one to a
  new `subdoc_id`, place both visibly in overview, and overwrite nothing until the writer resolves it.
- Workspace-order conflicts are separate from content conflicts. Merge non-overlapping membership
  additions/removals; if both sides reorder the same items incompatibly, preserve both orders as a
  visible conflict instead of choosing by timestamp.
- Sync fan-out is coalesced by `(container_id, subdoc_id, revision_hash)` so one keystroke does not
  produce N immediate cloud writes. Closing/navigating flushes the latest queued revision.
- Removing a membership updates only that container after local confirmation. It cannot delete the
  canonical subdoc or remove it from other containers.
- No adapter may broaden scope automatically. Every new container/target association requires an
  explicit writer action.

### D7. Provenance, email, and productivity boundaries

- Content provenance remains per subdoc. Each subdoc keeps its own snapshots, receipt chain, OTS
  state, and type-specific hashes. Placing it in another container does not create authorship evidence
  and does not reset its chain.
- Workspace order, active item, thumbnail appearance, and membership are organisational metadata and
  are not included in the existing content/bundle hash. The UI must not imply that OTS proves project
  membership or workspace ordering.
- A later manifest-provenance version may anchor container composition, but it must be a new explicit
  hash/version and must not change verification of existing subdoc snapshots.
- Sending an email records the active email subdoc's exact headers/body. Other subdocs in the same
  container are not included in the email snapshot or sent to Gmail.
- Contextual studio annotations and journal prose are excluded from each message by structure, not
  by a best-effort text filter. Batch sending still records and transmits each selected email subdoc
  independently; there is no batch-wide email body or provenance claim.
- The productivity ledger records activity against the active `subdoc_id`, `doc_type`, and label. A
  subdoc with two memberships generates one writing session, not one row per container. Container IDs
  may be attached as local report dimensions, but must not duplicate time or word counts.
- Overview/reordering time is workspace management, not writing. It may count as generic app activity
  only if a later product feature explicitly needs it.

### D8. Privacy, accessibility, and performance

- Multi-container membership can reveal project relationships. Membership metadata remains writer-held
  and is included only in containers the writer explicitly chose.
- Overview hides email recipients and body snippets by default, including from screen-capture-friendly
  thumbnails. The writer may opt to reveal them.
- Navigation and overview are fully operable without gestures. Buttons have ≥44px touch targets,
  visible focus, and meaningful accessible names; reduced-motion mode replaces slide/edge motion with
  an immediate state change.
- Horizontal transitions never animate a live editor at full document cost. The active editor and at
  most two cached static previews are rendered; large workspaces virtualise all remaining thumbnails.
- A workspace with hundreds of items must not load every subdoc body or snapshot archive on open.
  The manifest and lightweight metadata index load first; content loads on activation/preview demand.
- Gesture listeners are non-passive only while interception could occur and are detached outside the
  workspace, following the same performance discipline as the existing zoom wheel handling.

### D9. Failure states and destructive-action rules

- Failed subdoc read ⇒ show storage unavailable for that item; do not mint a blank replacement.
- Failed manifest read ⇒ do not present an empty workspace or save over the container.
- Missing linked subdoc ⇒ show a recoverable missing-item card and offer locate/remove-link actions;
  do not silently delete the manifest entry.
- Failed outgoing flush ⇒ remain on the current subdoc and preserve the attempted destination.
- Partial multi-sync ⇒ show which containers succeeded and which need attention.
- Diverged subdoc ⇒ preserve both revisions under distinct IDs and require a writer resolution.
- Delete-everywhere ⇒ list all memberships, snapshots, and sync targets affected; require an explicit
  confirmation. Default removal is from the current workspace only.
- No background cleanup may delete orphan-looking subdocs, manifests, or provenance. “Unreferenced”
  can result from an unreadable container and is not proof of abandonment.

### D10. Phased build order

**Implementation status (2026-09-04):** W1 is implemented on `feat/gmail-send`: live email drafts
and historical email snapshots use the same reusable application-surface primitive, the message body
lives inside the box, application presentation suppresses visual page gaps without forking the editor,
and the detailed sending/provenance explanation is collapsed behind a concise visible statement.
W2–W7 remain specification only.

1. **W1 — Isolated surface:** make the default email one centred box, 75% of page width on desktop
   and full-width on phone, that ends after its content;
   consolidate header, editor body, actions, status, and concise disclosures. No archive change.
2. **W2 — Contextual studio:** retain the writing page as an explicit alternate presentation; place
   complete email subdocs with their bodies inside boxes, distinguish never-sent journal material,
   support duplicate-as-new, and add selection/preflight/per-item batch outcomes.
3. **W3 — Local sequence:** introduce workspace manifest/index, active-subdoc switching, arrow controls,
   two-finger/Shift-scroll navigation, outgoing flush, and static neighbour previews.
4. **W4 — Overview:** add the manage-all shortcut/button, virtualised thumbnails, activation, reorder,
   creation, and remove-from-workspace. Still one container per subdoc by default.
5. **W5 — Workspace container:** add multi-subdoc `.studio` import/export with independently
   verifiable subdoc bundles, membership management, and self-contained export.
6. **W6 — Sync fan-out:** add explicit many-to-many memberships, per-container queues/status, safe remote
   re-read/merge, partial-failure recovery, and divergent-revision forking.
7. **W7 — Certification:** full regression/mutation tests, real-browser gesture probes on macOS trackpad
   and touch hardware, large-workspace performance certification, and multi-provider sync fault injection.

W1–W4 can ship behind a feature flag before the archive/sync expansion. W5 must not become the default
writer until round-trip export and failure-on-read guards pass. W6 must not ship until
multi-target fault injection proves that one unreadable destination cannot damage another.

### D11. Acceptance criteria

#### Surface and navigation

- An email renders as one centred box at 75% of page width on desktop (full-width on phone) that grows
  with its content, with its body inside it, no forced blank page-height tail, and no second paper
  visibly behind it.
- Pulling either side expands/contracts the opposite side equally and preserves the box's horizontal
  centre. Bottom resizing changes only its optional minimum height. Keyboard and reset paths work,
  and no resize operation changes the email's authored bytes or provenance.
- New email work defaults to isolated mode; switching to contextual studio mode preserves the same
  email identity, bytes, history, memberships, and send state.
- Contextual studio mode keeps every message body inside its email box and allows clearly separate
  journal/annotation prose around one or more boxes. That surrounding material never enters sent bytes.
- Duplicating a message creates a new stable email identity; editing one variant cannot mutate another.
- A batch confirmation names every recipient set and subject. All items record locally before the
  first send, and mixed `sent`/`failed`/`status unknown` outcomes remain visible per message.
- Unknown send status cannot be blindly retried; sent items cannot be edited in place.
- Page and email subdocs can coexist in one ordered workspace and retain their distinct `doc_type`.
- Arrow buttons, two-finger horizontal gesture, Shift+scroll, and overview activation reach the same
  deterministic next/previous item.
- Vertical scroll, editor selection, pinch zoom, and ordinary browser navigation outside the workspace
  remain unaffected.
- Only the active subdoc owns a live editor, signing session, autosave loop, and write lock.
- Command/Ctrl+Shift+Space opens overview; Escape returns to the same active subdoc.

#### Persistence and portability

- Sequence, active item, titles/types, and stable IDs survive reload.
- A multi-subdoc `.studio` round-trips page and email subdocs, snapshots, receipts, citations, required
  assets, and workspace order.
- A self-contained export opens on another device with no missing linked item.

#### Membership and sync

- Creation offers current, new standalone, and one-or-many existing container destinations.
- One email can belong to a monthly-email container and a project container while retaining one
  `subdoc_id` and one writing/provenance history.
- Editing that email queues both authorised embedded containers and reports their status separately.
- One target failing leaves the local edit and other successful target intact and visibly retryable.
- An unreadable remote container causes no overwrite; divergent revisions are both preserved.
- Removing from one workspace leaves other memberships and the canonical subdoc intact.

#### Honesty and privacy

- OTS claims only the active subdoc content/version, never workspace membership or order.
- Productivity totals count one active writing session once even when the subdoc has many memberships.
- Overview hides email recipients/body previews by default.
- No archive contains credentials, OAuth tokens, file handles, or local absolute paths.

---

*End of spec v0.5. Working design artifact for Inkwave; §B3.1–B3.5 define the optional connected Gmail mailbox and Part D defines isolated/contextual application surfaces, safe multi-message composition, and the subdocument workspace extension.*
