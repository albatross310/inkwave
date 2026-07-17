// @vitest-environment jsdom
//
// THE CLOUD WRITE-BACK — "sync my document to OneDrive" + "the snapshots".
// BLAST RADIUS: LIVE on master, no flag, Peter's real thesis.
//
// ─── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────────────────────────
// `planWriteback` is pure and tested (`archiveWriteback.test.ts`) — the RULE is proved. But F16's
// lesson is written into archiveWriteback.ts's own header: *a union guards the CONSUMER, not the
// PRODUCER. The type stops a caller forgetting the error branch; it cannot stop this function
// mapping the branches wrongly.* The mapping — and the ORDER the merge gate is closed in — is what
// nothing here has ever driven. This file drives it: real `syncToOneDrive` / `syncToGoogleDrive` /
// `preMergeRemote` / `preMergeGDrive`, real `readRemoteArchive` / `readDriveArchive`, real
// `contentUrl`, real `mapGraphReadStatus`, real `planWriteback`, real `parseTraceFile`, real
// `mergeSnapshots`, real `composeTraceFile` — against INJECTED transport faults.
//
// ⚠ WHAT IS FAKED, STATED PLAINLY. Only the two things that need a human's credentials: MSAL's
// token acquisition (OneDrive) and GIS's token client (Drive). Everything from the access token
// onwards is this repo's real code. A REAL GRAPH SIGN-IN WAS NOT AVAILABLE — see the report; the
// server's *honouring* of a request remains Peter's to verify, but what we SEND and what we DECIDE
// on the reply are proved here.
//
// ─── THE TWO FAULT MODES, AND WHY BOTH ────────────────────────────────────────────────────────────
// `readRemoteArchive` has TWO catch arms and a cell that drives only one certifies a line it cannot
// reach:
//   (a) the transport answers BADLY — 500/429/401 → `mapGraphReadStatus` → 'error'.
//   (b) the transport answers FINE and the PAYLOAD is bad — a truncated/garbled body →
//       `parseTraceOffThread` throws → the outer `catch` → 'error'.
// A fault that rejects the HANDLE never delivers a bad PAYLOAD. Both arms are driven below.
//
// ─── BOTH DIRECTIONS ──────────────────────────────────────────────────────────────────────────────
// LOSS: a failed read must never license a PUT of the local set over the remote archive.
// OUTAGE: an ESTABLISHED EMPTINESS (404; a 0-byte placeholder the OneDrive desktop client made) is
// NOT a failed read — the first sync must still land, or the feature is a spinner that never
// resolves. A guard clamped shut is the same bug wearing the other hat.

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { InkwaveDocument, Snapshot } from '../types/document'

// ── MSAL: the ONE thing a Microsoft account would supply. Everything past the token is real code. ──
const msalToken = { value: 'test-access-token' as string | null }
vi.mock('@azure/msal-browser', () => ({
  PublicClientApplication: class {
    async initialize() {}
    async handleRedirectPromise() {}
    getAllAccounts() { return [{ username: 'peter@example.com' }] }
    async acquireTokenSilent() {
      if (!msalToken.value) throw new Error('interaction_required')
      return { accessToken: msalToken.value }
    }
    async loginRedirect() {}
  },
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────
const snap = (id: string, min: number): Snapshot => ({
  id,
  documentId: 'doc-1',
  createdAt: `2026-07-17T10:${String(min).padStart(2, '0')}:00.000Z`,
  trigger: 'manual',
  wordCount: 10,
  contentHash: `hash-${id}`,
  contentJson: { type: 'doc', content: [] },
  bundleHash: `bundle-${id}`,
  ots: { status: 'unstamped' },
} as unknown as Snapshot)

const doc: InkwaveDocument = {
  id: 'doc-1',
  title: 'Leibniz',
  contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'the thesis' }] }] },
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-17T10:00:00.000Z',
  schemaVersion: 1,
  scasLimitN: 300,
  scasSessionSeed: 'seed',
} as unknown as InkwaveDocument

/** The REMOTE archive: four snapshots, four Bitcoin anchors. THE THING THAT CAN BE LOST. */
const REMOTE = [snap('s1', 1), snap('s2', 2), snap('s3', 3), snap('s4', 4)]
/** The LOCAL set: one snapshot. A fresh login / cleared data / a save racing a restore. */
const LOCAL = [snap('s5', 5)]

// ── The fake transport ────────────────────────────────────────────────────────
// ROUTED BY REQUEST, NOT QUEUED BY ORDER, and that is not a style choice. The question every cell
// below asks is "did the read happen, and did the write happen, and with WHAT" — a queue answers a
// fetch by its POSITION, so a cell whose read is skipped silently feeds the read's planned reply to
// the WRITE and reports a transport error instead of the gate bug it was built to catch. (PROBED:
// the first draft of this file did exactly that and mis-reported the preMergeGDrive reproduction as
// `ok:false`.) A router makes "no GET was issued" a fact the cell can read rather than a confusion.
type Reply =
  | { kind: 'status'; status: number; body?: string }
  | { kind: 'throw'; message: string } // the network itself failed (DNS, offline, CORS, abort)
type Call = { url: string; method: string; body: string | null }

/** How the remote answers a READ of the archive. Every cell sets this; nothing else varies. */
let remoteRead: Reply = { kind: 'status', status: 404 }
let calls: Call[] = []

const isRead = (u: string, method: string) =>
  method === 'GET' && (u.includes('/content') || u.includes('alt=media'))

function fakeFetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const u = String(url)
  const method = init?.method ?? 'GET'
  calls.push({ url: u, method, body: typeof init?.body === 'string' ? init.body : null })

  if (isRead(u, method)) {
    const r = remoteRead
    if (r.kind === 'throw') return Promise.reject(new TypeError(r.message))
    return Promise.resolve(
      new Response(r.status === 404 ? null : (r.body ?? ''), { status: r.status, headers: { ETag: '"etag-1"' } }),
    )
  }
  // Any WRITE succeeds. A cell must never be able to pass because the upload happened to fail —
  // "it did not land" and "it was never attempted" are different answers and only one is the guard.
  return Promise.resolve(new Response('{"id":"drive-file-1","webViewLink":"https://drive/x"}', { status: 200 }))
}

const puts = () => calls.filter((c) => c.method === 'PUT' || c.method === 'PATCH' || c.method === 'POST')
const gets = () => calls.filter((c) => isRead(c.url, c.method))
/** The snapshot ids the write-back actually PUT — read back with the REAL parser, out of the REAL
 *  request body. The whole question, in one line: what did we push at Peter's archive? */
async function putSnapshotIds(): Promise<string[]> {
  const body = puts()[0]?.body
  if (!body) return []
  const { parseTraceFile } = await import('../provenance/traceParse')
  const bundle = parseTraceFile(body)
  return ((bundle.snapshots ?? []) as Snapshot[]).map((s) => s.id)
}

/** A well-formed remote .studio holding `snaps`. Built with the REAL composer, so the REAL parser
 *  reads it — a fixture handwritten to a format the parser tolerates proves the wrong thing. */
async function remoteFile(snaps: Snapshot[]): Promise<string> {
  const { buildExportBundle, composeTraceFile } = await import('../provenance/bundle')
  return composeTraceFile(buildExportBundle(doc, snaps))
}

beforeEach(() => {
  vi.resetModules()
  remoteRead = { kind: 'status', status: 404 }
  calls = []
  msalToken.value = 'test-access-token'
  localStorage.clear()
  sessionStorage.clear()
  vi.stubGlobal('fetch', fakeFetch)
  // Not under test and not reachable in jsdom: OPFS (the sidecar/heal writes) and the
  // structured-clone worker. Stubbed so a cell measures the WRITE-BACK DECISION and not a
  // missing storage shim — and stubbed LOUDLY here rather than swallowed inside a `catch`.
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

/** Fresh module graph per cell — `_mergedTargets` (the once-per-session merge gate) is module
 *  state, and a gate leaking between cells is exactly the kind of cross-talk that makes a suite
 *  green about the wrong session. */
async function loadOneDrive() {
  const od = await import('./onedrive')
  const snaps = await import('../provenance/snapshots')
  // The sidecar upload + the OPFS heal are fire-and-forget and need OPFS; neither is under test.
  vi.spyOn(snaps, 'restoreSnapshotsFromBundle').mockResolvedValue(undefined as never)
  return od
}
async function loadDrive() {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-google-client')
  const gd = await import('./gdrive')
  const snaps = await import('../provenance/snapshots')
  vi.spyOn(snaps, 'restoreSnapshotsFromBundle').mockResolvedValue(undefined as never)
  // GIS: the ONE thing a Google account would supply.
  ;(window as unknown as { google: unknown }).google = {
    accounts: { oauth2: { initTokenClient: (o: { callback: (r: unknown) => void }) => ({
      callback: o.callback,
      requestAccessToken(this: { callback: (r: unknown) => void }) {
        this.callback({ access_token: 'test-drive-token', expires_in: 3600 })
      },
    }) } },
  }
  localStorage.setItem('inkwave:gdrive-file:doc-1', 'drive-file-1')
  return gd
}

// ══════════════════════════════════════════════════════════════════════════════
describe('OneDrive write-back — the LOSS direction', () => {
  // FAULT MODE (a): the transport answers badly. This is the 500/429/expired-token vector.
  it.each([
    ['a 500 (Graph is down)', 500],
    ['a 429 (throttled — the common one on a big archive)', 429],
    ['a 401 (the token expired mid-session)', 401],
    ['a 403 (consent lapsed)', 403],
  ])('REFUSES to write when the archive read returns %s', async (_label, status) => {
    const od = await loadOneDrive()
    remoteRead = { kind: 'status', status }
    const r = await od.syncToOneDrive(doc, LOCAL)
    expect(r.ok).toBe(false)
    expect(puts()).toHaveLength(0) // THE ASSERTION. Not "it returned false" — it never PUT.
  })

  // FAULT MODE (b): the transport answers FINE and the PAYLOAD is bad. A cell that only drives
  // mode (a) rejects the HANDLE and never reaches this arm — two catch arms, two fault modes.
  it.each([
    ['a truncated body (the download died mid-stream)', '{"v":1,"snapshots":[{"id":"s1"'],
    ['a garbled body (a proxy served an error page)', '<html>502 Bad Gateway</html>'],
    ['a body that is JSON but not a bundle', '"just a string"'],
  ])('REFUSES to write when the archive read returns 200 with %s', async (_label, body) => {
    const od = await loadOneDrive()
    remoteRead = { kind: 'status', status: 200, body }
    const r = await od.syncToOneDrive(doc, LOCAL)
    expect(r.ok).toBe(false)
    expect(puts()).toHaveLength(0)
  })

  // FAULT MODE (c): the network never answered at all — the outer catch, a third arm.
  it('REFUSES to write when the read throws (offline / DNS / CORS)', async () => {
    const od = await loadOneDrive()
    remoteRead = { kind: 'throw', message: 'Failed to fetch' }
    const r = await od.syncToOneDrive(doc, LOCAL)
    expect(r.ok).toBe(false)
    expect(puts()).toHaveLength(0)
  })

  // THE EQUIVALENCE archiveWriteback.ts states and nothing drove: `write: true` ⟺ we established
  // what the remote holds ⟺ the gate may close. A refusal that CLOSED the gate would be strictly
  // worse than no guard: the next sync would skip the read and push the short set unopposed.
  it('a refusal leaves the merge gate OPEN — the next sync re-reads and writes the UNION', async () => {
    const od = await loadOneDrive()
    remoteRead = { kind: 'status', status: 500 }
    expect((await od.syncToOneDrive(doc, LOCAL)).ok).toBe(false)

    calls = []
    remoteRead = { kind: 'status', status: 200, body: await remoteFile(REMOTE) }
    const r = await od.syncToOneDrive(doc, LOCAL)
    expect(r.ok).toBe(true)
    expect((await putSnapshotIds()).sort()).toEqual(['s1', 's2', 's3', 's4', 's5']) // grow-only, nothing lost
  })
})

describe('OneDrive write-back — the OUTAGE direction (an established emptiness is not a failed read)', () => {
  it('WRITES on a 404 — there is no remote file yet and a first upload can lose nothing', async () => {
    const od = await loadOneDrive()
    remoteRead = { kind: 'status', status: 404 }
    const r = await od.syncToOneDrive(doc, LOCAL)
    expect(r.ok).toBe(true)
    expect(await putSnapshotIds()).toEqual(['s5'])
  })

  it('WRITES on a 0-byte body — the OneDrive desktop client made a placeholder; refusing would hang sync forever', async () => {
    const od = await loadOneDrive()
    remoteRead = { kind: 'status', status: 200, body: '   ' }
    const r = await od.syncToOneDrive(doc, LOCAL)
    expect(r.ok).toBe(true)
    expect(await putSnapshotIds()).toEqual(['s5'])
  })

  it('WRITES the union on a healthy read, and closes the gate so the next sync skips the download', async () => {
    const od = await loadOneDrive()
    remoteRead = { kind: 'status', status: 200, body: await remoteFile(REMOTE) }
    expect((await od.syncToOneDrive(doc, LOCAL)).ok).toBe(true)
    expect((await putSnapshotIds()).sort()).toEqual(['s1', 's2', 's3', 's4', 's5'])

    calls = []
    remoteRead = { kind: 'status', status: 200 } // ONE reply: a second GET would be an unplanned fetch
    expect((await od.syncToOneDrive(doc, LOCAL)).ok).toBe(true)
    expect(gets()).toHaveLength(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
describe('preMergeRemote (OneDrive idle warm) — a failed read must not close the merge gate', () => {
  // The warm pass is a WRITE-BACK DECISION wearing a cache-warmer's clothes: the gate it closes sits
  // UPSTREAM of syncToOneDrive's guard, so a wrong close means planWriteback is never called at all.
  it.each([
    ['a 500', { kind: 'status', status: 500 } as Reply],
    ['a 429', { kind: 'status', status: 429 } as Reply],
    ['an offline throw', { kind: 'throw', message: 'Failed to fetch' } as Reply],
    ['a corrupt body (the payload arm — a different fault)', { kind: 'status', status: 200, body: '{"v":1,"snap' } as Reply],
    // THE HOLE THIS COPY SHARED WITH DRIVE'S: 200 + valid JSON that is not a record ⇒
    // `remote.snapshots` undefined ⇒ the restore skipped ⇒ the gate closed on a remote we never read.
    ['a 200 carrying JSON that is not a record', { kind: 'status', status: 200, body: '"just a string"' } as Reply],
  ])('%s in the warm pass leaves the gate OPEN, so the first real sync still merges', async (_l, reply) => {
    const od = await loadOneDrive()
    remoteRead = reply
    await od.preMergeRemote(doc)

    calls = []
    remoteRead = { kind: 'status', status: 200, body: await remoteFile(REMOTE) }
    expect((await od.syncToOneDrive(doc, LOCAL)).ok).toBe(true)
    expect((await putSnapshotIds()).sort()).toEqual(['s1', 's2', 's3', 's4', 's5'])
  })

  // THE OUTAGE DIRECTION. A 404 is an established absence — nothing to merge, so the gate SHOULD
  // close and the first sync should not pay a second pointless download of a file that isn't there.
  it('a 404 in the warm pass CLOSES the gate — an absence is established, not a failure', async () => {
    const od = await loadOneDrive()
    remoteRead = { kind: 'status', status: 404 }
    await od.preMergeRemote(doc)

    calls = []
    expect((await od.syncToOneDrive(doc, LOCAL)).ok).toBe(true)
    expect(gets()).toHaveLength(0)
  })

  it('a healthy warm read CLOSES the gate — the merge is done; the sync must not re-download', async () => {
    const od = await loadOneDrive()
    remoteRead = { kind: 'status', status: 200, body: await remoteFile(REMOTE) }
    await od.preMergeRemote(doc)

    calls = []
    expect((await od.syncToOneDrive(doc, LOCAL)).ok).toBe(true)
    expect(gets()).toHaveLength(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
describe('Google Drive write-back — the LOSS direction', () => {
  it.each([
    ['a 500', 500],
    ['a 429', 429],
    ['a 401', 401],
  ])('REFUSES to write when the archive read returns %s', async (_label, status) => {
    const gd = await loadDrive()
    remoteRead = { kind: 'status', status }
    const r = await gd.syncToGoogleDrive(doc, LOCAL)
    expect(r.ok).toBe(false)
    expect(puts()).toHaveLength(0)
  })

  it('REFUSES to write when the read returns 200 with a corrupt body (the payload arm)', async () => {
    const gd = await loadDrive()
    remoteRead = { kind: 'status', status: 200, body: '{"v":1,"snapshots":[{"id"' }
    const r = await gd.syncToGoogleDrive(doc, LOCAL)
    expect(r.ok).toBe(false)
    expect(puts()).toHaveLength(0)
  })

  // AUDITOR B, VERBATIM: "Google Drive's version is worse — `markWritebackMerged` runs on the
  // FAILING path, so it never even retries." PROBED against `syncToGoogleDrive`: REFUTED. The gate
  // is closed AFTER the plan is read and only when the plan says write.
  it('a refusal leaves the merge gate OPEN — the next sync re-reads and writes the UNION', async () => {
    const gd = await loadDrive()
    remoteRead = { kind: 'status', status: 500 }
    expect((await gd.syncToGoogleDrive(doc, LOCAL)).ok).toBe(false)

    calls = []
    remoteRead = { kind: 'status', status: 200, body: await remoteFile(REMOTE) }
    expect((await gd.syncToGoogleDrive(doc, LOCAL)).ok).toBe(true)
    expect((await putSnapshotIds()).sort()).toEqual(['s1', 's2', 's3', 's4', 's5'])
  })
})

describe('Google Drive write-back — the OUTAGE direction', () => {
  it('WRITES on a 404 — no remote file yet', async () => {
    const gd = await loadDrive()
    remoteRead = { kind: 'status', status: 404 }
    expect((await gd.syncToGoogleDrive(doc, LOCAL)).ok).toBe(true)
    expect(await putSnapshotIds()).toEqual(['s5'])
  })

  it('WRITES on a 0-byte body — an established emptiness', async () => {
    const gd = await loadDrive()
    remoteRead = { kind: 'status', status: 200, body: '' }
    expect((await gd.syncToGoogleDrive(doc, LOCAL)).ok).toBe(true)
    expect(await putSnapshotIds()).toEqual(['s5'])
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// THE BUG AUDITOR B NAMED, IN THE PLACE IT ACTUALLY LIVES.
//
// B put `markWritebackMerged`-on-the-failing-path in `syncToGoogleDrive`; it is not there (the cell
// above refutes that). It is in `preMergeGDrive`, the IDLE WARM PASS — and there it is worse than
// B said, because `syncToGoogleDrive`'s guard is downstream of the gate and a closed gate means
// `planWriteback` is NEVER CALLED. A guarded union that is never reached guards nothing.
//
//     const text = await downloadGoogleDriveFile(fileId)  // ← null on 404 AND on 500/429/401
//     if (text) { …restore… }
//     markWritebackMerged(key)                            // ← runs anyway
//
// `downloadGoogleDriveFile` returns `string | null` — the exact `catch { return null }` shape the
// whole of archiveWriteback.ts exists to abolish. A 500 in the warm pass silently closes the gate;
// the next checkpoint's sync skips its read and PUTs the short local set over the remote archive.
// OneDrive's `preMergeRemote` does NOT have this bug (`if (!res.ok) return` sits BEFORE the mark) —
// the two providers had drifted, which is this repo's standing wound.
describe('preMergeGDrive (Drive idle warm) — a failed read must not close the merge gate', () => {
  it('a 500 in the warm pass leaves the gate OPEN, so the first real sync still merges', async () => {
    const gd = await loadDrive()
    remoteRead = { kind: 'status', status: 500 }
    await gd.preMergeGDrive(doc.id)

    calls = []
    remoteRead = { kind: 'status', status: 200, body: await remoteFile(REMOTE) }
    const r = await gd.syncToGoogleDrive(doc, LOCAL)
    expect(r.ok).toBe(true)
    // THE LOSS: on the unfixed code this is ['s5'] — four Bitcoin-anchored snapshots destroyed.
    expect((await putSnapshotIds()).sort()).toEqual(['s1', 's2', 's3', 's4', 's5'])
  })

  it('a corrupt body in the warm pass leaves the gate OPEN (the payload arm — a different fault)', async () => {
    const gd = await loadDrive()
    remoteRead = { kind: 'status', status: 200, body: '{"v":1,"snapshots":[{"id"' }
    await gd.preMergeGDrive(doc.id)

    calls = []
    remoteRead = { kind: 'status', status: 200, body: await remoteFile(REMOTE) }
    expect((await gd.syncToGoogleDrive(doc, LOCAL)).ok).toBe(true)
    expect((await putSnapshotIds()).sort()).toEqual(['s1', 's2', 's3', 's4', 's5'])
  })

  // THE OUTAGE DIRECTION, and it is the reason the fix is not just "delete the mark". A 404 in the
  // warm pass is an ESTABLISHED ABSENCE: there is nothing to merge and the gate SHOULD close, so
  // the first sync does not pay a second pointless download. Guarding only loss is how a lane ships
  // a sync that re-downloads a 20 MB file on every checkpoint forever.
  it('a 404 in the warm pass CLOSES the gate — an absence is established, not a failure', async () => {
    const gd = await loadDrive()
    remoteRead = { kind: 'status', status: 404 }
    await gd.preMergeGDrive(doc.id)

    calls = []
    remoteRead = { kind: 'status', status: 200, body: '{"id":"drive-file-1"}' } // ONE: a GET would be unplanned
    expect((await gd.syncToGoogleDrive(doc, LOCAL)).ok).toBe(true)
    expect(gets()).toHaveLength(0)
  })

  it('a healthy warm read CLOSES the gate — the merge is done; the sync must not re-download', async () => {
    const gd = await loadDrive()
    remoteRead = { kind: 'status', status: 200, body: await remoteFile(REMOTE) }
    await gd.preMergeGDrive(doc.id)

    calls = []
    remoteRead = { kind: 'status', status: 200, body: '{"id":"drive-file-1"}' }
    expect((await gd.syncToGoogleDrive(doc, LOCAL)).ok).toBe(true)
    expect(gets()).toHaveLength(0)
  })
})
