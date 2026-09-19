import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(__dirname, './index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const fillRules = [...css.matchAll(/\.inkwave-editor-surface\.iw-fill:not\(\.is-phone\)\s*\{([^}]*)\}/g)]
  .map((match) => match[1])

describe('desktop page centring', () => {
  it('reserves equal scrollbar gutters so the fitted paper stays centred in the visible pane', () => {
    expect(fillRules.some((body) => /scrollbar-gutter:\s*stable\s+both-edges\s*;/.test(body))).toBe(true)
    expect(fillRules.some((body) => /scrollbar-gutter:\s*stable\s*;/.test(body))).toBe(false)
  })
})
