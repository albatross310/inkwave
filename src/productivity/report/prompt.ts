// The transparent prompt — spec §A7.1.2.
//
// The payload the writer copies has two halves:
//   1. A FIXED first half, generated here and shown VERBATIM in the export panel before it is
//      copied. The writer must be able to see exactly what Inkwave asks their AI to do. It is
//      the same text every time for a given window/content choice — no hidden steering.
//   2. An OPTIONAL user-written second half, layered over sensible defaults so that most
//      writers never write a prompt at all.
//
// ─── WRITTEN FOR A STRONG MODEL (Peter, 2026-07-17) ─────────────────────────────────────────
// Peter runs this in his own Claude session and wants OPUS: "really detailed qualitative reports
// written by opus", with examples, inspirational moments, which sessions produced his best work.
// §A7.2's "Opus is unnecessary… ~5× the cost" reasoning is about PATH 2, the backend, where
// Inkwave pays. THIS IS PATH 1 — the writer runs it themselves, so the model is their choice and
// costs us nothing. (Path 2's model choice stays open; nothing here decides it.)
// So this asks for an ESSAY, not a form. The first cut read as a scorecard to fill in — five
// bullet points and a table — which is exactly what a strong model will dutifully produce if you
// ask for it. The constraints below are unchanged in force and stricter in wording; what changed
// is the shape of what is asked for.
//
// ─── §A5 WAS REVERSED ON 2026-07-17 — TONE IS "HONEST FIRST, FUNNY SECOND, KIND THIRD" ──────
// Peter: "tbh I think it's too nice and not enough humour. We need it to be quirkier and read
// like a comedian wrote it" / "It doesn't need to be kind. It needs to be honest." The old
// kind/non-shaming rule is SUPERSEDED — do not restore it from memory of an earlier draft.
//
// WHAT DID NOT CHANGE, AND WHY THE REVERSAL IS SAFE. §A5's surviving distinction is the whole
// thing: PRODUCTIVITY GUILT IS A STANDARD IMPOSED ON THE WRITER; ACCOUNTABILITY IS A GOAL THE
// WRITER SET (§A5b). "You only managed 200 words, poor effort" is imposed, worthless, banned.
// "You said you'd finish the lit review by Friday and you've opened it twice" is the writer's own
// words quoted back, and is the point. So the goal is what gives the report STANDING to push, and
// §A5b's boundary is its corollary: NO GOAL ⇒ DESCRIBE, DON'T PUSH — never invent a standard.
// That boundary is STRUCTURAL here, not a request: goals travel only on their own consent tick,
// so a model sent no goal has nothing to hold the writer to, and is told so in as many words.
//
// Three of the spec's hard rules are baked into the fixed half, and NONE is trusted to the prompt
// alone — a prompt is a request, not a guarantee, so each is also enforced on the reply:
//   • §A5 no verdicts on the PERSON    → asked here; flagged by claims.ts findPersonVerdicts
//   • §A6.2 statistical honesty        → asked here; enforced by claims.ts on daily replies
//   • §A6.4 never round-trip measured  → asked here; enforced by judged.ts (measured columns are
//                                        REJECTED) and claims.ts (invented numbers are flagged)
//   • quality/insight without content  → asked here; enforced by judged.ts (CONTENT_ONLY_COLUMNS)

import type { ReportWindow } from '../types'

// ─── The judged schema (§A7.1.4) ────────────────────────────────────────────────────────────
// Rows are sessions (daily) or days (weekly/monthly), per the spec's "rows = sessions/days".
// These are JUDGED columns only: every one is something the client cannot compute.

/**
 * Columns that may be asked for ONLY when the writer sent document text.
 *
 * THE HONESTY THIS ENFORCES (§A6.1): you cannot judge writing from minutes and word counts.
 * A `quality` or `insight` verdict derived from "45 active minutes, 400 words added" is
 * vibes-as-numbers wearing a judged label — the exact failure §A6.1 exists to prevent, and the
 * most tempting one here, because Peter is ASKING for "which sessions produced your best
 * content" and a model will happily oblige from telemetry alone. So the columns exist only when
 * their evidence does, and judged.ts REFUSES them otherwise. Structural, not a prompt request.
 */
export const CONTENT_ONLY_COLUMNS = ['insight', 'quality'] as const

/** The exact first line the model must emit in its ```csv block. */
export function judgedHeader(window: ReportWindow, contentIncluded = false): readonly string[] {
  if (window === 'daily') {
    return contentIncluded
      ? ['session_id', 'phase', 'effort', 'insight', 'quality', 'note']
      : ['session_id', 'phase', 'effort', 'note']
  }
  // Weekly/monthly rows are DAYS. `character` is what answers Peter's "what the good days were,
  // what the bad" — see its column doc: it describes the day, never grades the writer.
  //
  // NB no content-only columns here, deliberately. At weekly+ the ledger sends day rollups and
  // WHOLE documents (§A3.3 / the sessions:[] contract) — there is no per-session excerpt to
  // ground a per-day quality verdict against, so asking for one would invite exactly the
  // ungrounded judgement the daily gate refuses. Quality lives on the daily window, where the
  // session→prose pairing makes it real.
  return ['day', 'phase', 'effort', 'momentum', 'character', 'note']
}

export const PHASE_VALUES = ['deep', 'shallow', 'mixed', 'unclear'] as const
export const EFFORT_VALUES = ['light', 'steady', 'intense', 'unclear'] as const
export const MOMENTUM_VALUES = ['building', 'holding', 'easing', 'unclear'] as const
export const INSIGHT_VALUES = ['none', 'a_little', 'clear', 'breakthrough'] as const
export const QUALITY_VALUES = ['unclear', 'rough', 'developing', 'strong'] as const
/** Describes the DAY — never the writer. See the §A5 note in columnDoc(). */
export const CHARACTER_VALUES = ['breakthrough', 'steady', 'grind', 'scattered', 'away', 'unclear'] as const

export function headerLine(window: ReportWindow, contentIncluded = false): string {
  return judgedHeader(window, contentIncluded).join(',')
}

// ─── The fixed half ─────────────────────────────────────────────────────────────────────────

export interface FixedPromptOpts {
  window: ReportWindow
  /** True when the writer ticked content for at least one document (§A7.3). */
  contentIncluded: boolean
  /** True when the writer opted into their diary notes (tier 2a). */
  notesIncluded?: boolean
  /** True when the writer opted into their place labels (tier 2b) — INDEPENDENT of the notes. */
  placesIncluded?: boolean
  /** True when per-session excerpts are in the payload (daily + content ticked). */
  excerptsIncluded?: boolean
  /**
   * §A5b — true when the writer shared a goal/plan for at least one document. THIS IS WHAT
   * LICENSES THE REPORT TO PUSH. False ⇒ the prompt says so explicitly and forbids inventing a
   * standard; do not default it true "to be useful".
   */
  goalsIncluded?: boolean
}

/** §A6.2 — daily is a descriptive recap; pattern claims are permitted only at weekly+. */
function claimRules(window: ReportWindow): string {
  if (window === 'daily') {
    return [
      'WHAT YOU MAY CLAIM — this is a SINGLE DAY',
      '',
      'Say what happened together today, and say it briefly. "After your 3pm break you wrote for',
      'forty minutes straight — the longest stretch of the day" is a true statement about today,',
      'it is what the writer wants, and you should make it. So is "both of the sessions where you',
      'cut more than you added came after long gaps". Pair things up. Point at what sat next to',
      'what. Keep it short — a line or two, not a section.',
      '',
      'What you may NOT do is EXPLAIN it or GENERALISE it. One day is one data point: it can show',
      'you what co-occurred, and it cannot show you why, or whether it ever happens again. So no',
      'causes ("the break helped", "the gap cost you the thread"), no rules ("you always write',
      'best after a walk"), no bests or worsts of the day-of-week kind, no habits, no trends, no',
      'correlations in the statistical sense. If you are tempted to write "the break helped",',
      'write what happened and leave the cause alone. The difference is exact: today\'s pairing is',
      'an observation; today\'s explanation is a guess wearing a finding\'s clothes.',
      '',
      'Inkwave scans daily replies for causal and pattern language and flags it to the writer',
      'rather than presenting it as a finding. It does not flag you for describing the day.',
      '',
      'This is the hardest line in the prompt to hold well, because the writer WANTS the',
      'explanation and you will be able to see a plausible one. Give them the day in full,',
      'concrete detail instead — what happened, in what order, next to what, and what it produced.',
      'That is worth more than a guess, and the weekly report is where the guess gets tested.',
    ].join('\n')
  }
  const span = window === 'weekly' ? 'week' : 'month'
  return [
    `WHAT YOU MAY CLAIM — this is a ${span.toUpperCase()}`,
    '',
    `A ${span} holds enough sessions to support genuine pattern claims, and this is where the`,
    'writer gets real value from you, so make them — and make them specific. Breaks and focus.',
    'Time of day. Drafting versus editing. Where they worked, if they told you. Anything they',
    'mentioned in their own notes that recurs. Say what the evidence is each time, in the same',
    'breath as the claim, so they can weigh it themselves.',
    '',
    'And keep the strength of the claim inside the strength of the evidence. Two data points are',
    'not a pattern; do not manufacture one. Where days are missing they are gaps, not zeros: say',
    'so rather than filling them in. Prefer "you tended to" over "you always". When something',
    'looks like a pattern but the week cannot settle it, say exactly that — a named open question',
    'is more useful than a confident answer that happens to be wrong, and the writer will get',
    'another week.',
  ].join('\n')
}

function columnDoc(window: ReportWindow, contentIncluded: boolean): string {
  const lines: string[] = []
  if (window === 'daily') {
    lines.push(
      '  session_id  Copy verbatim from the session table below. One row per session, no others.',
      '  phase       deep | shallow | mixed | unclear — the kind of attention the work suggests.',
      '  effort      light | steady | intense | unclear — how hard it reads, NOT how good it is.',
    )
    if (contentIncluded) {
      lines.push(
        '  insight     none | a_little | clear | breakthrough — did the writing MOVE in this session?',
        '              Judge this from the text the session produced, never from its word count: a',
        '              session that wrote 40 words that unlock an argument is a breakthrough, and one',
        '              that wrote 800 words of competent filler is not.',
        '  quality     unclear | rough | developing | strong — the state of what this session',
        '              produced, as prose. This is about the TEXT, not the writer, and "rough" is a',
        '              normal and necessary stage of writing, not a criticism.',
      )
    }
  } else {
    lines.push(
      '  day         Copy verbatim from the day table below (YYYY-MM-DD). One row per day present.',
      '  phase       deep | shallow | mixed | unclear — the kind of attention the work suggests.',
      '  effort      light | steady | intense | unclear — how hard it reads, NOT how good it is.',
      '  momentum    building | holding | easing | unclear — where this day sat in the window\'s arc.',
      '  character   breakthrough | steady | grind | scattered | away | unclear — what KIND of day',
      '              it was. This is the honest answer to "which were the good days and which were',
      '              the bad", and it describes THE DAY, never the writer: "grind" means the work',
      '              was heavy going, "scattered" means it did not settle, "away" means they were',
      '              not writing. None of them is a mark against anyone. Do not rank the days and',
      '              do not total them up.',
    )
  }
  lines.push(
    '  note        A short kind sentence, 140 characters or fewer. Quote it if it contains a comma.',
  )
  return lines.join('\n')
}

/**
 * The exact fixed first half of the payload. Shown verbatim to the writer before it is copied
 * — if you change this text, the panel shows the change; there is no second, hidden copy.
 */
export function fixedPrompt(opts: FixedPromptOpts): string {
  const {
    window, contentIncluded, notesIncluded, placesIncluded, excerptsIncluded, goalsIncluded,
  } = opts
  const parts: string[] = [
    'You are helping a writer understand how they worked. Inkwave, a local-first writing app,',
    'compiled the data below from the work ledger on their own device. The writer is running this',
    'in their own AI session and pasting your reply back; Inkwave itself sends nothing.',
    '',
    'WHAT TO WRITE',
    '',
    'Write them a proper piece of writing — an essay about their work, not a summary of it. Take',
    'the room you need. Most of what you produce should be prose: paragraphs that follow a thought',
    'through, not bullets that gesture at one. Bullets are for lists of things; this is not a list',
    'of things.',
    '',
    'Be specific, and prefer the concrete every time. "You did your best work in the morning" is',
    'worth little; "the forty minutes after your 3pm break produced the passage where the argument',
    'finally turns — the one beginning \'the distinction only does work if\'" is worth a great deal,',
    'and it is the kind of thing only someone who actually read the material can say. Quote the',
    'writer back to themselves where a quotation earns its place. Point at particular sessions,',
    'particular passages, particular moments. Notice what THEY probably could not: the paragraph',
    'that took three attempts, the day the tone changed, the idea that arrived quietly and was',
    'load-bearing an hour later.',
    '',
    'Interesting beats comprehensive. If one thing about this window is genuinely worth saying,',
    'say that thing properly and let the rest go. Do not pad to cover every field of the data, and',
    'do not narrate numbers back at the writer — they can already see the numbers, and Inkwave has',
    'already drawn them.',
    '',
    'Reply with exactly two things, in this order:',
    '  1. The narrative, in markdown, under the heading "## Narrative". Use whatever internal',
    '     structure serves it; there is no template to fill in.',
    '  2. One fenced CSV block tagged ```csv, holding your judged fields and nothing else.',
    '',
    'TONE — honest first, funny second, kind third',
    '',
    'Write like a sharp friend who has actually read the writer\'s week — not like a wellness app,',
    'and not like a manager. Be quirky. Be specific. Be funny where there is something genuinely',
    'funny in the material, and there usually is, because writing is a ridiculous way to spend a',
    'life and the record of it is full of comedy: the paragraph rewritten nine times, the profound',
    'thought that arrived at 1am and turned out to be nonsense, the day that produced eleven words',
    'and a nap. A joke lands because it is TRUE. That is the whole trick, and it is why honesty',
    'comes first — a funny line that is not true about their week is just noise, and a true line',
    'that is dull is still worth more than it.',
    '',
    'Do not be gentle about a bad day. Name it. "Tuesday never got going — four sessions, none',
    'past fifteen minutes, and the longest thing you wrote all day was a note about how the day',
    'was going" is honest, probably funny, and exactly what they asked for. "Tuesday was a lighter',
    'day" is a euphemism: they can see the chart, they know it was not lighter, it was bad, and',
    'softening it just tells them the report cannot be trusted on the good days either.',
    '',
    'THE LINE — this is not about being nice, and it is the one thing in this prompt you must not',
    'get wrong.',
    '',
    'There is a difference between ACCOUNTABILITY and PRODUCTIVITY GUILT, and it is not a matter',
    'of degree or of tone. Accountability is measuring the writer against a goal THEY SET. Guilt',
    'is measuring them against a standard YOU invented. The first is why this report exists. The',
    'second is worthless to them, and you must not do it, however wittily.',
    '',
    '  • If they set a goal — you will see it below if they shared it — hold them to it. Quote it',
    '    back at them. Ask why the lit review has been opened twice in nine days. Notice the thing',
    '    that keeps getting deferred, and say so. That is the job, and "only", "still", "again"',
    '    and "you said you would" are all fair when the standard is one they wrote down.',
    '  • If they did NOT set a goal, you have no standard to measure against and you must not',
    '    invent one. Do not decide that 200 words is a bad day. Do not decide four hours is a good',
    '    one. You do not know what they were trying to do, or what else that week held. Describe',
    '    what happened, be funny about it, and leave the verdict alone.',
    '',
    'Never score, rank or grade the writer. Never compare them to anyone else — no other writers,',
    'no averages, and no hypothetical version of them who would have finished by now. Never call',
    'the PERSON lazy, pathetic, disappointing, a waste, or a failure: those are verdicts on a human',
    'being rather than observations about a week, and no goal licenses one. Be as rude as you like',
    'about a Tuesday. Never about them.',
    '',
    'Deleting is writing, restructuring is writing, and a thinking-heavy day with nine words on the',
    'page may be the most important day in the window. If you cannot tell from the data whether a',
    'quiet day was a struggle or a rest, that is because you cannot tell. Say that, or say nothing',
    'about it — do not pick the gloomier reading because it makes a better line.',
    '',
    claimRules(window),
    '',
    'NUMBERS — do not restate them',
    '',
    'Inkwave already holds the measured numbers and graphs them itself; they are exact, and they',
    'are the thing it is trusted for. Do not put any measured number in the CSV. Do not recompute,',
    'total, average, round, tidy or estimate one anywhere. In the narrative, use a number only if',
    'it appears verbatim in the data below — and prefer not to: your job is what the numbers do',
    'not say. Inkwave flags every number in your reply that it cannot find in what it sent you,',
    'so an invented one will be visible.',
    '',
    'THE CSV — judged fields only',
    '',
    'Emit exactly one ```csv block. Its first line must be exactly:',
    '',
    `  ${headerLine(window, contentIncluded)}`,
    '',
    columnDoc(window, contentIncluded),
    '',
    'Nothing else belongs in the block: no measured columns, no totals row, no commentary, no',
    'blank trailing columns. Judge every row the table below lists, and no rows it does not. If a',
    'row genuinely cannot be judged, write "unclear" rather than guessing.',
  ]

  // TIER 2a/2b — two independent ticks, so this says exactly what arrived and, crucially, what
  // did NOT. A writer can now share where they worked without sharing what they wrote about their
  // day, or the reverse — and the report must degrade honestly rather than assert a correlation
  // it has no data for.
  if (notesIncluded || placesIncluded) {
    parts.push('', 'THE WRITER\'S OWN WORDS', '')
    if (notesIncluded) {
      parts.push(
        'The writer has chosen to include their own end-of-session diary lines. These are their',
        'words about their own day: treat them as context for how the work felt, and let them',
        'soften the reading rather than sharpen it. A note saying the day was hard is the writer',
        'telling you something true. Do not grade a note, and do not turn one into a task list.',
        '',
        'Read them for what they mention in passing, too. A writer who notes coffee, a walk, a bad',
        'night\'s sleep or a particular room is handing you the variable the ledger cannot see —',
        'and at a week or more, that is exactly the kind of thing worth holding up against how the',
        'work actually went. Their word for it is the evidence; say so when you use it.',
      )
    }
    if (placesIncluded) {
      parts.push(
        ...(notesIncluded ? [''] : []),
        'The writer has chosen to include the place labels they typed for their sessions. A place',
        'label is a word they wrote — "library", "home" — and nothing more: Inkwave has no',
        'location data of any kind and neither do you. Do not read a label as anything but their',
        'own word for where they were.',
      )
    }
    // The ABSENCES are stated. A model told only what it has will cheerfully fill the gap —
    // and "you didn't record where you worked" is a claim about the writer we would be inventing,
    // when the truth is that they chose not to send it.
    if (!placesIncluded) {
      parts.push(
        '',
        'The writer did NOT share their place labels. You do not know where any of this happened.',
        'Say nothing about where they worked, and do not treat its absence as a fact about them.',
      )
    }
    if (!notesIncluded) {
      parts.push(
        '',
        'The writer did NOT share their diary notes. You do not know how any session felt to them,',
        'or what else was going on that day. Do not infer it from the place labels alone.',
      )
    }
  }

  if (contentIncluded) {
    parts.push(
      '',
      'DOCUMENT TEXT',
      '',
      'The writer has chosen to include the text of some documents, marked below. This is what',
      'lets you say something real about the writing itself — where the argument turns, what got',
      'clearer, which passage is doing the work. Read it properly and use it.',
      '',
      'Do not quote it back at length, do not critique its worth, and do not treat it as an',
      'assignment to mark. You are describing what happened to a piece of writing, not assessing',
      'a student.',
    )
  }

  // §A5b — the goals section, and the honesty boundary that comes with its absence.
  if (goalsIncluded) {
    parts.push(
      '',
      'WHAT THE WRITER SAID THEY WERE DOING',
      '',
      'Below are the writer\'s own goals and rough plans for their documents, in their own words.',
      'THIS is what you hold them to — nothing else. Read the gap between what they said they',
      'would do and what the ledger shows they did, and report it straight: progress, drift,',
      'avoidance, the milestone that has quietly moved three times, the document they said was the',
      'priority and have not opened. Quote their own words back when you do it; that is what makes',
      'this accountability rather than you having opinions about their week.',
      '',
      'Be direct about it. This is the part they asked for and the part that is worth something —',
      'a report that notices the avoidance and says nothing is just an expensive chart. But hold',
      'them ONLY to what they wrote. Do not extend their goal into a stricter one, do not invent',
      'the deadline they left vague ("rough dates" are rough on purpose), and do not treat a plan',
      'they revised as a plan they failed — revising a plan is usually the writer being sensible.',
      '',
      'A goal a writer has not touched all window is worth naming. A goal they have quietly',
      'abandoned is worth naming too, kindly or not, but WITHOUT deciding for them that abandoning',
      'it was wrong: people drop goals for good reasons and you cannot see their life.',
    )
  } else {
    // The absence is STATED, and it is load-bearing (§A5b's honesty boundary). Without this line a
    // model that has been told to be honest and funny about a bad week will simply supply its own
    // yardstick — which is precisely the imposed standard §A5 still bans. The structural half is
    // that no goal text is in this payload at all; this is the half that stops it being invented.
    parts.push(
      '',
      'NO GOALS WERE SHARED — SO YOU HAVE NO STANDARD TO MEASURE AGAINST',
      '',
      'The writer has not shared any goal or plan with you. That means you do not know what they',
      'were trying to do this window, what "enough" would have been, or what they had decided',
      'mattered. So: DESCRIBE, DO NOT PUSH.',
      '',
      'Do not invent a standard and hold them to it. Do not imply a word count should have been',
      'higher, a session longer, or a document further along — you have no basis for any of it,',
      'and a verdict with no standard behind it is exactly the productivity guilt this report',
      'refuses to be. Be as sharp, specific and funny as you like ABOUT WHAT HAPPENED. Just do not',
      'pretend to know what should have happened. If you find yourself wanting to push, the honest',
      'move is to say that they have not told you what they were aiming at.',
    )
  }

  if (excerptsIncluded) {
    parts.push(
      '',
      'WHAT EACH SESSION PRODUCED',
      '',
      'Below, each session is paired with the prose that appeared during it, taken from Inkwave\'s',
      'own snapshot record — not inferred. This is what lets you answer "which sessions produced',
      'the best work" with evidence instead of a guess from the clock.',
      '',
      'Read the excerpts as WORK IN PROGRESS, because that is what they are: rough is normal, and',
      'a session that produced little may have produced the sentence the rest depends on. Where an',
      'excerpt is missing, the record simply has no boundary there — that is not the writer doing',
      'nothing, and you must not read it as such. Where one is marked as covering a wide baseline,',
      'it may include work from before that session; do not pin it precisely.',
    )
  }
  return parts.join('\n')
}

// ─── The optional user half ─────────────────────────────────────────────────────────────────

/**
 * The default second half. Most writers never touch the prompt, so the defaults have to carry
 * them: this is what a good, plain request looks like, and it is pre-filled and editable.
 */
export const DEFAULT_USER_PROMPT =
  'Speak to me directly, in plain language. Take as long as the material deserves.'

export interface AssembleOpts extends FixedPromptOpts {
  /** The writer's own words. Empty/whitespace → the section is omitted entirely. */
  userPrompt?: string
  /** The compiled data section (rollups; and document text if ticked). */
  data: string
}

/** Fixed half + optional user half + data, in that order. */
export function assemblePrompt(opts: AssembleOpts): string {
  const user = (opts.userPrompt ?? '').trim()
  const blocks = [fixedPrompt(opts)]
  if (user) {
    blocks.push(
      [
        'WHAT THE WRITER ASKED FOR',
        '',
        'The writer added this. Follow it where it does not conflict with the rules above; where it',
        'does, the rules above win.',
        '',
        user,
      ].join('\n'),
    )
  }
  blocks.push(opts.data)
  return blocks.join('\n\n' + '─'.repeat(78) + '\n\n')
}
