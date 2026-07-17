# Inkwave — Productivity & Email Layers: Build Specification

**Version:** 0.2 (MVP-focused working draft — key decisions resolved, see §C4)
**Date:** July 2026
**Status:** Design spec for two new layers — (A) Productivity Tracking & Reporting, (B) Email-in-Workflow — built on Inkwave's existing local-first, zero-retention, provenance architecture. The open decisions from v0.1 §C4 are now resolved: Gmail-first sending; recoverable encryption with a zero-knowledge opt-in; two AI paths (free paste-back + backend freemium → **Insignia**); and a self-hosted, publicly-auditable, provenance-tracked DKIM trust base (ultimately on **Inkwave³**).

---

## 0. Framing and phasing

Inkwave today is a rich-text writing tool with a provenance spine (client-side edit history, hashing, and OpenTimestamps/Bitcoin anchoring), storing everything in the user's own documents (zero cloud retention). These two new layers extend that identity in two directions:

- **Productivity layer** turns the provenance/session telemetry Inkwave *already collects* into a daily/weekly/monthly reflection on how the user worked — a Pomodoro rhythm, a work tracker, and an AI-written report. This converts Inkwave from an occasional-use "authorship insurance" tool into a daily companion.
- **Email layer** brings email *composition* into Inkwave so that (i) email writing counts toward the productivity stats, and (ii) emails inherit Inkwave's provenance. The actual sending happens through the user's existing provider (Gmail/Outlook/etc.), so Inkwave never becomes an email host.

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

**Remaining to build / decide later:** **Inkwave³** (the provenance-lite public read-only layer); the exact free-quota number for the backend path; **Insignia** price point; the security-assessment scope for Gmail's restricted scope.

### C5. Suggested build order

1. **P1a:** Pomodoro + session capture + per-month ledger + client-side measured graphs (no AI). Ships value immediately, zero AI cost/risk.
2. **P1b:** Email as `doc_type: email` document → counts in ledger; OTS draft-provenance; **Gmail** send (handoff first while verification pending, Gmail API as target).
3. **P1c:** AI report — the free **paste-back** path (markdown + judged CSV, transparent prompt, content tick-box) **and** the **backend** path (login, free quota → Insignia).
4. **P2a:** Gmail-API send fully verified; optional **BYO-key** client-side path.
5. **P2b:** Additional provider adapters (generic SMTP, Graph); Proton via Bridge.
6. **P3:** DKIM capture + public, provenance-attested **trust base** + combined `inkwave/verify`; begin migrating the registry toward **Inkwave³**.

### C6. Monetisation & tiers (Insignia)

- **Free, always:** the full productivity layer, client-side graphs, OTS provenance, and the **manual paste-back** AI path (the user brings their own AI). Nothing about the privacy-pure core is paywalled.
- **Insignia (subscription):** unlocks the **backend AI path** beyond the monthly free allowance (a few free submissions/user/month, then Insignia), and over time the seamless provider-API email sending, richer reporting, and the Phase-3 verification features. "Insignia" (a mark / seal) fits the provenance/authenticity brand.
- **Principle:** paywall *convenience and scale*, not *privacy or ownership*. The free tier must stay genuinely useful and fully private; Insignia is for people who want Inkwave to do the work for them (backend AI, direct sending), not a gate on the core value.
- **Open:** exact free-quota number and Insignia price point are TBD (§C4 remaining).

---

*End of spec v0.2. Working design artifact for Inkwave; §C4 decisions resolved, remaining items flagged inline.*
