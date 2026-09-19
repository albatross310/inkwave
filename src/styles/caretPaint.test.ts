import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(__dirname, 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('editable caret paint', () => {
  it('does not derive the caret from a focused word whose original glyphs are transparent', () => {
    expect(css).toMatch(/\.ProseMirror\s*\{[^}]*caret-color:\s*var\(--iw-ink,\s*#302438\)/)
    expect(css).toMatch(/\.ProseMirror \*\s*\{[^}]*caret-color:\s*var\(--iw-ink,\s*#302438\)\s*!important/)
    expect(css).toMatch(/\.scas-focused[^}]*\{[^}]*color:\s*#40344a;[^}]*position:\s*static/)
    // The focused decoration's inline `color:transparent` is load-bearing for the reel, so the
    // root + containing-element declarations—not changing that glyph paint—are the safe fix.
  })

  it('uses high-contrast settled ink with native WebKit smoothing', () => {
    expect(css).toMatch(/\.ProseMirror\s*\{[^}]*-webkit-font-smoothing:\s*auto;[^}]*color:\s*#0d0d0d;/)
    expect(css).not.toMatch(/\.ProseMirror\s*\{[^}]*-webkit-font-smoothing:\s*antialiased;/)
    expect(css).toMatch(/@media print[\s\S]*?\.ProseMirror, \.ProseMirror \* \{ color: #0d0d0d !important; \}/)
  })
})
