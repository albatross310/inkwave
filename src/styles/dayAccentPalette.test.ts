import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isTestFile, stripComments } from './colourScan'

const REPO = resolve(__dirname, '../..')
const ROOTS = ['app', 'src', 'extension-src', 'public']
const LEGACY_UQ_PURPLE = /#(?:5c2d8a|9b5ccc|7a4fb0|6f3b9e|35283e|484965)(?:[0-9a-f]{2})?\b|rgba\(\s*(?:92\s*,\s*45\s*,\s*138|155\s*,\s*92\s*,\s*204|53\s*,\s*40\s*,\s*62)\b/i

function productFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(REPO, dir))) {
    const rel = `${dir}/${name}`
    const path = join(REPO, rel)
    let directory = false
    try {
      directory = statSync(path).isDirectory()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    if (directory) {
      if (!['.output', 'build', 'node_modules', '__snapshots__'].includes(name)) productFiles(rel, out)
      continue
    }
    if (!/\.(?:css|html|ts|tsx)$/.test(rel) || isTestFile(rel) || rel === 'src/styles/colourScan.ts') continue
    out.push(rel)
  }
  return out
}

function productText(file: string): string {
  try {
    return readFileSync(join(REPO, file), 'utf8')
  } catch (error) {
    // Some boundary tests briefly create product-shaped fixtures in src and remove them again.
    // A fixture disappearing between directory enumeration and this read is not palette evidence.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

describe('day accent palette', () => {
  const css = readFileSync(join(REPO, 'src/styles/index.css'), 'utf8')

  it('ties the primary UI ink to the water gradient and keeps one restrained companion', () => {
    expect(css).toContain('--iw-water-gradient: linear-gradient(165deg, #302438 0%, #41425b 18%, #3b606a 88%, #3b6f75 100%)')
    expect(css).toContain(':root { --iw-ink: #302438; }')
    expect(css).toContain(':root { --iw-ink-rgb: 48 36 56; }')
    expect(css).toContain('--iw-light: #41425b;')
    expect(css).toContain('--iw-doc-accent: #302438;')
    expect(css).toContain('--iw-reader-accent: #302438;')
    expect(css).toContain('--iw-snap-ink: #302438;')
  })

  it('does not let the former university-purple family return to product code', () => {
    const offenders = ROOTS.flatMap((root) => productFiles(root))
      .filter((file) => LEGACY_UQ_PURPLE.test(stripComments(productText(file))))
    expect(offenders).toEqual([])
  })
})
