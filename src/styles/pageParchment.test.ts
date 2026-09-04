import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repo = resolve(__dirname, '../..')
const read = (path: string) => readFileSync(resolve(repo, path), 'utf8')
const css = read('src/styles/index.css')

function hslLightness(hex: string): number {
  const channels = hex.match(/[0-9a-f]{2}/gi)!.map((part) => parseInt(part, 16))
  return (Math.max(...channels) + Math.min(...channels)) / 2
}

describe('day page parchment', () => {
  it('is less yellow without becoming lighter', () => {
    expect(hslLightness('#f3f1ec')).toBe(hslLightness('#f7f2e8'))
    expect(css).not.toContain('#f7f2e8')
    expect(css.match(/background-color: #f3f1ec/g)).toHaveLength(2)
    expect(css).toContain('background-color: #e9e7e3')
    expect(css).not.toContain('#f1eadb')
  })

  it('uses the same neutral parchment for static pages and document-derived cards', () => {
    expect(read('src/routes/pageChrome.ts')).toContain("PAGE_PARCHMENT = '#f3f1ec'")
    expect(read('src/routes/SnapshotView.tsx')).toContain('var(--iw-snap-map-page, #f3f1ec)')
    expect(read('src/editor/suggestions/ThesaurusPopover/ThesaurusPopover.tsx')).toContain('var(--iw-paper, #f3f1ec)')
  })
})
