# Inkwave Music Module — Build Specification (Light)

**Version:** 0.1
**Date:** July 2026
**Scope:** A thin, differentiated music layer on the shared Inkwave engine, aimed at the **studious music student**. Two ways a "piece" enters the app — a **photo path** (your own score, no OMR) and a **MusicXML path** (clean import from notation software, no OMR) — wrapped in the parts that are genuinely under-served: lesson capture, teacher-feedback pinned to bars, organise-by-piece, practice tools, and provenance.

---

## 0. Framing and deliberate non-goals

**What this is.** The score-reader / annotate / synced-playback category is *crowded* (PlayScore, Newzik, Sheet Music Scanner, Soundslice, MobileSheets). We are **not** rebuilding a score reader. We build the thin wrapper those tools don't do well — capturing the *lesson*, pinning the teacher's words to bars, organising practice, and provenance — and we get the commodity pieces (playback, notation rendering, transcription) from **free, self-serve building blocks** so there is no licence to negotiate and near-zero third-party cost.

**Free / self-serve building blocks (no licence negotiation):**
- **Reference playback:** YouTube IFrame Player API (embed + `seekTo` + `setPlaybackRate` slow-down) and/or user-uploaded audio files. *Not Spotify* (Premium-only, no slow-down).
- **MusicXML rendering:** OpenSheetMusicDisplay (OSMD, MIT) or Verovio (LGPL) — both free, render MusicXML → SVG in the browser, with a cursor API.
- **On-device speech-to-text:** Apple Speech framework (`requiresOnDeviceRecognition`) or whisper.cpp (small/base) — runs on an iPhone 12, audio never leaves the device (zero-retention by architecture).
- **MIDI playback for MusicXML:** a soundfont synth (e.g., a Web Audio soundfont player / Tone.js) driven from the parsed notes.

**Reused from the existing Inkwave engine:** rich notes, markup/annotation, the Pomodoro timer (→ practice timer), provenance/OTS spine, encryption at rest, zero-retention storage.

**Non-goals:** OMR (optical music recognition) of any kind; a from-scratch notation engine; a general-purpose sheet-music library/reader competing with forScore et al. Crucially, the score is **markup-only, not editable** — imported MusicXML and photographed scores can be annotated, played, cited, and synced, but the underlying notation is **read-only**. Inkwave is **not a notation editor** and does not compete with Sibelius/MuseScore/Dorico; it consumes their output and adds a study/practice/provenance layer on top.

**Product placement.** Build as a **module on the shared Inkwave engine**, not a forked codebase. Whether it eventually graduates to its own app/brand is a later go-to-market decision; for now it is a probe validating whether the studious-music-student wrapper pulls users.

**Target platform — iPad-first.** The module (as "Inkwave Zero music") is designed **around the iPad** first, with iPhone as a companion. Score markup, the heatmap, sticky notes, and leader-lines are built for **Apple Pencil** on the iPad's larger canvas; the phone handles capture (photograph a score), quick practice, and on-the-go review. On-device STT (iPhone-12-class and up) and OSMD/soundfont rendering run comfortably on any modern iPad. Every interaction is designed touch- and Pencil-first; desktop is a later concern, if ever.

---

## 1. Shared data model — the "Piece"

A **Piece** is the central object both paths produce. The whole thing — score images and/or MusicXML, annotations, distilled notes, recordings, heatmap, practice schedule, provenance — is bundled in a single **`.studio` file** (the Inkwave document container), stored in the user's own storage and encrypted at rest.

```
Piece  (.studio file) {
  id, title, composer, key, time_signature (optional),
  source: { type: "photo" | "musicxml", ... },
  pages: [ { image_ref | rendered_ref, systems: [...], bars: [ { bar, region } ] } ],
  reference_tracks: [ { kind: "youtube" | "file", ref, sync } ],
  annotations: [ Annotation ],            // freehand, text, highlight, leader, sticky
  heatmap: [ { bars: [start,end], colour, label, author: "student"|"teacher", ts } ],
  lesson_notes: [ LessonNote ],           // distilled + curated by the student only
  assignments: [ { kind: "youtube"|"note", ref, due: "next_week" } ],  // from the recap
  recordings: [ Recording ],              // bar-anchored
  practice: { tasks: [...], sessions: [...], schedule: WeeklySchedule },
  provenance: { hashes, ots_anchors }
}
```

- `Annotation { id, anchor, kind: freehand|text|highlight|leader|sticky, content }` — `anchor` locates it (page + region for photo; note/measure id for MusicXML).
- `Recording { id, start_bar, end_bar, audio_ref, flagged_sections, created_at }`.
- `LessonNote { id, snippet, anchor(optional → bar), created_at }` — note: the *raw* transcript is **never** stored here (see §A3); only the student's own distilled snippets.
- Everything lives in the `.studio` file in the user's own storage, encrypted at rest — the same zero-retention posture as every Inkwave document.

---

## PART A — Photo + Lesson Workflow (the light feature)

### A1. Score capture (photo)
- Camera capture or import of page images (JPG/PNG) and PDF pages; store encrypted.
- **Annotation-space reflow (distinctive feature).** Detect the whitespace gaps *between systems* (row-darkness / projection profile — easy CV, no note recognition), slice the image at those gaps, and insert blank space so the student has room to write. Keep grand staves (piano treble+bass) together; never split a system. Manual adjust handles for messy/skewed photos.

### A2. Markup / annotation
- Image-canvas markup: freehand, text, highlight regions, musical symbols from a small palette, and **sticky-note style** annotations (draggable notes pinned to a region/bar).
- **Smart leader-line routing (distinctive feature).** When the space above/below a stave is cramped, the student draws a curved connector so a dynamics/feedback note can sit where there's room and still point to the right place (above-midline → belongs to the stave below, etc.).
- **Practice heatmap (distinctive feature — user-curated, teacher-editable).** A dedicated **heatmap screen** where the student (or teacher) selects **ranges of bars** and assigns **custom colours** to build an at-a-glance map of what needs work. This is **manual annotation, not an AI judgement** — nothing opaque to defend. On iPad it's a natural **Apple Pencil** interaction (sweep across bars, pick a colour). CV may *optionally* pre-detect bar regions (barline/staff detection — the easy CV, no note recognition) to make selection easier, but the colours/heat are always the user's call. The heatmap is:
  - **Stored in the `.studio` provenance record** (hashed + OTS-anchored) — a timestamped record of how the student saw the piece over time.
  - **Teacher-readable and teacher-editable *mid-lesson*** — on the student's iPad the teacher can recolour bars live ("these four are your priority"), captured with the teacher as author and a timestamp. This makes the heatmap a shared lesson artifact, not a solo one.
  - Layered *in addition to* the sticky-note markup and the pinned feedback.
- Every annotation carries an `anchor` (page + x,y region, and — once barlines are marked, §A5 — the bar number) so it can be linked to lesson feedback, the heatmap, and recordings.

### A3. Lesson capture — the crown-jewel differentiator (transcript is *session-scoped and non-storable*)
- **Consent first.** Recording a teacher is socially — and often legally — sensitive. The teacher must know and agree. The reassurance that makes teachers comfortable is that the transcript **cannot be kept**: it exists only during the session and is deleted the moment the session ends.
- **Transcription:** **on-device** (Apple Speech / whisper.cpp small/base; iPhone-12-capable) — audio processed locally, never uploaded.
- **Session-scoped, non-storable transcript (owner decision).** The live transcript appears as a **source panel during the lesson** that the student distils from in real time — copying the useful lines into their own notes as the lesson happens. When the recording session ends, the **raw transcript and the audio are deleted automatically**; the student **cannot save, export, or otherwise keep** the verbatim transcript. The only thing that persists is the **student's own curated notes** (their selection/paraphrase). This is exactly what removes the teacher's self-consciousness: there is provably no keepable recording of them.
- **Pin feedback to bars.** Distilled snippets link to specific bars/regions ("bar 24 — watch the dynamics" → a `LessonNote` anchored to bar 24). The under-served differentiator.
- **Organise by piece.** Distilled notes attach to Pieces, so each piece accumulates its feedback history over time.

### A3b. End-of-session recap (teacher-driven)
- A lesson can end with a **recap the teacher controls**: the student hands over the phone and the teacher **dictates a short summary** (on-device STT). Unlike the raw transcript, this is something the teacher is *choosing* to leave — so it's comfortable, consensual, and *is* storable.
- A **"+" button** lets the teacher attach **YouTube links** or **written notes** as **"for next week"** items → these become the student's **assignments** (`assignments[]`), surfaced as practice to-dos and, where relevant, anchored to bars/pieces.
- The recap flips the dynamic from "being recorded" to "leaving a note for my student" — friendlier for the teacher and a cleaner consent posture. Storable summary (deliberately authored) vs. non-storable raw transcript (never kept) is the key distinction.

### A4. Reference track + tap-sync cursor
- **Reference source (free / self-serve):** paste a **YouTube** link (IFrame API: embed, `seekTo`, `setPlaybackRate` for slow-down) **or** upload an **audio file** (full control: waveform, loop, slow-down). No Spotify, no licensed embed.
- **Sync = two sets of anchors:**
  - *Spatial* — barline positions on the image + system layout. **MVP: the student marks barlines** by tapping their positions on the photo (robust on any image). *Later:* CV auto-detects barlines/systems (works best on clean scans; keep manual as fallback).
  - *Temporal* — the student **taps the beat** (counts 1-2-3-4) once while the track plays → beat timestamps. (This is the same proven pattern as Soundslice's "tap T per barline"; validated, standard.)
- **Cursor logic:** for each tapped beat time, place the vertical cursor at the interpolated x-position between the surrounding barline anchors, advancing at the tapped tempo and wrapping to the next system at line-ends. Bar-level interpolation is smooth enough — no note-level positions (that would need OMR) are required.
- **Playback controls:** play/pause, seek-to-bar (jump the track to a bar's timestamp), slow-down, and **loop-a-section** (define a loop between two bar anchors for repetitive practice).

```
Sync {
  barline_anchors: [ { page, system, x, bar } ],
  beat_map:        [ { time_sec, bar, beat } ]
}
```

### A5. Practice tools
- **Practice timer:** reuse the Inkwave Pomodoro layer; practice sessions write to the productivity ledger, so practice counts toward the student's overall work stats.
- **Weekly practice schedule (teacher-viewable).** The Pomodoro/practice sessions roll up into a **weekly practice schedule/log**, built off the same engine. The student can **share a read-only view with their teacher** (opt-in) so the teacher sees when and how much the student practised each piece across the week — closing the loop between lesson and practice. Sharing is entirely the student's choice; nothing is exposed without opt-in.
- **Metronome:** derived from the tapped tempo / time signature.
- **Bar-anchored practice recordings (distinctive UX).** Record the student playing; each recording is **anchored to the bar where it starts** and the range it covers. On the score, a **small badge above a bar shows the count of recordings that start there**; tapping it **expands** — the score opens up at that point and a **little list of that section's recordings** appears (play, compare, flag, delete). The score itself becomes the index of your practice history, section by section.
- **Per-piece to-do list:** practice tasks, seeded from pinned teacher feedback *and* the recap's "for next week" assignments ("bar 24 dynamics" → a task).

### A6. Provenance + essay support
- Annotations, lesson notes, and practice recordings are hashed and OTS-anchored via the existing spine → a provable, timestamped record of the student's work (the "provable ownership" angle, and useful evidence for graded practice logs / music essays).
- Because a Piece + its synced cursor + bar anchors are addressable, the student can **write about the piece in Inkwave** and cite bars: a citation to "bar 34" jumps the cursor and plays that passage. This is where the module meets the writing tool.

---

## PART B — MusicXML Import & Playback (no OMR)

### B1. Rationale
Music-theory students, composers, and anyone using **Sibelius / MuseScore / Dorico / Finale** already has clean, machine-readable notation — all of them export **MusicXML**. Importing that skips OMR entirely and, crucially, gives **automatic precise cursor + playback for free**, because the notation itself carries the timing. Ideal for someone who wants to *write about* a piece they already have engraved.

### B2. Import
- Accept `.musicxml` and `.mxl` (compressed) files; optionally MIDI.
- Parse and render with **OpenSheetMusicDisplay (OSMD)** (MIT-licensed, MusicXML → SVG in the browser) — or **Verovio** if higher-quality engraving is wanted. Both free, no licence negotiation.
- Store the MusicXML plus the rendered representation; encrypt at rest.

### B3. Render + playback (the easy win)
- Render the notation via OSMD/Verovio.
- **Automatic cursor:** OSMD exposes a cursor that steps through measures/notes — no tap-sync needed, because the notation *is* the timing. This is the payoff of clean notation over a photo.
- **Audio playback:** generate note events from the parsed MusicXML and play them through a **soundfont synth** (Web Audio soundfont player / Tone.js). The cursor follows the synth precisely.
- Optional: also attach a YouTube/user reference recording (as in Part A) and offer a toggle between synth playback (auto-synced) and reference playback (tap-synced) — but the synth path is the default, zero-effort experience here.
- Controls: play/pause, tempo, loop a bar-range, transpose (trivial from MusicXML if wanted later).

### B4. Annotation + essay
- Annotate the rendered SVG; anchor comments to **specific notes/measures** (addressable in MusicXML — even cleaner than the photo path's region anchors).
- Write the analysis in Inkwave with citations bound to measures ("see m. 34") that drive the cursor + playback. This is the strongest fit for **music-theory essay writing** — the reason to add this path.

### B5. Provenance
- MusicXML source + annotations + the written analysis are hashed and OTS-anchored, same as everything else.

### B6. Master attachment + bar-range excerpting (transclusion) — for writing about music
- The full MusicXML is stored **once** as an embedded **source attachment** on the document/Piece (deduplicated).
- The student selects a **range of bars** and **inserts that excerpt inline** into the running document. The insert is a **transclusion / reference** — it stores `(master_id, bar_start, bar_end)` and re-renders just those measures via OSMD/Verovio; it is **not** a copy of the XML. Single source of truth: fix the master and every excerpt updates.
- Excerpts are **markup-only, not editable** (annotate + cite, never edit the notes), **playable** (soundfont synth over the excerpt's measures), and **citable** (a citation drives cursor + playback of that range).
- This is the standout feature for **music-theory essays**: "here are bars 12–16 [rendered, playable snippet] — note the modulation…", all pulled from one attached master. The **lesson transcript** (§A3) follows the *same* embedded-source → distil-into-document pattern — an ephemeral attachment the student gradually copies from, rather than editable prose. A single "source attachment → transclude/distil → curated document" model therefore covers both notation and transcripts (and can extend to PDFs, reference recordings, etc.).

### B7. OpenScore corpus integration (public-domain MusicXML source)
- Give the MusicXML path a built-in **library browser** backed by the **OpenScore** public-domain corpus — the closest thing to "IMSLP for MusicXML" (CC0 / Creative Commons digitisations of classical repertoire: the Lieder corpus, string quartets, etc.).
- **How to integrate (honest note):** OpenScore has no bespoke REST API; its corpora are **openly hosted on GitHub** (and mirrored on MuseScore.com). So the integration = browse/search/fetch the MusicXML (`.mxl` / `.musicxml`) files directly from the OpenScore GitHub repositories (GitHub REST API to list, raw content to fetch), cache them, and hand them to the OSMD/Verovio render path. No licence to negotiate (CC0/CC) — just attribution as the licence requires.
- **Licensing discipline:** source only from **verified public-domain corpora** (OpenScore, PDMX, CPDL). Do **not** broadly scrape MuseScore.com user uploads — those include in-copyright arrangements. Students can of course still import their *own* Sibelius/MuseScore exports.
- Result: a student opens Inkwave, picks a public-domain piece from the library, and immediately gets rendered notation + auto cursor + playback + annotation — no photographing, no OMR, no file-hunting.

---

## PART C — Shared architecture, build order, open items

### C1. Third-party components (all free / self-serve, no licence to negotiate)
| Need | Component | Licence/cost |
|---|---|---|
| Reference playback | YouTube IFrame Player API | Free (subject to YouTube ToS) |
| Reference playback (offline/owned) | User-uploaded audio file | None |
| MusicXML rendering + cursor | OpenSheetMusicDisplay / Verovio | MIT / LGPL, free |
| MusicXML audio | Soundfont synth (Web Audio / Tone.js) | Free |
| On-device STT | Apple Speech framework / whisper.cpp | Free, on-device |
| Provenance | Existing Inkwave OTS spine | In-house |

*(Explicitly avoided: Soundslice/Newzik/PlayScore licensing, Spotify API, and any OMR engine.)*

### C2. Build order

*Platform: **iPad-first** (Apple Pencil for all markup), iPhone as companion.*

1. **Photo import + markup (freehand/text/highlight/sticky, Pencil-first) + annotation-space reflow.** (Distinctive, no dependencies.)
2. **On-device lesson STT (session-scoped, non-storable transcript → distil into notes; consent-forward) + end-of-session teacher recap (dictated summary + "+" YouTube/notes assignments) + pin-to-bars + organise-by-piece.** (The crown jewel.)
3. **Reference track (YouTube IFrame + user-file) + manual tap-sync cursor.** (License-free playback.)
4. **Practice tools:** timer via Pomodoro, metronome, **bar-anchored recordings with count badges + expand**, to-dos, **weekly practice schedule (teacher-viewable, opt-in)** — **+ provenance**.
5. **Practice heatmap:** user-curated colour-coding of bar ranges (Pencil), **teacher-editable mid-lesson**, stored in the provenance record. (Optional CV bar pre-detection to ease selection.)
6. **MusicXML path:** import (own files **+ OpenScore public-domain library browser**) → OSMD render → auto cursor + soundfont playback → note/measure annotation → **master-attachment + bar-range excerpting (transclusion) into documents** → essay citations.
7. **Later polish:** CV auto barline/system detection (clean-PDF first, manual fallback); tighter essay integration; optional reference-sync; real-time teacher co-editing (beyond same-device).

### C3. Open items to decide/verify
- **STT model on iPhone 12:** benchmark Apple Speech vs whisper base vs small for accuracy/latency in a quiet lesson before locking in.
- **Render engine:** OSMD (simpler API, has cursor) vs Verovio (nicer engraving) — pick per the annotation/essay needs.
- **Module vs its own app:** keep it a module on the shared engine for now; revisit only if it gets real traction. (Market is crowded; treat as a probe, not a flagship.)
- **YouTube dependency risk:** videos can be region-locked/removed and carry ToS constraints; user-file upload is the resilient fallback and should ship alongside.

---

*End of spec v0.1. A deliberately "light" module: it owns the under-served wrapper (lesson capture, feedback-on-bars, practice, provenance) and the two clean no-OMR entry points (photo tap-sync, MusicXML auto-sync), while renting every commodity piece for free.*
