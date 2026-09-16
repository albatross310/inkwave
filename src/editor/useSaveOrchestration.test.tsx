// @vitest-environment jsdom
//
// CHARACTERIZATION of "saving" — the path from an edit to the record on disk: the one commit path,
// the lazily rebuilt document, and the single snapshot queue with its guarded archive read. BLAST
// RADIUS: LIVE, no flag, Peter's real thesis; this is THE DATA-LOSS FAMILY's front door (CLAUDE.md).
//
// WRITTEN BEFORE THE MOVE (2026-09-16, docs/REFACTOR-QUEUE.md item 3, seam 3) from the unmoved
// TiptapEditor.tsx, and run first against a BYTE-FOR-BYTE extraction of its lines (262 lines, two
// differences: the eager-load effect's `const docId = doc.id` dropped and its `[doc.id]` → `[docId]`)
// while TiptapEditor.tsx was still untouched — so every case below is an observation of the shipped
// behaviour, not a guarantee invented here.
//
// WHY A HARNESS AND NOT THE EDITOR. Rendering TiptapEditor in jsdom was tried by seam 1 and abandoned
// on evidence (eight missing platform APIs across three render layers — docs/RULES.md R5). The hook
// runs here with the storage and provenance layers mocked at the module boundary: `scheduleSave`
// (the debounced beat — its debounce and platform delays live in storage/opfs.ts and are NOT under
// test here), `readSnapshotArchive` (THE archive read), `createSnapshotIfChanged` / `stampSnapshot` /
// the OTS sweep, the bundle builder and downloaders. Nothing touches OPFS, IDB or the network.
// `saveOrchestrationWiring.test.ts` pins that the REAL editor still calls what this returns.
//
// ⚠ THE NAMED RULE (CLAUDE.md, "A failed READ is not an empty archive"): `snapshotsForAction` answers
// null on a failed read and every caller ABORTS — a manual snapshot, an export. The mutant that
// matters most is the one that answers `[]` instead: the exact shape of every incident in
// docs/archive/data-loss-incidents.md. It is m1 below, and it dies in three named tests.
//
// MUTATION-PROVED 2026-09-16, each applied to useSaveOrchestration.ts (the byte-identical extraction,
// before TiptapEditor.tsx was rewired), the named test(s) observed to fail, then reverted:
//   m1  snapshotsForAction: `return null` → `return []` on a failed read   → 3 fail (null not []; manual snapshot aborts; export aborts)
//   m2  createManualSnapshot chains off Promise.resolve(), not the queue    → 1 fails (concurrent calls serialise)
//   m3  createManualSnapshot: createSnapshotIfChanged BEFORE the read guard → 3 fail (read guard runs first; the abort; serialisation)
//   m4  enqueueSnapshotWork drops its `ensureDocFresh()`                    → 1 fails (rebuilds before work)
//   m5  commitDoc drops `scheduleSave(updated)`                             → 1 fails (commitDoc triple)
//   m6  ensureDocFresh never clears `docStaleRef`                           → 2 fail  (second call is cached; enqueue rebuilds first)
//   m7  eager load: on error `setSnapshots([])`                             → 1 fails (failed read keeps the list)
//   m8  save-failed: drop the once-per-session guard                        → 1 fails (private notice once)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useRef, type MutableRefObject } from 'react'
import type { InkwaveDocument, Snapshot, SnapshotMeta } from '../types/document'

// ─── the storage + provenance layers, mocked at the module boundary ──────────────────────────
vi.mock('../storage/opfs', () => ({ scheduleSave: vi.fn() }))
vi.mock('../storage/docSource', () => ({ markDocumentDirty: vi.fn(), markRecognisedSave: vi.fn() }))
vi.mock('../storage/openError', () => ({ reportOpenError: vi.fn() }))
vi.mock('../storage/onedrive', () => ({ oneDriveAccount: vi.fn() }))
vi.mock('../storage/folder', () => ({ fileSaveAvailable: vi.fn() }))
vi.mock('../provenance/snapshots', () => ({
  createSnapshotIfChanged: vi.fn(), readSnapshotArchive: vi.fn(), stampSnapshot: vi.fn(),
  drainUnstamped: vi.fn(), upgradePending: vi.fn(), patchSnapshotDiffSummary: vi.fn(),
  toSnapshotMeta: (s: Snapshot) => ({ id: s.id, documentId: s.documentId, createdAt: s.createdAt, ots: s.ots }),
}))
vi.mock('../provenance/summarise', () => ({ summariseDiff: vi.fn(async () => null) }))
vi.mock('../provenance/bundle', () => ({
  buildExportBundleWithPdfs: vi.fn(), bundleFilename: vi.fn(), downloadBundle: vi.fn(), downloadBundleGz: vi.fn(),
  pmToText: vi.fn(() => ''),
}))
vi.mock('../citations/resolve', () => ({ embedBibliography: (d: InkwaveDocument) => ({ doc: d, changed: false }) }))
vi.mock('./extensions/RedHighlightExtension', () => ({ getGreenAnchors: vi.fn(() => ['anchor-1']) }))

import { scheduleSave } from '../storage/opfs'
import { markDocumentDirty, markRecognisedSave } from '../storage/docSource'
import { reportOpenError } from '../storage/openError'
import { oneDriveAccount } from '../storage/onedrive'
import { fileSaveAvailable } from '../storage/folder'
import { createSnapshotIfChanged, readSnapshotArchive, stampSnapshot, drainUnstamped, upgradePending } from '../provenance/snapshots'
import { buildExportBundleWithPdfs, bundleFilename, downloadBundle, downloadBundleGz } from '../provenance/bundle'
import { useSaveOrchestration, type SaveOrchestration } from './useSaveOrchestration'

const m = <T extends (...a: never[]) => unknown>(f: T) => vi.mocked(f)
const doc = (id = 'doc-1', extra: Partial<InkwaveDocument> = {}): InkwaveDocument => ({
  id, title: 'Untitled', createdAt: '2026-09-16T00:00:00+10:00', updatedAt: '2026-09-16T00:00:00+10:00',
  contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] },
  ...extra,
} as InkwaveDocument)
const snap = (id: string, status: 'unstamped' | 'pending' | 'confirmed' = 'unstamped'): Snapshot => ({
  id, documentId: 'doc-1', createdAt: '2026-09-16T00:00:00+10:00', trigger: 'manual',
  contentJson: { type: 'doc', content: [] }, contentHash: 'h-' + id, bundleHash: 'b-' + id, receipts: [],
  ots: { status },
} as unknown as Snapshot)
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

/** A deferred promise — lets a test hold the archive read open to observe serialisation. */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

// ─── the harness: the component's refs and the cloud hook's outputs, as the editor hands them ───
interface Harness {
  docRef: MutableRefObject<InkwaveDocument>
  editorRef: MutableRefObject<FakeEditor | null>
  onDocChange: ReturnType<typeof vi.fn>
  setFileOpenError: ReturnType<typeof vi.fn>
  setLastFileSave: ReturnType<typeof vi.fn>
  setLastSync: ReturnType<typeof vi.fn>
  setLastGdriveSync: ReturnType<typeof vi.fn>
  mirrorIfActive: ReturnType<typeof vi.fn>
  saveToFile: ReturnType<typeof vi.fn>
  sessionRef: MutableRefObject<{ receipts: unknown[] } | null>
  scasRef: MutableRefObject<{ state: unknown } | undefined>
}
interface FakeEditor {
  isDestroyed: boolean
  getJSON: ReturnType<typeof vi.fn>
  state: { doc: { firstChild: { textContent: string } | null } }
}
const fakeEditor = (text = 'A first line of the essay'): FakeEditor => ({
  isDestroyed: false,
  getJSON: vi.fn(() => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })),
  state: { doc: { firstChild: { textContent: text } } },
})

function mount(initial: InkwaveDocument = doc(), docId = initial.id) {
  const h: Partial<Harness> = {}
  const r = renderHook(({ docId }: { docId: string }) => {
    const docRef = useRef(initial)
    const editorRef = useRef<FakeEditor | null>(null)
    const sessionRef = useRef<{ receipts: unknown[] } | null>(null)
    const scasRef = useRef<{ state: unknown } | undefined>({ state: { v: 1 } })
    const stable = useRef({
      onDocChange: vi.fn(), setFileOpenError: vi.fn(), setLastFileSave: vi.fn(), setLastSync: vi.fn(),
      setLastGdriveSync: vi.fn(), mirrorIfActive: vi.fn(), saveToFile: vi.fn(async () => {}),
    }).current
    Object.assign(h, { docRef, editorRef, sessionRef, scasRef, ...stable })
    return useSaveOrchestration({
      docRef, docId, editorRef: editorRef as never, scasRef: scasRef as never, sessionRef: sessionRef as never,
      ...stable,
    })
  }, { initialProps: { docId } })
  return { r, h: h as Harness, api: () => r.result.current as SaveOrchestration }
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  m(readSnapshotArchive).mockResolvedValue({ kind: 'ok', snapshots: [] } as never)
  m(fileSaveAvailable).mockReturnValue(false)
  m(oneDriveAccount).mockResolvedValue(null as never)
  m(stampSnapshot).mockResolvedValue(null as never)
  m(bundleFilename).mockReturnValue('essay.studio')
  m(buildExportBundleWithPdfs).mockResolvedValue({ v: 4 } as never)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  try { localStorage.clear() } catch { /* jsdom */ }
})
afterEach(cleanup)

// ─── commitDoc — THE ONE COMMIT PATH ─────────────────────────────────────────────────────────
describe('commitDoc: the one commit path', () => {
  it('does the triple in order — docRef, onDocChange, scheduleSave — and marks the mirrors stale', async () => {
    const { h, api } = mount()
    await flush()
    const order: string[] = []
    h.onDocChange.mockImplementation(() => order.push('onDocChange:' + (h.docRef.current.title)))
    m(scheduleSave).mockImplementation(() => order.push('scheduleSave'))
    const updated = doc('doc-1', { title: 'Renamed' })
    act(() => api().commitDoc(updated))
    expect(h.docRef.current).toBe(updated)
    expect(order).toEqual(['onDocChange:Renamed', 'scheduleSave']) // docRef was already updated when onDocChange ran
    expect(m(scheduleSave).mock.calls[0][0]).toBe(updated) // the document itself, not a thunk
    expect(m(markDocumentDirty)).toHaveBeenCalledWith('doc-1')
    expect(h.setLastFileSave).toHaveBeenCalledWith(null)
    expect(h.setLastSync).toHaveBeenCalledWith(null)
    expect(h.setLastGdriveSync).toHaveBeenCalledWith(null)
  })
})

// ─── ensureDocFresh — the lazy rebuild ───────────────────────────────────────────────────────
describe('ensureDocFresh: the lazily rebuilt document', () => {
  it('returns docRef untouched while nothing marked it stale — the editor is never read', async () => {
    const { h, api } = mount()
    await flush()
    h.editorRef.current = fakeEditor()
    const out = api().ensureDocFresh()
    expect(out).toBe(h.docRef.current)
    expect(h.editorRef.current.getJSON).not.toHaveBeenCalled()
    expect(h.setLastSync).not.toHaveBeenCalled()
  })

  it('once stale: rebuilds from the live editor (content, first-line title, anchors, SCAS state), writes docRef, returns it', async () => {
    const { h, api } = mount()
    await flush()
    h.editorRef.current = fakeEditor('The opening sentence')
    api().docStaleRef.current = true
    const before = h.docRef.current
    const out = api().ensureDocFresh()
    expect(out).not.toBe(before)
    expect(h.docRef.current).toBe(out)
    expect(out.title).toBe('The opening sentence')
    expect(out.contentJson).toEqual(h.editorRef.current.getJSON.mock.results[0].value)
    expect(out.scasGreenAnchors).toEqual(['anchor-1'])
    expect(out.scasState).toEqual({ v: 1 })
    expect(out.updatedAt).not.toBe(before.updatedAt)
    expect(m(markDocumentDirty)).toHaveBeenCalledWith('doc-1')
    expect(h.setLastFileSave).toHaveBeenCalledWith(null)
    expect(h.setLastSync).toHaveBeenCalledWith(null)
    expect(h.setLastGdriveSync).toHaveBeenCalledWith(null)
    // It is a CACHE, not a mutation: no onDocChange, no scheduleSave (commitDoc.test.ts's exception).
    expect(h.onDocChange).not.toHaveBeenCalled()
    expect(m(scheduleSave)).not.toHaveBeenCalled()
  })

  it('the second call is cached — the O(doc) build runs once per keystroke burst, not per consumer', async () => {
    const { h, api } = mount()
    await flush()
    h.editorRef.current = fakeEditor()
    api().docStaleRef.current = true
    const first = api().ensureDocFresh()
    const second = api().ensureDocFresh()
    expect(second).toBe(first)
    expect(h.editorRef.current.getJSON).toHaveBeenCalledTimes(1)
    expect(api().docStaleRef.current).toBe(false)
  })

  it('with no live editor it answers the last known document and STAYS stale (the build is owed, not skipped)', async () => {
    const { h, api } = mount()
    await flush()
    api().docStaleRef.current = true
    expect(api().ensureDocFresh()).toBe(h.docRef.current)
    expect(api().docStaleRef.current).toBe(true)
    h.editorRef.current = { ...fakeEditor(), isDestroyed: true }
    expect(api().ensureDocFresh()).toBe(h.docRef.current)
    expect(api().docStaleRef.current).toBe(true)
  })
})

// ─── snapshotsForAction — THE R1 READ GUARD ──────────────────────────────────────────────────
describe('snapshotsForAction: a failed read is not an empty archive', () => {
  it('answers the archive on a good read — an established emptiness is still []', async () => {
    const { api } = mount()
    await flush()
    m(readSnapshotArchive).mockResolvedValueOnce({ kind: 'ok', snapshots: [snap('s1')] } as never)
    expect(await api().snapshotsForAction('the export')).toEqual([snap('s1')])
    m(readSnapshotArchive).mockResolvedValueOnce({ kind: 'ok', snapshots: [] } as never)
    expect(await api().snapshotsForAction('the export')).toEqual([])
    expect(m(reportOpenError)).not.toHaveBeenCalled()
  })

  it('answers NULL — never [] — on a failed read, and tells the writer the action was cancelled', async () => {
    const { api } = mount()
    await flush()
    m(readSnapshotArchive).mockResolvedValueOnce({ kind: 'error', error: new Error('gunzip failed') } as never)
    const out = await api().snapshotsForAction('the export')
    expect(out).toBeNull()
    expect(out).not.toEqual([])
    expect(m(reportOpenError)).toHaveBeenCalledTimes(1)
    expect(m(reportOpenError).mock.calls[0][0]).toMatch(/the export was cancelled/)
  })
})

// ─── createManualSnapshot — THE ONE SNAPSHOT QUEUE ───────────────────────────────────────────
describe('createManualSnapshot: the one manual-snapshot funnel', () => {
  it('reads the archive THROUGH the guard before it writes, appends the snapshot, stamps it, then mirrors', async () => {
    const { h, api } = mount()
    await flush()
    const order: string[] = []
    m(readSnapshotArchive).mockImplementation(async () => { order.push('read'); return { kind: 'ok', snapshots: [snap('s0')] } as never })
    m(createSnapshotIfChanged).mockImplementation(async () => { order.push('create'); return snap('s1') as never })
    m(stampSnapshot).mockImplementation(async () => { order.push('stamp'); return snap('s1', 'pending') as never })
    h.mirrorIfActive.mockImplementation(() => order.push('mirror'))
    let result!: Awaited<ReturnType<SaveOrchestration['createManualSnapshot']>>
    await act(async () => { result = await api().createManualSnapshot() })
    expect(order).toEqual(['read', 'create', 'stamp', 'mirror'])
    expect(m(createSnapshotIfChanged).mock.calls[0].slice(1, 3)).toEqual(['manual', []])
    expect(m(createSnapshotIfChanged).mock.calls[0][4]).toBe(true) // manual = forced, even if the hash is unchanged
    expect(result.snapshot?.id).toBe('s1')
    expect(result.stamped).toBe(true)
    expect(result.reason).toBeUndefined()
    expect(api().snapshots.map((s: SnapshotMeta) => [s.id, s.ots?.status])).toEqual([['s1', 'pending']])
  })

  it('THE DATA-LOSS RULE: a failed archive read ABORTS — nothing is written, and the writer is told', async () => {
    const { h, api } = mount()
    await flush()
    m(readSnapshotArchive).mockResolvedValueOnce({ kind: 'error', error: new Error('unreadable') } as never)
    let result!: Awaited<ReturnType<SaveOrchestration['createManualSnapshot']>>
    await act(async () => { result = await api().createManualSnapshot() })
    expect(m(createSnapshotIfChanged)).not.toHaveBeenCalled()
    expect(m(stampSnapshot)).not.toHaveBeenCalled()
    expect(h.mirrorIfActive).not.toHaveBeenCalled()
    expect(result).toEqual({ snapshot: null, stamped: false, reason: 'Snapshot history is temporarily unavailable' })
    expect(m(reportOpenError)).toHaveBeenCalledTimes(1)
    expect(api().snapshots).toEqual([])
  })

  it('serialises concurrent calls through the one queue — the second read waits for the first to finish', async () => {
    const { api } = mount()
    await flush()
    m(readSnapshotArchive).mockClear() // the mount's eager list load is a read too — count from here
    const first = deferred<unknown>()
    m(readSnapshotArchive).mockReturnValueOnce(first.promise as never)
      .mockResolvedValueOnce({ kind: 'ok', snapshots: [] } as never)
    m(createSnapshotIfChanged).mockResolvedValueOnce(snap('s1') as never).mockResolvedValueOnce(snap('s2') as never)
    let p1!: Promise<unknown>, p2!: Promise<unknown>
    act(() => { p1 = api().createManualSnapshot(); p2 = api().createManualSnapshot() })
    await flush()
    expect(m(readSnapshotArchive)).toHaveBeenCalledTimes(1) // the second is queued behind the open read
    expect(m(createSnapshotIfChanged)).not.toHaveBeenCalled()
    await act(async () => { first.resolve({ kind: 'ok', snapshots: [] }); await p1; await p2 })
    expect(m(readSnapshotArchive)).toHaveBeenCalledTimes(2)
    expect(m(createSnapshotIfChanged).mock.calls.length).toBe(2)
    expect(api().snapshots.map((s: SnapshotMeta) => s.id)).toEqual(['s1', 's2'])
  })

  it('a failure inside one call is caught, reported as its reason, and does NOT wedge the queue', async () => {
    const { api } = mount()
    await flush()
    m(readSnapshotArchive).mockRejectedValueOnce(new Error('disk on fire'))
    let r1!: Awaited<ReturnType<SaveOrchestration['createManualSnapshot']>>
    await act(async () => { r1 = await api().createManualSnapshot() })
    expect(r1).toEqual({ snapshot: null, stamped: false, reason: 'disk on fire' })
    m(createSnapshotIfChanged).mockResolvedValueOnce(snap('s1') as never)
    let r2!: Awaited<ReturnType<SaveOrchestration['createManualSnapshot']>>
    await act(async () => { r2 = await api().createManualSnapshot() })
    expect(r2.snapshot?.id).toBe('s1')
  })

  it('snapshots a supplied frozen source, but refuses one whose id is not the active document', async () => {
    const { api } = mount()
    await flush()
    m(createSnapshotIfChanged).mockResolvedValueOnce(snap('s1') as never)
    const frozen = doc('doc-1', { title: 'the sent message' })
    await act(async () => { await api().createManualSnapshot(frozen) })
    expect(m(createSnapshotIfChanged).mock.calls[0][0]).toBe(frozen)
    let r!: Awaited<ReturnType<SaveOrchestration['createManualSnapshot']>>
    await act(async () => { r = await api().createManualSnapshot(doc('other-doc')) })
    expect(r.reason).toBe('The active document changed before it could be snapshotted')
    expect(m(createSnapshotIfChanged)).toHaveBeenCalledTimes(1)
  })

  it('reports honestly when the browser cannot snapshot, and when stamping failed but the snapshot exists', async () => {
    const { api } = mount()
    await flush()
    m(createSnapshotIfChanged).mockResolvedValueOnce(null as never)
    let r!: Awaited<ReturnType<SaveOrchestration['createManualSnapshot']>>
    await act(async () => { r = await api().createManualSnapshot() })
    expect(r).toEqual({ snapshot: null, stamped: false, reason: 'Provenance snapshots are unavailable on this browser' })
    m(createSnapshotIfChanged).mockResolvedValueOnce(snap('s1') as never)
    m(stampSnapshot).mockResolvedValueOnce(null as never)
    await act(async () => { r = await api().createManualSnapshot() })
    expect(r.snapshot?.id).toBe('s1')
    expect(r.stamped).toBe(false)
    expect(r.reason).toBe('Snapshot created locally; timestamping will retry later')
  })

  it('saveVersion is the button: it calls the funnel and discards the result', async () => {
    const { api } = mount()
    await flush()
    m(createSnapshotIfChanged).mockResolvedValueOnce(snap('s1') as never)
    await act(async () => { api().saveVersion(); await flush() })
    expect(m(createSnapshotIfChanged)).toHaveBeenCalledTimes(1)
  })
})

// ─── enqueueSnapshotWork — the queue every other writer shares ───────────────────────────────
describe('enqueueSnapshotWork: every snapshot write rides one chain', () => {
  it('rebuilds the document (ensureDocFresh) before the work runs', async () => {
    const { h, api } = mount()
    await flush()
    h.editorRef.current = fakeEditor()
    api().docStaleRef.current = true
    let freshWhenWorkRan: boolean | null = null
    await act(async () => {
      api().enqueueSnapshotWork(async () => { freshWhenWorkRan = api().docStaleRef.current === false })
      await flush()
    })
    expect(freshWhenWorkRan).toBe(true)
    expect(h.editorRef.current.getJSON).toHaveBeenCalledTimes(1)
  })

  it('runs work in order and a rejected work does not break the chain', async () => {
    const { api } = mount()
    await flush()
    const ran: string[] = []
    const gate = deferred<void>()
    await act(async () => {
      api().enqueueSnapshotWork(async () => { await gate.promise; ran.push('a') })
      api().enqueueSnapshotWork(async () => { ran.push('b'); throw new Error('b failed') })
      api().enqueueSnapshotWork(async () => { ran.push('c') })
      await flush()
    })
    expect(ran).toEqual([])
    await act(async () => { gate.resolve(); await flush() })
    expect(ran).toEqual(['a', 'b', 'c'])
    expect(console.warn).toHaveBeenCalledWith('[inkwave] snapshot work failed:', expect.any(Error))
  })
})

// ─── the eager snapshot-list load ────────────────────────────────────────────────────────────
describe('the snapshot list loads eagerly, per document', () => {
  it('reads the archive on mount and holds METADATA only', async () => {
    m(readSnapshotArchive).mockResolvedValueOnce({ kind: 'ok', snapshots: [snap('s1'), snap('s2', 'confirmed')] } as never)
    const { api } = mount()
    await flush()
    expect(m(readSnapshotArchive)).toHaveBeenCalledWith('doc-1')
    expect(api().snapshots).toEqual([
      { id: 's1', documentId: 'doc-1', createdAt: '2026-09-16T00:00:00+10:00', ots: { status: 'unstamped' } },
      { id: 's2', documentId: 'doc-1', createdAt: '2026-09-16T00:00:00+10:00', ots: { status: 'confirmed' } },
    ])
    expect(api().snapshots[0]).not.toHaveProperty('contentJson')
  })

  it('a failed read KEEPS the list it had and says so — never "no snapshots yet" over a full archive', async () => {
    m(readSnapshotArchive).mockResolvedValueOnce({ kind: 'ok', snapshots: [snap('s1')] } as never)
    const { r, api } = mount()
    await flush()
    expect(api().snapshots.length).toBe(1)
    m(readSnapshotArchive).mockResolvedValueOnce({ kind: 'error', error: new Error('unreadable') } as never)
    r.rerender({ docId: 'doc-2' })
    await flush()
    expect(m(readSnapshotArchive)).toHaveBeenLastCalledWith('doc-2')
    expect(api().snapshots.length).toBe(1) // not replaced by []
    expect(m(reportOpenError)).toHaveBeenCalledTimes(1)
    expect(m(reportOpenError).mock.calls[0][0]).toMatch(/snapshot list is incomplete/)
  })

  it('a read that lands after a document switch is dropped (cancelled), not applied to the new document', async () => {
    const slow = deferred<unknown>()
    m(readSnapshotArchive).mockReturnValueOnce(slow.promise as never).mockResolvedValueOnce({ kind: 'ok', snapshots: [] } as never)
    const { r, api } = mount()
    r.rerender({ docId: 'doc-2' })
    await flush()
    await act(async () => { slow.resolve({ kind: 'ok', snapshots: [snap('stale')] }); await flush() })
    expect(api().snapshots).toEqual([])
  })
})

// ─── the silent-save-failure guard ───────────────────────────────────────────────────────────
describe('the save-failed listener: an autosave failure is never silent', () => {
  const fail = (error: string) => act(() => { window.dispatchEvent(new CustomEvent('inkwave:save-failed', { detail: { error } })) })

  it('a genuine failure raises the loud toast, every time', async () => {
    const { h } = mount()
    await flush()
    fail('QuotaExceededError')
    fail('QuotaExceededError')
    expect(h.setFileOpenError).toHaveBeenCalledTimes(2)
    expect(h.setFileOpenError.mock.calls[0][0]).toEqual({
      kind: 'error', message: expect.stringMatching(/^SAVING IS FAILING — .*\(QuotaExceededError\)/),
    })
  })

  it('a SecurityError (private window) raises the calmer notice ONCE per session — and not at all with a OneDrive account', async () => {
    const { h } = mount()
    await flush()
    fail('SecurityError: getDirectory refused')
    await flush()
    expect(h.setFileOpenError).toHaveBeenCalledTimes(1)
    expect(h.setFileOpenError.mock.calls[0][0].message).toMatch(/private browsing/)
    fail('SecurityError: getDirectory refused')
    await flush()
    expect(h.setFileOpenError).toHaveBeenCalledTimes(1)
    cleanup()
    m(oneDriveAccount).mockResolvedValue('peter@example.com' as never)
    const second = mount()
    await flush()
    await act(async () => { window.dispatchEvent(new CustomEvent('inkwave:save-failed', { detail: { error: 'SecurityError' } })); await flush() })
    expect(second.h.setFileOpenError).not.toHaveBeenCalled()
    expect(console.info).toHaveBeenCalledWith(expect.stringMatching(/cloud sync is carrying saves/))
  })

  it('unmount removes the listener', async () => {
    const { h, r } = mount()
    await flush()
    r.unmount()
    fail('QuotaExceededError')
    expect(h.setFileOpenError).not.toHaveBeenCalled()
  })
})

// ─── exportBundle / saveRecord — the actions that PUBLISH the record ─────────────────────────
describe('exportBundle and saveRecord: publishing the record', () => {
  it('exports the bundle built from the guarded read, names it by variant, and records the download', async () => {
    const { h, api } = mount()
    await flush()
    m(readSnapshotArchive).mockResolvedValue({ kind: 'ok', snapshots: [snap('s1')] } as never)
    await act(async () => { await api().exportBundle() })
    expect(m(buildExportBundleWithPdfs)).toHaveBeenCalledWith(h.docRef.current, [snap('s1')], undefined)
    expect(m(downloadBundle)).toHaveBeenCalledWith({ v: 4 }, 'essay.studio')
    expect(m(markRecognisedSave)).toHaveBeenCalledWith('doc-1', 'download')
    await act(async () => { await api().exportBundle('all', true) })
    expect(m(buildExportBundleWithPdfs)).toHaveBeenLastCalledWith(h.docRef.current, [snap('s1')], 'all')
    expect(m(downloadBundleGz)).toHaveBeenCalledWith({ v: 4 }, 'essay.no-pdfs.studio.gz')
  })

  it('THE DATA-LOSS RULE: a failed read ships NO bundle — a receipt built from a failed read is a false one', async () => {
    const { api } = mount()
    await flush()
    m(readSnapshotArchive).mockResolvedValueOnce({ kind: 'error', error: new Error('unreadable') } as never)
    await act(async () => { await api().exportBundle() })
    expect(m(buildExportBundleWithPdfs)).not.toHaveBeenCalled()
    expect(m(downloadBundle)).not.toHaveBeenCalled()
    expect(m(markRecognisedSave)).not.toHaveBeenCalled()
    expect(m(reportOpenError)).toHaveBeenCalledTimes(1)
  })

  it('saveRecord prefers the granted folder where the browser has one, and downloads otherwise', async () => {
    const { h, api } = mount()
    await flush()
    m(fileSaveAvailable).mockReturnValue(true)
    act(() => api().saveRecord())
    expect(h.saveToFile).toHaveBeenCalledTimes(1)
    m(fileSaveAvailable).mockReturnValue(false)
    await act(async () => { api().saveRecord(); await flush() })
    expect(h.saveToFile).toHaveBeenCalledTimes(1)
    expect(m(downloadBundle)).toHaveBeenCalledTimes(1)
  })
})

// ─── the OTS sweep + check Bitcoin ───────────────────────────────────────────────────────────
describe('the OTS sweep runs on demand, throttled, and only when something is owed', () => {
  it('runOtsSweep does nothing when every snapshot is confirmed', async () => {
    m(readSnapshotArchive).mockResolvedValueOnce({ kind: 'ok', snapshots: [snap('s1', 'confirmed')] } as never)
    const { api } = mount()
    await flush()
    await act(async () => { api().runOtsSweep(); await flush() })
    expect(m(drainUnstamped)).not.toHaveBeenCalled()
    expect(m(upgradePending)).not.toHaveBeenCalled()
  })

  it('with an unstamped backlog it drains, upgrades, refreshes the list and stamps the 15-minute throttle', async () => {
    m(readSnapshotArchive).mockResolvedValueOnce({ kind: 'ok', snapshots: [snap('s1', 'unstamped')] } as never)
    const { api } = mount()
    await flush()
    m(readSnapshotArchive).mockResolvedValueOnce({ kind: 'ok', snapshots: [snap('s1', 'pending')] } as never)
    await act(async () => { api().runOtsSweep(); await flush() })
    expect(m(drainUnstamped)).toHaveBeenCalledWith('doc-1')
    expect(m(upgradePending)).toHaveBeenCalledWith('doc-1')
    expect(api().snapshots[0].ots?.status).toBe('pending')
    expect(Number(localStorage.getItem('inkwave:otsCheckedAt:doc-1'))).toBeGreaterThan(0)
    await act(async () => { api().runOtsSweep(); await flush() })
    expect(m(drainUnstamped)).toHaveBeenCalledTimes(1) // throttled
  })

  it('checkBitcoin forces an upgrade and re-reads the list; a failed re-read keeps the list', async () => {
    m(readSnapshotArchive).mockResolvedValueOnce({ kind: 'ok', snapshots: [snap('s1', 'pending')] } as never)
    const { api } = mount()
    await flush()
    m(readSnapshotArchive).mockResolvedValueOnce({ kind: 'error', error: new Error('unreadable') } as never)
    await act(async () => { api().checkBitcoin(); await flush() })
    expect(m(upgradePending)).toHaveBeenCalledWith('doc-1')
    expect(api().snapshots.map((s: SnapshotMeta) => s.id)).toEqual(['s1'])
  })
})
