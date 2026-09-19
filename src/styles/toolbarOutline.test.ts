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
    expect(sync).toContain('sidePillBottom(triggerHeight)')
  })

  it('lets browser zoom scale all footer chrome through normal layout', () => {
    const editor = read('src/editor/TiptapEditor.tsx')
    const sync = read('src/components/SyncStatus.tsx')
    const receipt = read('src/components/ReceiptPanel.tsx')
    for (const source of [editor, sync, receipt]) {
      expect(source).not.toContain('useZoomScale')
      expect(source).not.toMatch(/transform:\s*`scale\(\$\{zoom/)
    }
    expect(editor).toContain('const DESKTOP_TOOLBAR_WIDTH_PX = 318')
    expect(editor).toContain("width: `${DESKTOP_TOOLBAR_WIDTH_PX}px`")
    expect(editor).not.toContain('--iw-bar-budget')
    expect(editor).not.toContain('TOOLBAR_SIDE_RESERVE_PX')
    expect(editor).not.toContain('/ ${(zoom * 1.12).toFixed(4)}')
  })
})
