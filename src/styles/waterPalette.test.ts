import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repo = resolve(__dirname, '../..')
const css = readFileSync(resolve(repo, 'src/styles/index.css'), 'utf8')
const root = readFileSync(resolve(repo, 'app/root.tsx'), 'utf8')
const twinkles = readFileSync(resolve(repo, 'src/editor/waveTwinkle.ts'), 'utf8')

describe('day water palette', () => {
  it('has one shared muted indigo-to-teal background definition', () => {
    expect(css.match(/--iw-water-gradient:/g)).toHaveLength(1)
    expect(css).toContain('--iw-water-base: #3f827e')
    expect(css).toContain('--iw-water-gradient: linear-gradient(98.5deg, #40506f 0%, #3f827e 100%)')
    expect(css).not.toMatch(/#00b4d8|#00bfa8|%2300b4d8|%2300bfa8/i)
  })

  it('routes every day water surface through the shared palette', () => {
    expect(css.match(/background-color: var\(--iw-water-base, #3f827e\)/g)?.length).toBeGreaterThanOrEqual(5)
    expect(css.match(/background-image: var\(--iw-water-gradient\)/g)?.length).toBeGreaterThanOrEqual(4)
    expect(css).toContain('var(--iw-wave-a), var(--iw-wave-b), var(--iw-water-gradient)')
  })

  it('keeps the browser chrome colour aligned with the shared water base', () => {
    expect(root).toContain('media="(prefers-color-scheme: light)" content="#3f827e"')
  })

  it('uses restrained blue-grey wave marks and muted brass glints', () => {
    expect(css).toContain("stop-color='%23b7c9c8'")
    expect(css).toContain("stroke='%23d5dede'")
    expect(twinkles).toContain("SPARK_COLOR = '#c3a86c'")
    expect(twinkles).toContain("SPARK_CORE = '#e8e0cf'")
    expect(twinkles).toContain("DASH_COLOR = '#b7c9c8'")
  })
})
