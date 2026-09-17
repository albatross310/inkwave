// DEV-ONLY sample document behind `?seed` (Peter, 2026-09-16: "open them all for me with some
// example text"). A lane's localhost tab should have something on the page to test against —
// pagination, SCAS, the toolbar — without anyone pasting first. It is reached ONLY from the
// absence path in Edit.tsx (a fresh blank would have been minted anyway), so the data-loss rules
// are untouched: no read is answered, no held document is replaced. The prose is generic filler
// written for this file; Peter's own writing never enters the repo.
import { v4 as uuidv4 } from 'uuid'
import type { InkwaveDocument, TiptapJSON } from '../types/document'
import { withScasDefaults } from '../scas/defaults'

export const SEED_PARAM = 'seed'

export function seedRequested(): boolean {
  if (!import.meta.env.DEV) return false
  try { return new URL(window.location.href).searchParams.has(SEED_PARAM) } catch { return false }
}

// `?seed=fresh` (DEV only): ALWAYS mint a new seeded document for this tab, ignoring the one its
// sessionStorage already names. Max, 2026-09-16: a tab that had been seeded with the earlier
// generic text kept it forever, because that document is neither absent nor an untouched blank.
// The held document is left exactly as it was — nothing is overwritten; the tab simply moves on.
export function seedFreshRequested(): boolean {
  if (!import.meta.env.DEV) return false
  try { return new URL(window.location.href).searchParams.get(SEED_PARAM) === 'fresh' } catch { return false }
}

const PARAGRAPHS = [
  'The earliest paper mills in Europe were built beside fast rivers, because the pulp had to be beaten for hours and water wheels were the only engines available. A sheet made this way was slow to produce and expensive to buy, so a writer planned each page before the pen touched it.',
  'That habit of planning survived the arrival of cheap paper by several centuries. Drafts were written small in the margins, corrections were squeezed between lines, and a fair copy was made only once the argument had settled. The physical cost of the page shaped the shape of the thought.',
  'Printing changed who could read, but it changed very little about how a page was composed. The compositor still worked from a manuscript that had been revised by hand, and the author still had to decide what was finished before anything was set in type. Revision remained a private act.',
  'Word processing removed the cost of the page entirely. A sentence could be moved, split, or deleted at no expense, and the visible record of that work disappeared with each save. What the writer gained in freedom, the reader of the finished text lost in evidence of how it had been made.',
  'Some writers responded by keeping their drafts deliberately. Numbered files, dated folders, and printed versions in a drawer were all attempts to recover the trace that the machine no longer kept. None of them were part of the tool; each was a discipline the writer had to impose on themselves.',
  'The question this raises is not whether a record of composition is valuable, but whether it can be kept without becoming a burden. A record that must be maintained by hand will lapse the moment the work becomes difficult, which is exactly when it would have been most informative.',
  'A record kept by the environment itself has the opposite property. It costs nothing at the moment of writing and it cannot be forgotten, because it is not the writer who remembers. The only design question is what the record should contain and who should be able to read it.',
  'This sample document exists so that a fresh development tab has a few pages of text on it. It is not part of any real document and it carries no provenance of its own. Edit it freely, delete it, or replace it with whatever the feature under test needs.',
]

// PER-LANE SEED (Peter, 2026-09-16: "the example text on docs should match the things I have to
// check"). scripts/follow-branch.sh exports VITE_LANE_SEED as the JSON of scripts/lanes/<L>.json —
// {title, paragraphs, checks} — so the tab opens on THAT PR's plain-English summary and a checklist
// he can tick in place. The generic prose above is the fallback when no lane file exists.
export type LaneSeed = { title: string; paragraphs: string[]; checks: string[] }

export function laneSeed(): LaneSeed | null {
  const raw = import.meta.env.VITE_LANE_SEED
  if (!raw) return null
  try {
    const j = JSON.parse(raw) as Partial<LaneSeed>
    if (typeof j.title !== 'string' || !Array.isArray(j.paragraphs)) return null
    return { title: j.title, paragraphs: j.paragraphs.filter((x) => typeof x === 'string'), checks: Array.isArray(j.checks) ? j.checks.filter((x) => typeof x === 'string') : [] }
  } catch { return null }
}

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })

function seedContent(): TiptapJSON {
  const lane = laneSeed()
  if (lane) {
    return {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: lane.title }] },
        ...lane.paragraphs.map(para),
        ...(lane.checks.length
          ? [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Check' }] }, ...lane.checks.map((c) => para(`☐ ${c}`))]
          : []),
        // A few pages of ordinary prose below the checklist so pagination, SCAS and scrolling
        // still have something to work on.
        ...PARAGRAPHS.map(para),
      ],
    }
  }
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'The cost of the page' }] },
      ...PARAGRAPHS.map(para),
    ],
  }
}

export function seededDocument(): InkwaveDocument {
  const now = new Date().toISOString()
  const id = uuidv4()
  markSeedHistoryPending(id)
  return withScasDefaults({
    id,
    title: laneSeed()?.title ?? 'Sample text (dev seed)',
    contentJson: seedContent(),
    createdAt: now,
    updatedAt: now,
    schemaVersion: '0.1.0',
    scasLimitN: 'infinite',
    scasSessionSeed: uuidv4(),
  })
}

// ─── Seed HISTORY (Peter, 2026-09-16: "no snapshots still") ───────────────────────────────────
// A seeded document lands as ONE write, and snapshots mint only on chunked arrival, so every lane
// opened with ◈ 0 and nothing to scrub. So the editor, once, commits the seed CUMULATIVELY —
// blocks 1..k for k = 1..N — through the same manual-snapshot funnel the ⊕ button uses, so the
// archive holds real versions with settled hashes. The marker is sessionStorage (per tab, like
// document identity), written when the seed is minted and CONSUMED by the first editor that sees
// it, so a reload never replays the history. DEV only, like everything else in this file.
const SEED_HISTORY_KEY = 'inkwave:seedHistory'
export const SEED_HISTORY_MAX_STEPS = 8

function markSeedHistoryPending(docId: string) {
  try { sessionStorage.setItem(SEED_HISTORY_KEY, docId) } catch { /* private mode: no history, no harm */ }
}

/** True exactly once per seeded document: the first caller takes the marker. */
export function takeSeedHistory(docId: string): boolean {
  if (!import.meta.env.DEV) return false
  try {
    if (sessionStorage.getItem(SEED_HISTORY_KEY) !== docId) return false
    sessionStorage.removeItem(SEED_HISTORY_KEY)
    return true
  } catch { return false }
}

/**
 * The cumulative prefixes to snapshot, oldest first, EXCLUDING the full document (the caller
 * snapshots the live document last). Blocks are grouped evenly so a long seed still yields at most
 * `maxSteps` versions; a 1-block document yields none. Pure, so it is unit-tested.
 */
export function seedHistorySlices(content: TiptapJSON, maxSteps = SEED_HISTORY_MAX_STEPS): TiptapJSON[] {
  const blocks = Array.isArray(content.content) ? content.content : []
  const n = blocks.length
  if (n < 2 || maxSteps < 2) return []
  const steps = Math.min(n, maxSteps)
  const out: TiptapJSON[] = []
  for (let i = 1; i < steps; i++) {
    const end = Math.round((i * n) / steps)
    if (end <= 0 || end >= n) continue
    if (out.length && out[out.length - 1].content?.length === end) continue
    out.push({ type: 'doc', content: blocks.slice(0, end) })
  }
  return out
}
