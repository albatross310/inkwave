import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repo = resolve(__dirname, '../..')
const read = (path: string) => readFileSync(resolve(repo, path), 'utf8')

describe('footer chrome outlines', () => {
  it('hardcodes one grey for both circles and pills', () => {
    const css = read('src/styles/index.css')
    expect(css).toMatch(/\.iw-toolbar-outline,\s*\.iw-toolbar-circles \.w-9\.rounded-full\s*\{\s*border-color: #a8a29e !important;/)
  })

  it('marks the centre, left, and right pills and scopes every main-row circle', () => {
    expect(read('src/editor/TiptapEditor.tsx')).toContain('iw-nightable iw-touch-guard iw-toolbar-outline')
    expect(read('src/editor/TiptapEditor.tsx')).toContain('iw-toolbar-circles flex items-center')
    expect(read('src/components/ReceiptPanel.tsx')).toContain('iw-nightable iw-toolbar-outline')
    expect(read('src/components/SyncStatus.tsx')).toContain('iw-nightable iw-toolbar-outline')
  })

  it('gives the reconnect message a centred two-line state without an alert glyph', () => {
    const editor = read('src/editor/TiptapEditor.tsx')
    const sync = read('src/components/SyncStatus.tsx')
    expect(editor).toContain('label="Reconnect to keep saving"')
    expect(editor).not.toContain('label="⚠ Reconnect to keep saving"')
    expect(editor).toMatch(/label="Reconnect to keep saving"\s+multiline/)
    expect(sync).toContain('SIDE_PILL_TALL_H')
    expect(sync).toContain("multiline ? 'justify-center text-center whitespace-normal'")
    expect(sync).toContain('sidePillBottom(zoom, triggerHeight)')
  })
})
