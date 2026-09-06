// THE RICH DIFF — /snapshot's doc pane as FORMATTED PAGES, for every version.
//
// WHY. The pane's diff is computed over FLAT TEXT (`diffWords` over `pmToText`), so for 115 of 116
// versions it rendered ONE `[data-opidx]` span of `pre-wrap` transcript: measured headings 6→0,
// lists 6→0, paragraphs 48→0, top-level children 50→1 (panecontent.prove.mjs). Only the FIRST
// snapshot (`ops === null`) ever got the rich `DocView`. Peter: "I'm thinking rich text" — he had
// asked that the renderer "look pretty similar to an actual page", and it didn't.
//
// HOW. `provenance/textMap.ts` projects the flat diff back onto the PM tree: `buildFlatMap` mirrors
// pmToText byte-for-byte (asserted, 36 tests) and reports where every inline leaf landed in the flat
// text; `anchorOps` puts each op on that same axis. So this file walks `contentJson` exactly as
// DocView does — same tags, same citation span — and splits each text leaf into marked runs by
// intersecting its flat range with the ops. No DOM, no editor, no measurement: a pure render.
//
// THE CONTRACT WITH THE REST OF THE PANE (do not "clean up"): the runs emit the SAME `diff-add` /
// `diff-del` classes and the SAME `data-opidx` as FullDiffView, because the hover, click-to-jump,
// highlight-injection and `computeDiffPagesFor` machinery all key on exactly those. A run is a SLICE
// of an op, never a new op — which is why AnchoredOp carries the source op's `idx`.
//
// DELETIONS HAVE NO HOME. A `del` exists in PREV and occupies NOTHING in CUR, so it is a POINT on
// the cur axis, not a range (`curStart === curEnd`; the cursor advances on same/add only).
//
// WHERE THEY ACTUALLY LAND — MEASURED, not assumed. The first cut of this file carried an elaborate
// "gap del" mechanism to place a del falling in a '\n\n' join (a whole deleted paragraph) at the head
// of the following block. Instrumented across 15 document shapes — mid-paragraph, two-word, whole
// paragraph, first/last paragraph, list item, heading, around a citation, total replacement — **it
// NEVER FIRED ONCE**, while all 24 tests passed. It was dead code wearing a correctness argument.
// The reason is structural: `diffWords` tokenises as `\S+\s*`, so a block's last token ABSORBS the
// '\n\n' join, which makes every block's `flatStart` a token boundary and a join's interior never
// one. A del can therefore only anchor at a block's start or inside it — and `opsInRange` includes a
// del at `from`, so the block's own segs already claim it. A deleted paragraph renders as
// strikethrough text leading the next block, in document order, which is what the flat view does
// today (dels are inline in the flow) — so this is not a regression.
//
// WHAT THE INSTRUMENTATION DID FIND is a real hole the tests missed: when CUR has NO blocks at all
// (every block empty ⇒ pmToText drops them ⇒ `map.blocks` is `[]`), NO seg can claim anything and
// every deletion vanished from the pane while the flat view still showed them. Deleting all your
// text is not an exotic shape. Hence ORPHANS below: any del no block claims is rendered at the end,
// so a deletion can never be silently dropped. Orphans occur ONLY when cur has no blocks (proved
// over those 15 shapes) — which is exactly when "at the end" is also "in order".
//
// NOT RENDERED: `referenceList`. DocView has no case for it either (it is a leaf atom with no
// content), so the pane has NEVER shown a bibliography and this change does not start. That is
// deliberate coordination, not an oversight: rendering it would make the refList's 120px-vs-880px
// height guess LIVE in the pane, and that layout is owned by feat/reflist-layout. When it lands, the
// refList's real height must come with it or `reliablePages` must stop there honestly.
import { Fragment, type ReactNode } from 'react'
import type { TiptapJSON, CSLItem } from '../types/document'
import { bibProvider } from '../citations/bibProvider'
import { simpleInText } from '../citations/format'
import { buildFlatMap, anchorOps, opsInRange, type AnchoredOp, type FlatSeg } from '../provenance/textMap'
import type { DiffOp } from '../provenance/diff'
import { StoredMediaFigureContents, storedMediaFigureStyle, type StoredMediaImageAttrs } from './StoredMediaImage'

type Node = { type?: string; text?: string; marks?: Array<{ type: string }>; attrs?: Record<string, unknown>; content?: Node[] }

// Byte-for-byte the styles FullDiffView uses — the two renderers must be indistinguishable in
// everything except structure, or switching them would read as a visual change rather than a layout one.
// The `--iw-snap-*` tokens (index.css, SNAPSHOT VIEW block) so the doc pane's marks and the diff
// panel's bullets are ONE palette in both themes — the day values below are the literals this pane
// has always painted, kept as fallbacks.
const DEL_STYLE: React.CSSProperties = { color: 'var(--iw-snap-del-fg, #b91c1c)', textDecoration: 'line-through', background: 'var(--iw-snap-del-bg, rgba(185,28,28,0.07))' }
const ADD_STYLE: React.CSSProperties = { background: 'var(--iw-snap-add-bg, rgba(22,163,74,0.16))', color: 'var(--iw-snap-add-fg, #166534)' }

export interface RichDiffHooks {
  onOpClick?: (opIdx: number) => void
  onHoverOp?: (opIdx: number | null) => void
}

const pathKey = (p: readonly number[]): string => p.join('.')

/** One op-run inside a text leaf → a marked span (or bare text for `same`). */
function runNode(op: AnchoredOp, key: string, hooks: RichDiffHooks): ReactNode {
  if (op.type === 'same') return <Fragment key={key}>{op.text}</Fragment>
  const cls = op.type === 'del' ? 'diff-del' : 'diff-add'
  return (
    <span
      key={key} className={cls} data-opidx={String(op.idx)} style={op.type === 'del' ? DEL_STYLE : ADD_STYLE}
      onClick={hooks.onOpClick ? () => hooks.onOpClick!(op.idx) : undefined}
      onMouseEnter={hooks.onHoverOp ? () => hooks.onHoverOp!(op.idx) : undefined}
      onMouseLeave={hooks.onHoverOp ? () => hooks.onHoverOp!(null) : undefined}
      title={hooks.onOpClick ? 'Jump to this change in diff panel' : undefined}
    >{op.text}</span>
  )
}

/** Wrap a rendered inline in its PM marks — identical to DocView's applyMarks. */
function applyMarks(el: ReactNode, marks: Node['marks']): ReactNode {
  for (const m of marks ?? []) {
    if (m.type === 'bold') el = <strong>{el}</strong>
    else if (m.type === 'italic') el = <em>{el}</em>
    else if (m.type === 'underline') el = <u>{el}</u>
    else if (m.type === 'strike') el = <s>{el}</s>
    else if (m.type === 'code') el = <code>{el}</code>
  }
  return el
}

interface Ctx {
  segs: Map<string, FlatSeg[]>
  anchored: AnchoredOp[] | null
  hooks: RichDiffHooks
}

/**
 * One inline LEAF's text, split into marked runs.
 *
 * `text` is the leaf's OWN full string. Its seg (if any) covers only the part that SURVIVED
 * pmToText's per-block trim, at `[nodeStart, nodeStart+len)` — so the trimmed head/tail carry no diff
 * information and render plain. That is correct: they are whitespace at a block's edge, they are not
 * in the flat text, and no op can refer to them.
 */
function splitLeaf(text: string, path: number[], ctx: Ctx, keyBase: string): ReactNode {
  const segs = ctx.segs.get(pathKey(path))
  if (!segs || !segs.length || !ctx.anchored) return text
  const out: ReactNode[] = []
  let cursor = 0
  for (let si = 0; si < segs.length; si++) {
    const seg = segs[si]
    if (seg.nodeStart > cursor) out.push(<Fragment key={`${keyBase}p${si}`}>{text.slice(cursor, seg.nodeStart)}</Fragment>)
    const runs = opsInRange(ctx.anchored, seg.flatStart, seg.flatStart + seg.len)
    for (let ri = 0; ri < runs.length; ri++) out.push(runNode(runs[ri], `${keyBase}s${si}r${ri}`, ctx.hooks))
    cursor = seg.nodeStart + seg.len
  }
  if (cursor < text.length) out.push(<Fragment key={`${keyBase}tail`}>{text.slice(cursor)}</Fragment>)
  return <>{out}</>
}

/** A citation renders as DocView's purple label — and, being one flat-text run, splits like any leaf. */
function citationInline(node: Node, path: number[], ctx: Ctx, key: string): ReactNode {
  const keys = (node.attrs?.citekeys as string[] | undefined) ?? []
  if (!keys.length) return null
  const items = keys.map((k) => bibProvider.get(k)).filter((x): x is CSLItem => !!x)
  const label = items.length ? simpleInText(items) : `(${keys.join('; ')})`
  return <span key={key} style={{ color: 'var(--iw-cite-color, #302438)' }}>{splitLeaf(label, path, ctx, key)}</span>
}

function inline(nodes: Node[] | undefined, base: number[], ctx: Ctx): ReactNode {
  return (nodes ?? []).map((n, i) => {
    const path = [...base, i]
    const key = pathKey(path)
    if (n.type === 'hardBreak') return <br key={key} />
    if (n.type === 'text') return <Fragment key={key}>{applyMarks(splitLeaf(n.text ?? '', path, ctx, key), n.marks)}</Fragment>
    if (n.type === 'citation') return citationInline(n, path, ctx, key)
    return <Fragment key={key}>{inline(n.content, path, ctx)}</Fragment>
  })
}

function block(node: Node, path: number[], ctx: Ctx): ReactNode {
  const kids = node.content
  const key = pathKey(path)
  const body = (): ReactNode => inline(kids, path, ctx)
  switch (node.type) {
    case 'heading': {
      const level = Number(node.attrs?.level ?? 2)
      const Tag = (`h${Math.min(6, Math.max(1, level))}`) as keyof JSX.IntrinsicElements
      return <Tag key={key}>{body()}</Tag>
    }
    case 'bulletList':
      return <ul key={key}>{(kids ?? []).map((c, i) => block(c, [...path, i], ctx))}</ul>
    case 'orderedList':
      return <ol key={key}>{(kids ?? []).map((c, i) => block(c, [...path, i], ctx))}</ol>
    // A listItem IS a flat-text block (pmToText matches it BEFORE recursing, flattening any nested
    // paragraph into it) — so its gap dels belong to it, and its children still render as DocView's.
    case 'listItem':
      return <li key={key}>{(kids ?? []).map((c, i) => block(c, [...path, i], ctx))}</li>
    case 'blockquote':
      return <blockquote key={key}>{(kids ?? []).map((c, i) => block(c, [...path, i], ctx))}</blockquote>
    case 'codeBlock':
      return <pre key={key}><code>{body()}</code></pre>
    case 'paragraph':
      return <p key={key}>{body()}</p>
    case 'mediaImage':
      return <figure key={key} className="iw-media-image" style={storedMediaFigureStyle(node.attrs as unknown as StoredMediaImageAttrs)}><StoredMediaFigureContents attrs={node.attrs as unknown as StoredMediaImageAttrs} /></figure>
    default:
      return kids ? <Fragment key={key}>{kids.map((c, i) => block(c, [...path, i], ctx))}</Fragment> : null
  }
}

/**
 * Build the per-leaf seg index, and find any del NO block will claim.
 *
 * Segs tile a block's [flatStart, flatEnd) exactly (proved in textMap.test.ts), so `opsInRange`
 * catches every del anchored inside a block when that block renders. An ORPHAN is a del outside
 * every block's range — in practice only reachable when cur has no blocks at all.
 */
function indexOf(doc: TiptapJSON, ops: readonly DiffOp[] | null): { segs: Map<string, FlatSeg[]>; anchored: AnchoredOp[] | null; orphans: AnchoredOp[] } {
  const map = buildFlatMap(doc, true)
  const anchored = ops ? anchorOps(ops) : null
  const segs = new Map<string, FlatSeg[]>()
  for (const b of map.blocks) {
    for (const s of b.segs) {
      const k = pathKey(s.path)
      const arr = segs.get(k)
      if (arr) arr.push(s); else segs.set(k, [s])
    }
  }
  const orphans: AnchoredOp[] = []
  if (anchored) {
    for (const op of anchored) {
      if (op.type !== 'del') continue
      const claimed = map.blocks.some((b) => op.curStart >= b.flatStart && op.curStart < b.flatEnd)
      if (!claimed) orphans.push(op)
    }
  }
  return { segs, anchored, orphans }
}

/**
 * The rich diff. `ops === null` (the first snapshot) renders the document with no marks — identical
 * output to DocView, which is what makes the first version and every other version finally agree.
 */
export function RichDiffView({ doc, ops, hooks = {} }: { doc: TiptapJSON; ops: readonly DiffOp[] | null; hooks?: RichDiffHooks }) {
  const { segs, anchored, orphans } = indexOf(doc, ops)
  const ctx: Ctx = { segs, anchored, hooks }
  const top = (doc as Node).content ?? []
  return <>
    {top.map((n, i) => block(n, [i], ctx))}
    {orphans.length > 0 && <p>{orphans.map((op, i) => runNode(op, `orphan${i}`, ctx.hooks))}</p>}
  </>
}
