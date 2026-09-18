// The localhost favicon as a REAL PNG served by the dev server (vite.config.ts → /__lane-icon.png).
// Safari ignores a favicon swapped at runtime (a data-URI href written after load never repaints
// its tab — Peter, 2026-09-16: "the favicons are not working"), but it does fetch a fresh <link>
// URL at page load, so the label is baked server-side and referenced from root.tsx's links().
//
// TWO LABELS, ONE ENCODER: a lane dev server wears its LETTER (`?l=M`), and the plain `pnpm dev`
// main server wears `iω` (MAIN_LABEL) INVERTED — ivory ground, plum marks. The inversion is the
// point: a lane tab and a main tab are then different at 16px without reading the glyph, and
// neither can be mistaken for live iwzero.me, which keeps the real logo set.
//
// ⚠ THE FONT IS THE GATE. `laneIconPng` draws only what FONT has; an unknown character is skipped,
// and a label of nothing but unknowns is a blank square that says less than no favicon at all.
// Lane M shipped in scripts/lanes.tsv while FONT stopped at L and drew exactly that. FONT now
// covers A–Z, and `src/dev/devIcon.test.ts` holds every lane letter in lanes.tsv against it.
//
// Node has no canvas; this is a minimal PNG encoder (zlib + CRC32) over a 5×7 bitmap font.
import { deflateSync } from 'node:zlib'

// Glyphs are rows of equal-length strings; WIDTH IS PER GLYPH (read off row 0), so the lowercase
// pair can be 3 and 7 columns wide beside the 5-column capitals.
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
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  // The main server's pair. Both sit on the x-height (rows 2–6) so they read as lowercase beside
  // the full-height lane capitals: the dot of the i is row 0, and ω's two lobes join at the middle
  // column that rises from the floor.
  i: ['.#.', '...', '.#.', '.#.', '.#.', '.#.', '.#.'],
  'ω': ['.......', '.......', '#.....#', '#..#..#', '#..#..#', '#.#.#.#', '.#...#.'],
}

const ROWS = 7
const GAP = 1                       // blank columns between glyphs, in font units
const PAD = 0.12                    // of the side, each edge — the glyph never touches the corner
const PLUM = [0x30, 0x24, 0x38]     // the water's plum
const IVORY = [0xf3, 0xed, 0xcf]    // the marks' ivory

export const MAIN_LABEL = 'iω'
export const LANE_ICON_PATH = '/__lane-icon.png'
export const LANE_MANIFEST_PATH = '/__lane-manifest.webmanifest'

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

/** Lay a label out as one wide bitmap: rows of '#'/'.' with GAP columns between glyphs. */
function compose(label) {
  const glyphs = [...label].map(ch => FONT[ch]).filter(Boolean)
  if (glyphs.length === 0) return []
  const rows = []
  for (let r = 0; r < ROWS; r++) rows.push(glyphs.map(g => g[r]).join('.'.repeat(GAP)))
  return rows
}

/**
 * @param {string} label one or more FONT keys; unknown characters are skipped
 * @param {{ invert?: boolean, size?: number }} [opts] invert = ivory ground (the main server)
 */
export function laneIconPng(label, opts = {}) {
  const { invert = false, size = 128 } = opts
  const SIDE = Math.max(16, Math.round(size))
  const rows = compose(label)
  const cols = rows[0]?.length ?? 0
  // One scale for both axes, so the glyph keeps its proportions and stays centred whatever the
  // label's width — a two-glyph label is simply drawn smaller, never cropped.
  const box = SIDE * (1 - 2 * PAD)
  const scale = cols ? Math.max(1, Math.floor(Math.min(box / cols, box / ROWS))) : 0
  const ox = Math.round((SIDE - cols * scale) / 2)
  const oy = Math.round((SIDE - ROWS * scale) / 2)
  const [bg, fg] = invert ? [IVORY, PLUM] : [PLUM, IVORY]

  const stride = SIDE * 4 + 1
  const raw = Buffer.alloc(stride * SIDE)
  for (let y = 0; y < SIDE; y++) {
    raw[y * stride] = 0 // filter: none
    for (let x = 0; x < SIDE; x++) {
      let on = false
      if (scale) {
        const gx = Math.floor((x - ox) / scale), gy = Math.floor((y - oy) / scale)
        on = gy >= 0 && gy < ROWS && gx >= 0 && gx < cols && rows[gy][gx] === '#'
      }
      const [r, g, b] = on ? fg : bg
      const o = y * stride + 1 + x * 4
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIDE, 0); ihdr.writeUInt32BE(SIDE, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
}

/** True when the label draws at least one mark — a blank square is never a useful favicon. */
export function laneIconDraws(label) {
  return compose(label).some(r => r.includes('#'))
}

/**
 * The DEV manifest (vite.config.ts → /__lane-manifest.webmanifest). An installed PWA takes its Dock
 * name and icon from here, so without it every localhost install was another "Inkwave PWA" wearing
 * the production logo — indistinguishable from the installed live app. public/manifest.webmanifest
 * is production's and is never touched by this.
 */
export function laneManifest(lane) {
  const label = lane || MAIN_LABEL
  const q = lane ? `l=${lane}&` : ''
  const icon = s => ({ src: `${LANE_ICON_PATH}?${q}s=${s}`, sizes: `${s}x${s}`, type: 'image/png', purpose: 'any' })
  return {
    name: lane ? `Inkwave lane ${lane}` : 'Inkwave dev iω',
    short_name: lane ? `IW ${lane}` : 'IW dev',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: lane ? '#302438' : '#f3edcf',
    theme_color: lane ? '#302438' : '#f3edcf',
    icons: [icon(192), icon(512)],
  }
}
