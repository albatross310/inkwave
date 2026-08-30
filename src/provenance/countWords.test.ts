// KEEPS THE LEAF A LEAF — ~5ms, no browser.
//
// `countWords.ts` exists to be importable from `bundle.ts` WITHOUT dragging the archive layer into
// the framework-free verifier's runtime graph (`verify/index.ts` imports `pmToText` from `bundle.ts`
// as a value). That property is invisible: nothing breaks, no test goes red, and no reviewer notices
// if someone adds `import { listSnapshots } from './snapshots'` here one afternoon — it would simply
// re-create the coupling the file was written to avoid, silently.
//
// So the property is asserted rather than trusted. This is the cheap unit-level version of a claim
// that would otherwise live only in a comment.
//
// ⚠ COMMENTS ARE STRIPPED BEFORE SCANNING, deliberately: the header above NAMES `./snapshots` in
// order to explain why it must not be imported, and a guard reading raw text would fire on its own
// documentation. That failure has bitten three lanes in this repo (noAutoDelete, claims,
// micBoundary) and the tempting fix each time is to delete the sentence. Judge what the code DOES.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { countWords } from './countWords'

const SRC = readFileSync(resolve(__dirname, 'countWords.ts'), 'utf8')
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
const CODE = stripComments(SRC)

/** Every `import …` statement that survives comment-stripping. */
const imports = [...CODE.matchAll(/^import\s+(type\s+)?[^\n]*from\s+'([^']+)'/gm)]
  .map((m) => ({ typeOnly: !!m[1], from: m[2] }))

describe('countWords stays a leaf', () => {
  // VOID GUARD. A scan that found no imports at all would pass every assertion below while proving
  // nothing — the file does have one, and if the regex stops matching it, this fails first.
  it('the scan can see the imports it reasons about', () => {
    expect(imports.length).toBeGreaterThan(0)
    expect(imports.map((i) => i.from)).toContain('../types/document')
  })

  it('imports NOTHING at runtime — type-only imports erase, value imports do not', () => {
    const runtime = imports.filter((i) => !i.typeOnly)
    expect(runtime, `runtime imports would travel into every consumer: ${runtime.map((r) => r.from).join(', ')}`)
      .toEqual([])
  })

  it('the comment stripper works, so the guard survives its own documentation', () => {
    // The header names `snapshots.ts` in prose, to explain why it must not be imported. Un-stripped,
    // a scan looking for that module would find it and fire on the explanation.
    expect(SRC).toContain('snapshots.ts')
    expect(CODE).not.toContain('snapshots.ts')
  })
})

describe('countWords — the word notion itself', () => {
  const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

  it('counts letter/digit runs, not whitespace-delimited tokens', () => {
    // The distinction that matters: punctuation is not a word, and a hyphenate is two.
    expect(countWords(doc('one two three'))).toBe(3)
    expect(countWords(doc('one — two'))).toBe(2)
    expect(countWords(doc('well-known'))).toBe(2)
    expect(countWords(doc('chapter 3'))).toBe(2)
  })

  it('walks nested content and joins across nodes', () => {
    expect(countWords({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'alpha beta' }] },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'gamma' }] }] },
      ],
    })).toBe(3)
  })

  it('an empty document is 0, not NaN', () => {
    expect(countWords({ type: 'doc', content: [] })).toBe(0)
    expect(countWords(doc(''))).toBe(0)
  })

  it('counts non-Latin scripts — \\p{L} is not [a-z]', () => {
    expect(countWords(doc('παρά δόξα'))).toBe(2)
  })
})
