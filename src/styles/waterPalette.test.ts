import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repo = resolve(__dirname, '../..')
const css = readFileSync(resolve(repo, 'src/styles/index.css'), 'utf8')
const root = readFileSync(resolve(repo, 'app/root.tsx'), 'utf8')
const entry = readFileSync(resolve(repo, 'app/entry.client.tsx'), 'utf8')
const twinkles = readFileSync(resolve(repo, 'src/editor/waveTwinkle.ts'), 'utf8')

describe('day water palette', () => {
  it('has one shared muted indigo-to-teal background definition', () => {
    expect(css.match(/--iw-water-gradient:/g)).toHaveLength(1)
    expect(css).toContain('--iw-water-base: #3b6f75')
    expect(css).toContain('--iw-water-gradient: linear-gradient(98.5deg, #302438 0%, #41425b 18%, #3b606a 88%, #3b6f75 100%)')
    expect(css).not.toMatch(/#00b4d8|#00bfa8|%2300b4d8|%2300bfa8/i)
  })

  it('routes every day water surface through the shared palette', () => {
    expect(css.match(/background-color: var\(--iw-water-base, #3b6f75\)/g)?.length).toBeGreaterThanOrEqual(5)
    expect(css.match(/background-image: var\(--iw-water-gradient\)/g)?.length).toBeGreaterThanOrEqual(4)
    expect(css).toContain('var(--iw-wave-a), var(--iw-wave-b), var(--iw-water-gradient)')
  })

  it('keeps the browser chrome colour aligned with the shared water base', () => {
    expect(root).toContain('media="(prefers-color-scheme: light)" content="#3b6f75"')
  })

  it('holds a pure-white first paint until the complete water field is ready', () => {
    expect(css).toMatch(/:root:not\(\.iw-water-ready\),\s*:root:not\(\.iw-water-ready\) body \{ background-color: #fff; \}/)
    expect(css).toMatch(/:root:not\(\.iw-water-ready\) \.inkwave-editor-surface \{\s*background-color: #fff;/)
    expect(css).toMatch(/:root\[data-theme="night"\]:not\(\.iw-water-ready\) body,\s*:root\[data-theme="night"\]:not\(\.iw-water-ready\) \.inkwave-editor-surface \{/)
    expect(entry).toContain('const WATER_GATE_TIMEOUT_MS = 30_000')
    expect(entry).not.toContain('setTimeout(ready, 1500)')
    expect(entry).toContain("ready('complete')")
  })

  it('uses one warm-ivory hue for day waves, specks, and sparkles', () => {
    expect(css).toContain("stop-color='%23f3edcf'")
    expect(css).toContain("stroke='%23f3edcf'")
    expect(css).not.toMatch(/%23(?:b7c9c8|d5dede)/)
    expect(twinkles).toContain("SPARK_COLOR = '#f3edcf'")
    expect(twinkles).toContain("SPARK_CORE = '#f3edcf'")
    expect(twinkles).toContain("DASH_COLOR = '#f3edcf'")
  })
})
