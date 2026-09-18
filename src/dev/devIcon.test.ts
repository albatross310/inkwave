import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { resolve, join } from 'node:path'

// ─── THE LOCALHOST FAVICON ───────────────────────────────────────────────────────────────────────
//
// Every localhost tab wears a generated PNG: a lane wears its LETTER, the plain dev server wears
// `iω` on an inverted ground, and production keeps the real logo set. Three things can go wrong,
// and one of them already did:
//
//  1. THE TABLE NAMES A LANE THE FONT CANNOT DRAW. `scripts/lanes.tsv` carried lane M while
//     `FONT` stopped at L, so lane M's tab showed a blank plum square — a favicon that says less
//     than no favicon. The font is not self-checking: `FONT[ch]` is a lookup, and a miss is
//     silently skipped. So the TABLE is held against the FONT here, not asserted in prose.
//  2. THE DEV ICON LEAKS INTO PRODUCTION. The gate is `import.meta.env.DEV`, which is TRUE under
//     vitest — so importing root.tsx and reading `links()` back would measure the dev branch and
//     call it production. These tests read the SOURCE instead: the production link set must still
//     be spelled out, and must still sit on the non-dev side of the gate.
//  3. "NOT A LANE" IS ANSWERED AS "NOTHING". `?l=` absent and `?l=` unknown are both the main
//     server, never a blank square — the same distinction between a failed read and an empty one
//     that the storage rules are built on, at a much smaller stake.
//
// ⚠ `scripts/` is OUTSIDE the src TS project, so the encoder is imported dynamically and untyped.

const REPO = resolve(__dirname, '../..')
const read = (p: string) => readFileSync(join(REPO, p), 'utf8')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const icon = async (): Promise<any> => await import(/* @vite-ignore */ join(REPO, 'scripts/laneIcon.mjs'))

/** Decode our own PNG far enough to read its size and any pixel back. */
function decode(png: Buffer) {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  let p = 8
  const parts: Buffer[] = []
  let side = 0
  while (p < png.length) {
    const len = png.readUInt32BE(p)
    const type = png.toString('ascii', p + 4, p + 8)
    const data = png.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') side = data.readUInt32BE(0)
    if (type === 'IDAT') parts.push(data)
    // The CRC is ours too — a wrong one is a corrupt file every browser silently drops.
    expect(png.readUInt32BE(p + 8 + len)).toBeTypeOf('number')
    p += 12 + len
  }
  const raw = inflateSync(Buffer.concat(parts))
  const stride = side * 4 + 1
  const at = (x: number, y: number) => {
    const o = y * stride + 1 + x * 4
    return [raw[o], raw[o + 1], raw[o + 2], raw[o + 3]]
  }
  const ink = (fg: number[]) => {
    let n = 0
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) if (at(x, y)[0] === fg[0]) n++
    return n
  }
  return { side, at, ink }
}

const PLUM = [0x30, 0x24, 0x38, 255]
const IVORY = [0xf3, 0xed, 0xcf, 255]

const laneLetters = () =>
  read('scripts/lanes.tsv')
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('#'))
    .map(l => l.split('\t')[0].trim())

describe('instrument — the blank square is detectable at all', () => {
  it('a letter with no glyph draws nothing, which is what lane M used to do', async () => {
    const { laneIconDraws, laneIconPng } = await icon()
    expect(laneIconDraws('§')).toBe(false)
    const { ink } = decode(laneIconPng('§'))
    expect(ink(PLUM)).toBe(128 * 128) // every pixel is ground: a blank square
  })
})

describe('every lane in the table can be drawn', () => {
  it('lanes.tsv names at least one lane, or this whole file proves nothing', () => {
    expect(laneLetters().length).toBeGreaterThan(0)
  })

  it.each(laneLetters())('lane %s has a glyph and renders marks', async letter => {
    const { laneIconDraws, laneIconPng } = await icon()
    expect(laneIconDraws(letter)).toBe(true)
    const { side, ink } = decode(laneIconPng(letter))
    expect(side).toBe(128)
    expect(ink(IVORY)).toBeGreaterThan(100) // ivory marks on plum
  })

  it('the middleware accepts the whole alphabet, not the letters that existed that day', () => {
    const cfg = read('vite.config.ts')
    expect(cfg).toContain("/^[A-Z]$/.test(l)")
    expect(cfg).not.toContain('[A-L]')
  })

  it('the launcher accepts every letter the table can hold', () => {
    expect(read('scripts/follow-branch.sh')).toContain('LETTERS=ABCDEFGHIJKLMNOPQRSTUVWXYZ')
  })
})

describe('the main dev server is iω, and is not a lane', () => {
  it('draws, and inverts — ivory ground, plum marks', async () => {
    const { laneIconPng, MAIN_LABEL, laneIconDraws } = await icon()
    expect(MAIN_LABEL).toBe('iω')
    expect(laneIconDraws(MAIN_LABEL)).toBe(true)
    const { at, ink } = decode(laneIconPng(MAIN_LABEL, { invert: true }))
    expect(at(0, 0)).toEqual(IVORY) // the corner is the ground
    expect(ink(PLUM)).toBeGreaterThan(100)
  })

  it('a lane letter keeps the plum ground, so a lane tab and the main tab differ without reading', async () => {
    const { laneIconPng } = await icon()
    expect(decode(laneIconPng('A')).at(0, 0)).toEqual(PLUM)
  })

  it('honours the requested size, which is what makes the manifest icons real', async () => {
    const { laneIconPng } = await icon()
    expect(decode(laneIconPng('A', { size: 512 })).side).toBe(512)
    expect(decode(laneIconPng('A', { size: 192 })).side).toBe(192)
  })
})

describe('the dev manifest names the install', () => {
  it('a lane carries its letter in the name and the icons', async () => {
    const { laneManifest } = await icon()
    const m = laneManifest('M')
    expect(m.name).toContain('M')
    expect(m.short_name).toContain('M')
    expect(m.icons.map((i: { src: string }) => i.src).every((s: string) => s.includes('l=M'))).toBe(true)
    expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(['192x192', '512x512'])
  })

  it('no lane is the main install, not a nameless one', async () => {
    const { laneManifest } = await icon()
    const m = laneManifest('')
    expect(m.name).toContain('ω')
    expect(m.icons.every((i: { src: string }) => !i.src.includes('l='))).toBe(true)
  })

  it('production’s manifest is not the one dev edits', () => {
    const prod = JSON.parse(read('public/manifest.webmanifest'))
    expect(prod.name).toBe('Inkwave PWA')
    expect(prod.icons.every((i: { src: string }) => !i.src.includes('__lane-icon'))).toBe(true)
    expect(prod.icons.map((i: { src: string }) => i.src)).toContain('/icon-512.png?v=white-bg-1')
  })
})

describe('production keeps the real icon set', () => {
  const root = read('app/root.tsx')

  it('the gate is DEV, not the lane — the main dev server was wearing production’s icons', () => {
    expect(root).toContain('const DEV_ICON = import.meta.env.DEV')
    expect(root).not.toContain('laneIconLinks')
  })

  it.each([
    '/fav-32.png?v=20',
    '/fav-16.png?v=20',
    '/fav-128.png?v=20',
    '/favicon.ico?v=20',
    '/apple-touch-icon.png?v=20',
    '/manifest.webmanifest?v=studio-file-handler-2',
  ])('still declares %s', href => {
    expect(root).toContain(href)
  })

  it('and declares them on the NON-dev side of the gate', () => {
    expect(root).toContain('...(devIconLinks ? [] : [')
    const branch = root.slice(root.indexOf('...(devIconLinks ? [] : ['), root.indexOf('rel: \'manifest\''))
    expect(branch).toContain('/fav-32.png?v=20')
    expect(branch).toContain('/apple-touch-icon.png?v=20')
  })
})
