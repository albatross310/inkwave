// The lane favicon as a REAL PNG served by the dev server (vite.config.ts → /__lane-icon.png?l=A).
// Safari ignores a favicon swapped at runtime (a data-URI href written after load never repaints
// its tab — Peter, 2026-09-16: "the favicons are not working"), but it does fetch a fresh <link>
// URL at page load, so the letter is baked server-side and referenced from root.tsx's links().
// Node has no canvas; this is a minimal PNG encoder (zlib + CRC32) over a 5×7 bitmap font.
import { deflateSync } from 'node:zlib'

const FONT = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
}

const SIZE = 64, SCALE = 8, OX = 12, OY = 4
const BG = [0x30, 0x24, 0x38], FG = [0xf3, 0xed, 0xcf] // the water's plum, the marks' ivory

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

/** @param {string} letter one of FONT's keys; anything else draws a blank plum square */
export function laneIconPng(letter) {
  const glyph = FONT[letter] ?? []
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0 // filter: none
    for (let x = 0; x < SIZE; x++) {
      const gx = Math.floor((x - OX) / SCALE), gy = Math.floor((y - OY) / SCALE)
      const on = gy >= 0 && gy < 7 && gx >= 0 && gx < 5 && glyph[gy]?.[gx] === '#'
      const [r, g, b] = on ? FG : BG
      const o = y * (SIZE * 4 + 1) + 1 + x * 4
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
}

export const LANE_ICON_PATH = '/__lane-icon.png'
