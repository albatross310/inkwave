import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ⚠ THE BRACE AUDIT (2026-09-18). One stray `}` in index.css closed `@layer base` early and let the
// layer's own closing brace end a phone-only @media block ~800 lines later — every rule between
// (the toolbar outline grey, the whole .iw-desktop-toolbar geometry, 16 ProseMirror rules, the
// :root sheet ramp, math-field) silently became phone-only. No test noticed because none of them
// asserts the ENCLOSING block. This one does: it walks the braces (comments stripped, since the
// prose quotes braces) and pins which at-rules wrap a handful of rules that must be desktop-wide.
const css = readFileSync(resolve(__dirname, 'index.css'), 'utf8')

function enclosing(css: string, needle: string): string[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  const lines = clean.split('\n')
  const stack: string[] = []
  for (const line of lines) {
    if (line.includes(needle)) return stack.map((h) => h.trim().replace(/\s*\{$/, ''))
    for (const ch of line) {
      if (ch === '{') stack.push(line)
      else if (ch === '}') stack.pop()
    }
  }
  throw new Error(`rule not found: ${needle}`)
}

const coarse = '@media (pointer: coarse) and (hover: none)'

describe('index.css block structure', () => {
  it('desktop-wide rules sit directly in @layer base, never inside the phone media block', () => {
    for (const rule of ['.iw-desktop-toolbar {', '.iw-toolbar-outline,', '.iw-desktop-sheet { font-size', '.ProseMirror p {']) {
      const wrap = enclosing(css, rule)
      expect(wrap, rule).not.toContain(coarse)
      expect(wrap[0], rule).toBe('@layer base')
    }
  })
  it('phone-only rules are inside the phone media block', () => {
    for (const rule of ['.iw-phone-sheet > button.w-full', '.iw-phone-sheet .text-\\[17px\\] {']) {
      expect(enclosing(css, rule), rule).toContain(coarse)
    }
  })
  it('braces balance with comments stripped', () => {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect((clean.match(/\{/g) ?? []).length).toBe((clean.match(/\}/g) ?? []).length)
  })
})
