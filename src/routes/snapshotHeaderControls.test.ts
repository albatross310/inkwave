import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./SnapshotView.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../styles/index.css', import.meta.url), 'utf8')

describe('snapshot top actions', () => {
  it('keeps the installed-window header out of native drag and route swipe handling', () => {
    expect(source).toContain('iw-snapshot-header z-50 flex items-center')
    expect(source).not.toContain('iw-snapshot-header z-50 flex items-center backdrop-blur')
    expect(source).toContain("closest?.('.iw-snapshot-header')")
    expect(css).toMatch(/\.iw-snapshot-header button\s*\{[\s\S]*?-webkit-app-region:\s*no-drag;[\s\S]*?touch-action:\s*manipulation;/)
  })

  it('retains all three real actions', () => {
    expect(source).toContain('onClick={toggleLineMode}')
    expect(source).toContain('await deleteSnapshot(docId, snapshot.id)')
    expect(source).toContain("onClick={() => navigate('/')}")
  })
})
