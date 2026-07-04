import { describe, it, expect } from 'vitest'
import { pmToText, inkwaveFileName, composeTraceFile, parseTraceFile, bundleReadme, type ExportBundle, type BundleSummary } from './bundle'
import type { TiptapJSON } from '../types/document'

function minBundle(overrides: Partial<ExportBundle> = {}): ExportBundle {
  return {
    v: 1,
    exportedAt: '2026-07-01T00:00:00.000Z',
    document: {
      id: 'doc-1',
      title: 'Test',
      contentJson: { type: 'doc', content: [] } as TiptapJSON,
      createdAt: '2026-07-01T00:00:00.000Z',
      schemaVersion: '1',
    },
    receipts: [],
    snapshots: [],
    ...overrides,
  } as unknown as ExportBundle
}

describe('pmToText', () => {
  it('converts paragraphs separated by blank lines', () => {
    const doc: TiptapJSON = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph' }] },
      ],
    }
    expect(pmToText(doc)).toBe('Hello world\n\nSecond paragraph\n')
  })

  it('joins inline content and handles hardBreak', () => {
    const doc: TiptapJSON = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Line one' },
          { type: 'hardBreak' },
          { type: 'text', text: 'Line two' },
        ],
      }],
    }
    expect(pmToText(doc)).toBe('Line one\nLine two\n')
  })

  it('skips empty paragraphs', () => {
    const doc: TiptapJSON = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Real' }] },
      ],
    }
    expect(pmToText(doc)).toBe('Real\n')
  })

  it('handles nested content (blockquote)', () => {
    const doc: TiptapJSON = {
      type: 'doc',
      content: [{
        type: 'blockquote',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quoted text' }] }],
      }],
    }
    expect(pmToText(doc)).toBe('Quoted text\n')
  })
})

describe('inkwaveFileName', () => {
  it('slugifies the title and appends .studio', () => {
    expect(inkwaveFileName('My Great Essay')).toBe('my-great-essay.studio')
  })
  it('handles special characters', () => {
    expect(inkwaveFileName('Being & Time: A Study')).toBe('being-time-a-study.studio')
  })
  it('falls back to "untitled" for empty input', () => {
    expect(inkwaveFileName('')).toBe('untitled.studio')
  })
  it('trims leading and trailing hyphens', () => {
    expect(inkwaveFileName('   ---test---  ')).toBe('test.studio')
  })
  it('caps slug at 40 characters', () => {
    const long = 'a'.repeat(80)
    expect(inkwaveFileName(long)).toBe('a'.repeat(40) + '.studio')
  })
})

describe('composeTraceFile / parseTraceFile round-trip', () => {
  it('round-trips a simple bundle', () => {
    const bundle = minBundle({ text: 'The quick brown fox.' })
    const file = composeTraceFile(bundle)
    const back = parseTraceFile(file)
    expect(back.v).toBe(1)
    expect(back.exportedAt).toBe(bundle.exportedAt)
    expect(back.document.id).toBe('doc-1')
  })

  it('parseTraceFile handles legacy pure-JSON (no text header)', () => {
    const bundle = minBundle()
    const jsonOnly = JSON.stringify(bundle, null, 2)
    const back = parseTraceFile(jsonOnly)
    expect(back.v).toBe(1)
  })

  it('parseTraceFile accepts old inkwave.studio marker (backwards compat)', () => {
    const bundle = minBundle({ text: 'Some writing.' })
    const legacyFile = [
      'Some writing.',
      '',
      '══════════════════════════════════════════════════════════════',
      '══════ INKWAVE RECORD · verify at inkwave.studio/verify ══════',
      'Everything below is the structured record.',
      '══════════════════════════════════════════════════════════════',
      '',
      JSON.stringify(bundle, null, 2),
    ].join('\n')
    const back = parseTraceFile(legacyFile)
    expect(back.v).toBe(1)
    expect(back.exportedAt).toBe(bundle.exportedAt)
  })

  it('parseTraceFile rejects oversized files', () => {
    expect(() => parseTraceFile('x'.repeat(20_000_001))).toThrow('file too large')
  })

  it('composeTraceFile puts the marker before the JSON', () => {
    const file = composeTraceFile(minBundle({ text: 'Some writing here.' }))
    const markerIdx = file.indexOf('INKWAVE RECORD')
    const jsonIdx = file.indexOf('{')
    expect(markerIdx).toBeGreaterThan(0)
    expect(jsonIdx).toBeGreaterThan(markerIdx)
  })
})

describe('bundleReadme', () => {
  const summary: BundleSummary = {
    what: 'test',
    title: 'Being and Time',
    words: 120,
    snapshots: 4,
    signedReceipts: 7,
    bitcoinAnchored: 3,
    created: '2026-07-01T00:00:00.000Z',
    exported: '2026-07-01T01:00:00.000Z',
    verifyAt: 'https://inkwave.studio/verify',
    note: '',
  }

  it('always ends with a trailing newline', () => {
    expect(bundleReadme().endsWith('\n')).toBe(true)
    expect(bundleReadme(summary).endsWith('\n')).toBe(true)
  })

  it('includes the document title when a summary is provided', () => {
    const text = bundleReadme(summary)
    expect(text).toContain('Being and Time')
    expect(text).toContain('120')
    expect(text).toContain('4')
    expect(text).toContain('7')
    expect(text).toContain('3')
  })

  it('omits summary lines when no summary is given', () => {
    const text = bundleReadme()
    expect(text).not.toContain('Document')
    expect(text).not.toContain('Words')
  })

  it('always contains the verify URL', () => {
    expect(bundleReadme()).toContain('inkwave.studio/verify')
    expect(bundleReadme(summary)).toContain('inkwave.studio/verify')
  })
})
