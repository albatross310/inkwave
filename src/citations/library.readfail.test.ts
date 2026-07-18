// A FAILED READ OF THE CITATION LIBRARY MUST NOT WIPE IT — the 2026-07-15 shape, in the bibliography.
//
// FEATURE (Peter's words): "the native citations" — the saved-source library that replaced
// Zotero/BBT. BLAST RADIUS: LIVE on master, no flag. Device-scoped, spans every document — it is
// his WHOLE bibliography.
//
// THE COLLAPSE. `library.ts readFile()` ends `catch { return [] }` (and `Array.isArray? … : []`),
// so a transient OPFS fault, a corrupt library file, or a mid-read failure all answer "the library
// is empty" — indistinguishable from a first-time user who genuinely has none. `writeFile()` is a
// BLIND whole-file replace (no union — removal is a real op, so grow-only is wrong; the right guard
// is "never write to a target you could not read"). The two compose exactly as they did on 07-15:
//
//   1. disk holds 20 sources · 2. loadLibrary()'s readFile() transiently FAILS → [] → the
//   `if (items.length)` guard means bibProvider is NOT hydrated → it stays EMPTY · 3. the next
//   addToLibrary() — which the browser EXTENSION calls automatically on every visit (its own
//   comment: "the extension re-flushes its queue on every visit"), no user action required —
//   upserts ONE item and persistLibrary() writes [1] OVER the 20. Nineteen sources destroyed.
//
// These tests drive the REAL library module (real loadLibrary / addToLibrary / persistLibrary /
// bibProvider) against a MUTABLE fake OPFS whose read can be made to fail the way a real fault does,
// and assert THE BYTES ON DISK — because a mutation that "handled" the error and still wrote is
// exactly the bug.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import type { CSLItem } from '../types/document'

vi.mock('../storage/opfsWrite', () => ({
  writeOpfsFile: vi.fn(async (_path: string[], data: string) => { disk = String(data) }),
}))

// The fake disk: the library file's bytes, or a fault to throw on READ.
let disk: string | null = null
let readFault: Error | 'corrupt' | null = null

// A directory that EXISTS (create:true always succeeds — writeFile must be able to make it), whose
// file read is what we control. A missing file throws NotFoundError, the one honest absence.
function stubOpfs() {
  vi.stubGlobal('navigator', {
    storage: {
      getDirectory: async () => ({
        getDirectoryHandle: async () => ({
          getFileHandle: async () => ({
            getFile: async () => {
              if (readFault && readFault !== 'corrupt') throw readFault
              if (disk === null) { const e = new Error('nope'); e.name = 'NotFoundError'; throw e }
              return { text: async () => (readFault === 'corrupt' ? '{not json' : disk) }
            },
          }),
        }),
      }),
    },
  })
}

const item = (id: string): CSLItem => ({ id, type: 'article-journal', title: `Source ${id}` } as unknown as CSLItem)
const twenty = Array.from({ length: 20 }, (_, i) => item(`s${i}`))
const diskIds = (): string[] => (disk ? (JSON.parse(disk) as CSLItem[]).map((i) => i.id).sort() : [])

async function fresh() {
  vi.resetModules()
  const mod = await import('./library')
  mod._resetLibraryReady()
  const { bibProvider } = await import('./bibProvider')
  bibProvider.setEntries([], 'library') // cold in-memory library, like a fresh page load
  return mod
}

beforeEach(() => { disk = null; readFault = null; stubOpfs() })
afterEach(() => { vi.resetModules(); vi.unstubAllGlobals() })

describe('library persistence — a failed read must not become a wipe', () => {
  // ─── The known-positive: the harness can build and grow a real library ─────
  it('adds to an existing library WITHOUT losing what was there (healthy read)', async () => {
    disk = JSON.stringify(twenty)
    const lib = await fresh()
    await lib.loadLibrary()
    await lib.addToLibrary(item('NEW'))
    expect(diskIds()).toContain('NEW')
    expect(diskIds()).toHaveLength(21) // grew — the 20 survived
  })

  it('a first-ever library (no file) writes cleanly from empty — the OUTAGE direction', async () => {
    disk = null // genuinely absent
    const lib = await fresh()
    await lib.loadLibrary()
    await lib.addToLibrary(item('FIRST'))
    expect(diskIds()).toEqual(['FIRST'])
  })

  // ─── THE LOAD-BEARING TESTS: a failed read must not destroy the library ─────
  it('a TRANSIENT read fault does not let the next add wipe the library', async () => {
    disk = JSON.stringify(twenty)
    readFault = Object.assign(new Error('The operation failed'), { name: 'InvalidStateError' })
    const lib = await fresh()
    await lib.loadLibrary()          // hydration FAILS — bibProvider stays empty
    readFault = null                 // the fault passes
    await lib.addToLibrary(item('NEW')) // the extension's auto-flush, or a user re-adding
    // The 20 must still be on disk. On master this is ['NEW'] — nineteen sources gone.
    expect(diskIds()).toContain('s0')
    expect(diskIds().length).toBeGreaterThanOrEqual(20)
  })

  it('a CORRUPT library file is not treated as empty and overwritten', async () => {
    disk = JSON.stringify(twenty)
    readFault = 'corrupt' // the file is there but unparseable — a partial/half-synced write
    const lib = await fresh()
    await lib.loadLibrary()
    // The corrupt bytes must survive: "I could not read it" never licenses replacing it.
    const before = disk
    readFault = null
    await lib.addToLibrary(item('NEW')).catch(() => {})
    expect(disk).toBe(before) // unchanged — recoverable, not clobbered
  })

  it('removeFromLibrary cannot wipe the library after a failed read', async () => {
    disk = JSON.stringify(twenty)
    readFault = Object.assign(new Error('io'), { name: 'InvalidStateError' })
    const lib = await fresh()
    await lib.loadLibrary()
    readFault = null
    const { bibProvider } = await import('./bibProvider')
    bibProvider.upsert(item('ghost'), 'library') // a stray in-memory entry
    await lib.removeFromLibrary('ghost').catch(() => {})
    expect(diskIds().length).toBeGreaterThanOrEqual(20)
  })
})
