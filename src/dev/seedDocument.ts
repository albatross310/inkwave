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

function seedContent(): TiptapJSON {
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'The cost of the page' }] },
      ...PARAGRAPHS.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
    ],
  }
}

export function seededDocument(): InkwaveDocument {
  const now = new Date().toISOString()
  return withScasDefaults({
    id: uuidv4(),
    title: 'Sample text (dev seed)',
    contentJson: seedContent(),
    createdAt: now,
    updatedAt: now,
    schemaVersion: '0.1.0',
    scasLimitN: 'infinite',
    scasSessionSeed: uuidv4(),
  })
}
