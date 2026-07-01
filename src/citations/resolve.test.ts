import { describe, it, expect, beforeEach } from 'vitest'
import { bibProvider } from './bibProvider'
import { usedCitekeys, referenceListConfig, referenceListKeys, embedBibliography } from './resolve'
import type { InkwaveDocument, TiptapJSON, CSLItem } from '../types/document'

function item(id: string): CSLItem { return { id, type: 'book', title: id.toUpperCase() } }

function docJson(opts: { cited: string[]; ref?: { mode: string; manualKeys?: string[] } }): TiptapJSON {
  const content: unknown[] = [
    { type: 'paragraph', content: [
      { type: 'text', text: 'Hello ' },
      ...opts.cited.map(k => ({ type: 'citation', attrs: { citekeys: [k] } })),
    ] },
  ]
  if (opts.ref) content.push({ type: 'referenceList', attrs: { mode: opts.ref.mode, manualKeys: opts.ref.manualKeys ?? [] } })
  return { type: 'doc', content } as TiptapJSON
}

function makeDoc(json: TiptapJSON): InkwaveDocument {
  return {
    id: 'd1', title: 'T', contentJson: json, createdAt: '', updatedAt: '',
    schemaVersion: '0.1.0', scasLimitN: 'infinite', scasSessionSeed: 's',
  }
}

beforeEach(() => {
  bibProvider.setEntries([item('smith2020'), item('jones2021'), item('lee2019')], 'library')
})

describe('usedCitekeys', () => {
  it('collects in-text citation keys', () => {
    expect(usedCitekeys(docJson({ cited: ['smith2020', 'jones2021'] })).sort()).toEqual(['jones2021', 'smith2020'])
  })
})

describe('referenceListConfig', () => {
  it('returns null with no reference list', () => {
    expect(referenceListConfig(docJson({ cited: [] }))).toBeNull()
  })
  it('reads mode + manualKeys', () => {
    expect(referenceListConfig(docJson({ cited: [], ref: { mode: 'manual', manualKeys: ['lee2019'] } })))
      .toEqual({ mode: 'manual', manualKeys: ['lee2019'] })
  })
})

describe('referenceListKeys (mode resolution)', () => {
  it('cited: only used keys', () => {
    expect(referenceListKeys(docJson({ cited: ['smith2020'], ref: { mode: 'cited' } }))).toEqual(['smith2020'])
  })
  it('all: the whole library', () => {
    expect(referenceListKeys(docJson({ cited: ['smith2020'], ref: { mode: 'all' } })).sort())
      .toEqual(['jones2021', 'lee2019', 'smith2020'])
  })
  it('manual: only ticked keys', () => {
    expect(referenceListKeys(docJson({ cited: ['smith2020'], ref: { mode: 'manual', manualKeys: ['lee2019'] } }))).toEqual(['lee2019'])
  })
  it('defaults to cited when no reference list node', () => {
    expect(referenceListKeys(docJson({ cited: ['jones2021'] }))).toEqual(['jones2021'])
  })
})

describe('embedBibliography', () => {
  it('embeds the union of in-text keys and reference-list keys, sorted, deterministic', () => {
    // manual mode ticks lee2019; smith2020 is cited in-text → both must be embedded (both display).
    const doc = makeDoc(docJson({ cited: ['smith2020'], ref: { mode: 'manual', manualKeys: ['lee2019'] } }))
    const { doc: out, missing } = embedBibliography(doc)
    expect(missing).toEqual([])
    expect(out.bibliography!.entries.map(e => e.id)).toEqual(['lee2019', 'smith2020'])
    expect(out.bibliography!.source).toBe('library')
  })
  it('reports missing keys not in the provider or prior embed', () => {
    const doc = makeDoc(docJson({ cited: ['ghost2000'] }))
    const { missing } = embedBibliography(doc)
    expect(missing).toEqual(['ghost2000'])
  })
})
