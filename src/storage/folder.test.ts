// `readFileArchive` — the local folder's absent-vs-error mapping.
//
// This exists because the safety fix it guards has an obvious catastrophic failure mode in the
// OTHER direction: `showSaveFilePicker` creates the target file EMPTY, so if an empty file is
// classified as an error, `planWriteback` refuses, the merge gate never closes, and the writer can
// never save to a new file — ever. "The guard that makes saving impossible" is exactly what a
// safety change ships with when only its safe direction is tested. Both directions are pinned here.

import { describe, it, expect, vi } from 'vitest'
import { readFileArchive } from './folder'

// A minimal File System Access handle. `getFile` is the only member the function touches.
function handleFor(file: unknown): FileSystemFileHandle {
  return { getFile: async () => file } as unknown as FileSystemFileHandle
}
function fileOf(text: string): unknown {
  return { size: text.length, text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer }
}

const bundle = (snaps: unknown[]) => JSON.stringify({ version: 1, document: { id: 'd' }, snapshots: snaps })

describe('readFileArchive — absent vs error', () => {
  // ─── The outage direction ────────────────────────────────────────────────
  it('a 0-byte file is ABSENT — the picker just created it; the first save must proceed', async () => {
    const read = await readFileArchive(handleFor(fileOf('')))
    expect(read.status).toBe('absent')
  })

  it('a whitespace-only file is ABSENT, not a parse error', async () => {
    expect((await readFileArchive(handleFor(fileOf('  \n ')))).status).toBe('absent')
  })

  it('a missing file is ABSENT (NotFoundError by NAME, per notFound.ts)', async () => {
    const err = Object.assign(new Error('nope'), { name: 'NotFoundError' })
    const read = await readFileArchive({ getFile: async () => { throw err } } as unknown as FileSystemFileHandle)
    expect(read.status).toBe('absent')
  })

  // ─── The data-loss direction ─────────────────────────────────────────────
  it('a permission revoke is an ERROR — never an absence', async () => {
    const err = Object.assign(new Error('The request is not allowed'), { name: 'NotAllowedError' })
    const read = await readFileArchive({ getFile: async () => { throw err } } as unknown as FileSystemFileHandle)
    expect(read.status).toBe('error')
  })

  it('a corrupt/garbled body is an ERROR — "I could not decode it" never licenses replacing it', async () => {
    const read = await readFileArchive(handleFor(fileOf('  not json at all {{{')))
    expect(read.status).toBe('error')
  })

  // THE MUTATION THIS BLOCKS, and it is the tempting one: `isNotFound` matching the error's MESSAGE
  // as well as its name. A read failure whose text merely mentions the words would then be laundered
  // into an absence — and the next act is a write. notFound.ts documents this exact pressure.
  it('an error whose MESSAGE mentions NotFoundError is still an ERROR', async () => {
    const err = Object.assign(new Error('NotFoundError: while reading'), { name: 'AbortError' })
    const read = await readFileArchive({ getFile: async () => { throw err } } as unknown as FileSystemFileHandle)
    expect(read.status).toBe('error')
  })

  // ─── The ordinary path still works ───────────────────────────────────────
  it('a real bundle reads OK and yields its snapshots', async () => {
    const read = await readFileArchive(handleFor(fileOf(bundle([{ id: 's1', createdAt: '2026-07-01T00:00:00Z' }]))))
    expect(read.status).toBe('ok')
    if (read.status === 'ok') expect(read.snapshots).toHaveLength(1)
  })

  it('a bundle with no snapshots array reads OK with an empty archive', async () => {
    const read = await readFileArchive(handleFor(fileOf(JSON.stringify({ version: 1, document: { id: 'd' } }))))
    expect(read.status).toBe('ok')
    if (read.status === 'ok') expect(read.snapshots).toEqual([])
  })
})
