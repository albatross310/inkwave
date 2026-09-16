// THE INCREMENTAL BLOCK CACHE IS BYTE-IDENTICAL TO A FULL BUILD, AT LINE LEVEL. ~40ms, no browser.
//
// THE THEOREM (docs/archive/snapshot-scrub-rounds.md#tr-blockcache): `layoutParagraph` takes ONLY the
// block — no prefix, no preceding state — and `emitTextBlock` applies top/posBase/blockIdx/marker as
// pure OFFSETS after the layout exists. So reusing an identical block's geometry at new offsets is the
// SAME ARITHMETIC, not an approximation. `incremental.prove.mjs` (retired to docs/archive/probes/) held
// this in a browser on the 13k-word rich fixture; the <1s-for-116-versions number it also produced is a
// measurement and stays in the archive. The four things that must hold AT ONCE are the same here:
//   1. identical to the full build at LINE level, not merely at page starts;
//   2. the reuse rate beside the claim (a speedup at 0% reuse means something else was measured);
//   3. THE POISONED-CACHE NEGATIVE: corrupt a live entry ⇒ the output MUST change, or the hit path
//      never ran and every "identical" is vacuous;
//   4. both fixture extremes: nothing-changed (≈100% reuse) and changes-everywhere (≈0%).

import { describe, it, expect } from 'vitest'
import { Schema, type Node as PMNode } from '@tiptap/pm/model'
import { buildRenderModel, makeBlockLayoutCache, type RenderGeom, type RenderModel } from './textRender'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] },
    heading: { group: 'block', content: 'inline*', attrs: { level: { default: 1 } }, toDOM: () => ['h1', 0] },
    text: { group: 'inline' },
  },
})
const GEOM: RenderGeom = {
  pageWidthPx: 794, pageHeightPx: 1123, topMarginPx: 96, sideMarginPx: 96,
  contentWidthPx: 602, basePx: 18, ratio: 1.618, paraSpacingEm: 0.5,
}
// Deterministic proportional-ish stub: width depends on the character, so an edit that changes a word
// changes the wrap (a monospace stub would let many edits wrap identically and weaken the negatives).
const measure = (t: string, font: string) => {
  const m = font.match(/(\d+(?:\.\d+)?)px/); const size = m ? parseFloat(m[1]) : 18
  let w = 0
  for (const ch of t) w += (ch === ' ' ? 5 : 6 + (ch.charCodeAt(0) % 5)) * (size / 18)
  return w
}
const fontLoaded = () => true

const W = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau'.split(' ')
function rng(seed: number) { let s = seed; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648 }
function words(rnd: () => number, n: number) { const o: string[] = []; for (let i = 0; i < n; i++) o.push(W[Math.floor(rnd() * W.length)]); return o.join(' ') }

/** A 40-block document (headings every 10th block) from a seed; `edits` = set of block indices whose text is perturbed. */
function docFrom(seed: number, edits: Set<number> = new Set()): PMNode {
  const rnd = rng(seed)
  const content: unknown[] = []
  for (let i = 0; i < 40; i++) {
    const base = words(rnd, 40 + (i % 7) * 9)
    const text = edits.has(i) ? base.replace(/^\w+/, (m) => m + ' revised') : base
    content.push(i % 10 === 0
      ? { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: text.slice(0, 30) }] }
      : { type: 'paragraph', content: [{ type: 'text', text: text + '.' }] })
  }
  return schema.nodeFromJSON({ type: 'doc', content })
}

/** Line-level record — the whole geometry, not just page starts. */
const lineRecords = (m: RenderModel) => m.lines.map((l) => [l.top, l.pos, l.startChar, l.endChar, l.height, l.blockIdx, l.indentPx ?? 0, l.marker ?? ''])
const sig = (m: RenderModel) => JSON.stringify({ l: lineRecords(m), pages: m.pages, pageTop: m.pageTop, breaks: m.breaks })
// Blocks that went through the text layout (and so the cache); a placeholder never reaches it.
const textBlocks = (m: RenderModel) => m.blocks.filter((b) => b.kind === 'text').length

describe('incremental block cache vs the full build', () => {
  it('a doc with 2 of 40 blocks edited: incremental == full at LINE level, with the reuse rate to show for it', () => {
    const cache = makeBlockLayoutCache()
    const v0 = docFrom(7)
    buildRenderModel(v0, GEOM, measure, fontLoaded, { blockCache: cache }) // warm on v0 (all misses)
    expect(cache.stats.misses).toBeGreaterThan(30)

    const v1 = docFrom(7, new Set([5, 23]))
    const full = buildRenderModel(v1, GEOM, measure, fontLoaded, {})
    const h0 = cache.stats.hits, m0 = cache.stats.misses
    const inc = buildRenderModel(v1, GEOM, measure, fontLoaded, { blockCache: cache })
    const hits = cache.stats.hits - h0, misses = cache.stats.misses - m0
    expect(misses).toBe(2)                 // exactly the two edited blocks re-laid-out
    expect(hits).toBe(textBlocks(full) - 2)
    expect(textBlocks(full)).toBeGreaterThan(30) // the fixture is mostly laid-out prose, not placeholders
    expect(sig(inc)).toBe(sig(full))
    expect(inc.lines.length).toBeGreaterThan(80) // the comparison is over a real number of lines
  })

  it('the full build is itself deterministic (or the identity above would be luck)', () => {
    const d = docFrom(11)
    expect(sig(buildRenderModel(d, GEOM, measure, fontLoaded, {}))).toBe(sig(buildRenderModel(d, GEOM, measure, fontLoaded, {})))
  })

  it('POISONED-CACHE NEGATIVE: corrupting a live entry CHANGES the output — the hit path really runs', () => {
    const cache = makeBlockLayoutCache()
    const d = docFrom(3)
    const clean = sig(buildRenderModel(d, GEOM, measure, fontLoaded, { blockCache: cache }))
    // Poison one cached block: push every line down by a pixel.
    const [key, entry] = [...cache.map.entries()][4]
    const saved = entry.relTops.slice()
    entry.relTops = entry.relTops.map((t) => t + 1)
    const dirty = sig(buildRenderModel(d, GEOM, measure, fontLoaded, { blockCache: cache }))
    expect(dirty).not.toBe(clean)
    entry.relTops = saved
    const restored = sig(buildRenderModel(d, GEOM, measure, fontLoaded, { blockCache: cache }))
    expect(restored).toBe(clean) // reversible, not destructive
    expect(cache.map.has(key)).toBe(true)
  })

  it('FIXTURE EXTREMES: nothing-changed ⇒ 100% reuse; changes-everywhere ⇒ 0% reuse; both stay identical to full', () => {
    const cache = makeBlockLayoutCache()
    const v0 = docFrom(5)
    buildRenderModel(v0, GEOM, measure, fontLoaded, { blockCache: cache })

    let h0 = cache.stats.hits, m0 = cache.stats.misses
    const same = buildRenderModel(docFrom(5), GEOM, measure, fontLoaded, { blockCache: cache })
    expect(cache.stats.misses - m0).toBe(0)
    expect(cache.stats.hits - h0).toBe(textBlocks(same))
    expect(sig(same)).toBe(sig(buildRenderModel(docFrom(5), GEOM, measure, fontLoaded, {})))

    h0 = cache.stats.hits; m0 = cache.stats.misses
    const all = new Set(Array.from({ length: 40 }, (_, i) => i))
    const every = buildRenderModel(docFrom(5, all), GEOM, measure, fontLoaded, { blockCache: cache })
    expect(cache.stats.hits - h0).toBe(0)
    expect(cache.stats.misses - m0).toBe(textBlocks(every))
    expect(sig(every)).toBe(sig(buildRenderModel(docFrom(5, all), GEOM, measure, fontLoaded, {})))
  })

  it('the cache is keyed on CONTENT, never on position: the same block at a different offset is a hit', () => {
    const cache = makeBlockLayoutCache()
    buildRenderModel(docFrom(9), GEOM, measure, fontLoaded, { blockCache: cache })
    // Prepend a block: every original block moves down one slot and one position range, yet each hits.
    const shifted = schema.nodeFromJSON({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'A brand-new opening paragraph.' }] },
      ...(docFrom(9).toJSON() as { content: unknown[] }).content,
    ] })
    const h0 = cache.stats.hits, m0 = cache.stats.misses
    const inc = buildRenderModel(shifted, GEOM, measure, fontLoaded, { blockCache: cache })
    expect(cache.stats.misses - m0).toBe(1)
    expect(cache.stats.hits - h0).toBe(textBlocks(inc) - 1)
    expect(sig(inc)).toBe(sig(buildRenderModel(shifted, GEOM, measure, fontLoaded, {})))
  })

  it('evictions are counted, never silent (a bounded FIFO)', () => {
    const cache = makeBlockLayoutCache(8)
    buildRenderModel(docFrom(1), GEOM, measure, fontLoaded, { blockCache: cache })
    expect(cache.map.size).toBeLessThanOrEqual(8)
    expect(cache.stats.evicted).toBeGreaterThan(0)
  })
})
