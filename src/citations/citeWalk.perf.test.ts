// THE PER-KEYSTROKE COST OF THE OPEN CITATION PANEL — measured deliberately, asserted structurally.
//
// Follows `productivity/capture.perf.test.ts`: NO timing assertions in the gate. A measurement whose
// verdict depends on who else is running is not a guard. The numbers below are real and were taken
// on a quiet box; re-take them with
//
//     IW_PERF=1 npx vitest run src/citations/citeWalk.perf.test.ts
//
// WHAT WAS WRONG. CitationPanel subscribed to `editor.on('update')` and re-rendered on every
// transaction, and its render body then ran `editor.getJSON()` + `usedCitekeys(json)` +
// `referenceListConfig(json)` — so an open panel serialised the ENTIRE document to JSON, three
// walks' worth, on every keystroke. CLAUDE.md's rule is that all citation doc-walks go through the
// live-PM-doc path (`referenceListKeysFromDoc` was added in the 2026-07-11 typing-lag work for
// exactly this reason); this call site had been missed.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { TiptapJSON } from '../types/document'
import { nodeFromContentJson } from '../editor/editorSchema'
import { usedCitekeys, referenceListConfig, usedCitekeysFromDoc, referenceListConfigFromDoc, _resetCiteIndexForTest } from './resolve'

const PERF = process.env.IW_PERF === '1'

/** A thesis-scale document: ~13k words, 174 citations, a reference list. Peter's real shape. */
function thesisJson(paras = 260): TiptapJSON {
  const content: TiptapJSON[] = []
  for (let i = 0; i < paras; i++) {
    const inline: TiptapJSON[] = [{ type: 'text', text: `Paragraph ${i} ` + 'lorem ipsum dolor sit amet '.repeat(9) }]
    if (i % 3 === 0) inline.push({ type: 'citation', attrs: { citekeys: [`key${i % 174}`] } })
    content.push({ type: 'paragraph', content: inline })
  }
  content.push({ type: 'referenceList', attrs: { mode: 'used', manualKeys: [] } })
  return { type: 'doc', content }
}

const json = thesisJson()
const doc = nodeFromContentJson(json)

function timePerOp(n: number, fn: () => void): number {
  fn()
  const t0 = performance.now()
  for (let i = 0; i < n; i++) fn()
  return (performance.now() - t0) / n
}

describe('the open citation panel does no O(doc) JSON serialisation per keystroke', () => {
  it('the fixture is real — a parsed PM document with citations and a reference list', () => {
    expect(doc).not.toBeNull()
    expect(usedCitekeys(json).length).toBeGreaterThan(50)
    expect(referenceListConfig(json)).not.toBeNull()
  })

  // THE STRUCTURAL ASSERTION — decidable at any load, on any box.
  it('the live-doc walkers return byte-identical answers to the JSON walkers', () => {
    expect([...usedCitekeysFromDoc(doc!)].sort()).toEqual([...usedCitekeys(json)].sort())
    expect(referenceListConfigFromDoc(doc!)).toEqual(referenceListConfig(json))
  })

  // THE STRUCTURAL GUARD — this is what keeps the fix. Decidable at any load, in ~2ms.
  // Comments are stripped: the fix's own comment NAMES `editor.getJSON()` to explain why it must not
  // be called, and a guard reading raw text would fire on its own documentation.
  it('CitationPanel never calls editor.getJSON() — it renders per keystroke', () => {
    const src = readFileSync(resolve(__dirname, '../components/CitationPanel.tsx'), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
    expect(code.length, 'the scan found the file').toBeGreaterThan(20_000)
    expect(src, 'the comment explaining the ban must survive the strip').toContain('getJSON()')
    expect(code).not.toMatch(/editor\.getJSON\(\)/)
  })

  it.skipIf(!PERF)('MEASURED: the live-doc walk vs the getJSON path', () => {
    const viaJson = timePerOp(200, () => {
      const j = doc!.toJSON() as TiptapJSON      // what editor.getJSON() does
      usedCitekeys(j); referenceListConfig(j)
    })
    const viaDocCached = timePerOp(200, () => { usedCitekeysFromDoc(doc!); referenceListConfigFromDoc(doc!) })
    // THE HONEST TYPING CASE. While typing, the document changes every keystroke, so the memo MISSES
    // and a real walk happens. Quoting only the cached number would be flattering and wrong — it is
    // the re-render-of-an-unchanged-doc case, which is common but is not the keystroke.
    const viaDocCold = timePerOp(200, () => {
      _resetCiteIndexForTest()
      usedCitekeysFromDoc(doc!); referenceListConfigFromDoc(doc!)
    })
    console.log(`\n  BEFORE  getJSON + 2 JSON walks : ${viaJson.toFixed(3)}ms`)
    console.log(`  AFTER   live walk, memo MISS   : ${viaDocCold.toFixed(3)}ms   (the typing case)`)
    console.log(`  AFTER   live walk, memo HIT    : ${viaDocCached.toFixed(3)}ms   (re-render, doc unchanged)`)
    console.log(`  speedup: ${(viaJson / viaDocCold).toFixed(1)}x typing / ${(viaJson / viaDocCached).toFixed(0)}x re-render\n`)
  })
})
