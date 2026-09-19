import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repo = resolve(__dirname, '../..')
const css = readFileSync(resolve(repo, 'src/styles/index.css'), 'utf8')
const root = readFileSync(resolve(repo, 'app/root.tsx'), 'utf8')
const entry = readFileSync(resolve(repo, 'app/entry.client.tsx'), 'utf8')
const twinkles = readFileSync(resolve(repo, 'src/editor/waveTwinkle.ts'), 'utf8')

describe('day water palette', () => {
  it('has one default water palette plus the explicit second-window palette', () => {
    expect(css.match(/--iw-water-gradient:/g)).toHaveLength(2)
    expect(css).toContain('--iw-water-base: #3b6f75')
    expect(css).toContain('--iw-water-gradient: linear-gradient(165deg, #302438 0%, #41425b 18%, #3b606a 88%, #3b6f75 100%)')
    expect(css).toMatch(/:root\[data-iw-window-slot="2"\][\s\S]*?--iw-water-base: #403708;[\s\S]*?--iw-water-gradient: linear-gradient\(180deg, #8d3d15 0%, #6b3910 46%, #403708 100%\)/)
    expect(css).not.toMatch(/#00b4d8|#00bfa8|%2300b4d8|%2300bfa8/i)
  })

  it('routes every day water surface through the shared palette', () => {
    expect(css.match(/background-color: var\(--iw-water-base, #3b6f75\)/g)?.length).toBeGreaterThanOrEqual(5)
    expect(css.match(/background-image: var\(--iw-water-gradient\)/g)?.length).toBeGreaterThanOrEqual(4)
    expect(css).toContain('background-image: var(--iw-wave-a)')
    expect(css).toContain('background-image: var(--iw-wave-b)')
  })

  it('keeps the browser chrome colour aligned with the shared water base', () => {
    expect(root).toContain('media="(prefers-color-scheme: light)" content="#3b6f75"')
  })

  it('paints white first, then starts the complete water with the chosen tip and twinkles', () => {
    expect(css).toMatch(/:root:not\(\.iw-water-ready\),\s*:root:not\(\.iw-water-ready\) body \{ background-color: #ffffff; \}/)
    expect(css).toMatch(/:root:not\(\.iw-water-ready\) \.inkwave-editor-surface \{[\s\S]*?background-color: #ffffff;[\s\S]*?background-image: none;/)
    expect(css).toMatch(/:root:not\(\.iw-water-ready\) \.inkwave-editor-surface\.iw-wave-anim::before,[\s\S]*?visibility: hidden;[\s\S]*?animation-play-state: paused !important;/)
    expect(css).toMatch(/:root:not\(\.iw-water-ready\) \.iw-wave-twinkles,[\s\S]*?visibility: hidden;/)
    expect(css).toMatch(/:root:not\(\.iw-water-ready\) \.iw-boot-water \{[\s\S]*?background-color: #ffffff;[\s\S]*?background-image: none;/)
    expect(css).toMatch(/\.iw-boot-water::before \{[\s\S]*?animation: iw-wave-drift-l 1\.944s linear infinite;/)
    expect(css).toMatch(/\.iw-boot-water::after \{[\s\S]*?animation: iw-wave-drift-r 1\.944s linear infinite;/)
    expect(entry).toContain('const WATER_GATE_TIMEOUT_MS = 30_000')
    expect(entry).toContain("window.addEventListener('inkwave:loading-tip-ready'")
    expect(entry).toContain('Promise.all([tip, twinkles])')
    expect(entry).not.toContain('Promise.all([tiles, twinkles])')
    expect(entry).not.toContain('setTimeout(ready, 1500)')
    expect(entry).toContain("ready('complete')")
  })

  it('uses one warm-ivory hue for day waves, specks, and sparkles', () => {
    const dayWaveTiles = css.slice(css.indexOf('--iw-wave-a:'), css.indexOf('  .inkwave-editor-surface::before'))
    expect(dayWaveTiles.match(/stroke='%23f3edcf'/g)).toHaveLength(4)
    expect(css).not.toMatch(/%23(?:b7c9c8|d5dede)/)
    expect(dayWaveTiles).not.toContain('%3ClinearGradient')
    expect(dayWaveTiles).not.toContain("stroke='url(")
    expect(dayWaveTiles.match(/stroke-opacity='0\.48'/g)).toHaveLength(2)
    expect(twinkles).toContain("SPARK_COLOR = '#f3edcf'")
    expect(twinkles).toContain("SPARK_CORE = '#f3edcf'")
    expect(twinkles).toContain("DASH_COLOR = '#f3edcf'")
  })
})
