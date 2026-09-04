// ─── The music studio — capture + markup (§A1, §A2, build order step 1) ──────
//
// THE LAZY CHUNK. Everything in the music lane hangs off this module, and `routes/Music.tsx` imports
// it with React.lazy behind the flag — so with `?music` off, none of this (nor pdf.js, nor the
// detector) is fetched or parsed. The editor bundle is untouched BY CONSTRUCTION, not by measurement.
//
// SCOPE: the score is MARKUP-ONLY and never editable (§0). Nothing here changes a note, and the
// module contains no OMR of any kind — the CV is barline/whitespace geometry only.

import { useCallback, useEffect, useRef, useState } from 'react'
import { capturePage, capturePdf } from './capture'
import { createPieceFromPhoto } from './fromPhoto'
import { HeatmapScreen } from './HeatmapScreen'
import { ScorePage, SYMBOL_GLYPHS, SYMBOL_ORDER, type Tool } from './ScorePage'
import { assetUrl, loadPiece, migrateLegacyPieces, putAsset, savePiece } from './store'
import { newPiece } from './types'
import type { Annotation, Piece, PiecePage } from './types'
import type { MediaAsset } from '../media/types'
import { mb } from '../media/mediaStore'
import { TYPE } from './typeScale'

const INK_COLOURS = ['#302438', '#b4342b', '#1d6b3a', '#1a4f8a', '#8a6a1a']
const STICKY_COLOURS = ['#fff3b0', '#ffd6d6', '#d6f0ff', '#e2ffd6']

/** The demo piece's fixed id — see the load effect. Stable so a reload reopens it, marks and all. */
const DEMO_ID = 'demo-synthetic'
/** The probe harness's fixed document (see the load effect). Not a product concept. */
export const HARNESS_ID = 'music-harness'

/**
 * The harness's Piece: the well-known document, or a fresh Piece minted **AT that same id**.
 *
 * `listPieceIds()` is GONE — see store.ts. A Piece is a document, so "which piece?" is answered by
 * "the document you have open", not by listing a private store and taking [0].
 *
 * ⚠️ `/music` HAS NO OPEN DOCUMENT, which is exactly why it is not the product surface. Peter ruled
 * "it should all be in panels": the real entry is the toolbar's music BAR LAYER, opening the Piece of
 * the active document. This route survives ONLY as the flag-gated probe harness
 * (`scripts/music.prove.mjs` drives the whole pipeline through it headlessly), so it opens a fixed
 * well-known document rather than inventing a piece list to replace the one just deleted. It retires
 * with the layer.
 *
 * ⚠️ **THE ID MUST COME FROM THE SAME CONSTANT THE READ USED, and that is the whole point of this
 * function.** It used to mint `newPieceDocument({ title }).piece!` — a FRESH uuid — while reading
 * `HARNESS_ID`. The read key and the written key were different BY CONSTRUCTION: `update()` saved the
 * student's marks under a random id, the next load read HARNESS_ID, missed, and minted another. Work
 * ORPHANED, and one whole piece LEAKED into OPFS per page load. This is the same bug the live probe
 * caught on the DEMO branch ten lines up, reintroduced on the other branch of the same `if` — and the
 * comment above it claimed "it opens a fixed well-known document" the whole time, a parity nobody
 * checked. It is EXPORTED so its test drives this code rather than a transcription of it: a test that
 * re-types the effect's body proves only that the tester can copy.
 */
export async function loadOrMintHarnessPiece(): Promise<Piece> {
  const existing = await loadPiece(HARNESS_ID)
  return existing ?? newPiece({
    id: HARNESS_ID,
    title: 'Untitled piece',
    source: { type: 'photo', captured_via: 'image' },
  })
}

/**
 * `documentId` is the PANEL-OVER-THE-EDITOR path (2026-07-17, feat/music-layer). The music BAR opens
 * this studio over whatever document the writer has open, so it opens the Piece OF THAT DOCUMENT —
 * exactly what `loadOrMintHarnessPiece`'s banner said the real entry would do. When it is:
 *   · a music document (docType:'music') → its Piece opens: pages, markup, heatmap, reflow.
 *   · a prose document (or absent)       → `loadPiece` returns null; the studio does NOT mint a Piece
 *                                          onto the essay (that would convert a thesis into a score).
 *                                          Instead, if the document has imported PHOTOS (`mediaAssets`),
 *                                          it offers "make this a music score" — the photo→Piece flow
 *                                          (`fromPhoto.ts`), which creates a SEPARATE `docType:'music'`
 *                                          document and opens it here. No photos ⇒ the honest notice.
 *   · a failed read                      → NEVER treated as "no score"; we surface it, having
 *                                          written nothing (the loadPiece THROWS contract).
 * `documentId` is resolved by the caller (`activeDocumentId()`); passed in so the studio has no
 * hidden dependency on which document is open. Omitted (the retired-route harness) ⇒ the old path.
 * `mediaAssets` is the open document's `doc.media`, forwarded by the music bar — the studio reads the
 * photos to convert but never the byte store directly.
 */
export function MusicStudio({ demo, documentId, mediaAssets }: {
  demo: boolean; documentId?: string | null; mediaAssets?: readonly MediaAsset[]
}) {
  const [piece, setPiece] = useState<Piece | null>(null)
  // 'loading' until the load effect resolves; 'none' when a documentId was given but the active
  // document is not a Piece (so `if (!piece)` below never sticks on "Opening…" forever).
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'none'>('loading')
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [tool, setTool] = useState<Tool>('pan')
  const [colour, setColour] = useState(INK_COLOURS[0])
  const [symbol, setSymbol] = useState(SYMBOL_ORDER[4])
  const [busy, setBusy] = useState<string | null>(null)
  // §A2: the heatmap is a DEDICATED SCREEN, and it is layered "in addition to" the sticky-note
  // markup — not a markup tool. Different gesture (sweep across bars vs draw on the page), different
  // subject (a range of music vs a point on an image), different author model (the teacher takes the
  // iPad). Folding it into the markup toolbar would collapse two interactions into one confused one.
  const [screen, setScreen] = useState<'score' | 'heatmap'>('score')
  const revokers = useRef<Array<() => void>>([])

  // ─── Load / create ─────────────────────────────────────────────────────────

  useEffect(() => {
    let dead = false
    void (async () => {
      // Drain the parallel container this lane used to write (store.ts). Idempotent and one-way; it
      // does nothing once empty, which is every load after the first.
      await migrateLegacyPieces().catch(() => [])
      if (demo) {
        // A STABLE id, not a fresh uuid per load. PROVED BY THE LIVE PROBE (music.prove.mjs): with a
        // per-load uuid, reloading the demo minted a NEW piece — so every mark the student had just
        // drawn was still on disk but orphaned under the old id, and the page came back blank. It
        // also leaked one whole piece (two page images) into OPFS on every single reload. The unit
        // tests could not see either: both live entirely in the browser's storage, not in the pure
        // detector.
        const existing = await loadPiece(DEMO_ID)
        if (existing?.pages.length) { if (!dead) setPiece(existing); return }
        setBusy('Drawing a synthetic score…')
        // DYNAMIC, and the reason is the trap this project keeps hitting: a separate chunk FILE is
        // not evidence of laziness. `demo.ts` pulls in `fixtures.ts` — the whole synthetic score
        // GENERATOR, which exists only to test the detector and to draw `?music=demo` — and a static
        // import would bundle it into the studio chunk that every REAL music user downloads.
        // MEASURED before this change: the generator's strings were inside MusicStudio-*.js.
        const { buildDemoPiece } = await import('./demo')
        const { piece: p, captured } = await buildDemoPiece(DEMO_ID)
        const pages: PiecePage[] = []
        for (const c of captured) {
          const ref = await putAsset(p.id, c.blob)
          pages.push({ ...c.page, image_ref: ref })
        }
        const full = { ...p, pages }
        await savePiece(full)
        if (!dead) { setPiece(full); setBusy(null); setLoadState('ok') }
        return
      }
      if (documentId) {
        // Open the Piece of the document the writer has open. loadPiece THROWS on a read error
        // (never null — CLAUDE.md's absence-vs-ignorance rule), returns null when the document is
        // genuinely not a score, and the Piece otherwise.
        let existing: Piece | null = null
        try {
          existing = await loadPiece(documentId)
        } catch (err) {
          // A failed read is NOT "no score". Say so; the studio shows the honest notice, nothing
          // was written (loadPiece read-only), and the writer's document is untouched.
          console.error('[inkwave:music] could not read the open document:', err)
          if (!dead) setLoadState('none')
          return
        }
        if (dead) return
        if (existing) { setPiece(existing); setLoadState('ok') }
        else setLoadState('none')
        return
      }
      const harness = await loadOrMintHarnessPiece()
      if (!dead) { setPiece(harness); setLoadState('ok') }
    })()
    return () => { dead = true }
  }, [demo, documentId])

  // Resolve every page's bytes to an object URL — and revoke them. An object URL pins its blob for
  // the document's lifetime; a stack of page images left unrevoked is a straightforward leak.
  useEffect(() => {
    if (!piece) return
    let dead = false
    void (async () => {
      const next: Record<string, string> = {}
      const rev: Array<() => void> = []
      for (const pg of piece.pages) {
        if (!pg.image_ref || urls[pg.image_ref]) continue
        const r = await assetUrl(piece.id, pg.image_ref)
        if (r) { next[pg.image_ref] = r.url; rev.push(r.revoke) }
      }
      if (dead) { rev.forEach(f => f()); return }
      if (Object.keys(next).length) {
        revokers.current.push(...rev)
        setUrls(u => ({ ...u, ...next }))
      }
    })()
    return () => { dead = true }
  }, [piece, urls])

  useEffect(() => () => { revokers.current.forEach(f => f()); revokers.current = [] }, [])

  const update = useCallback((next: Piece) => {
    setPiece(next)
    void savePiece(next).catch(err => {
      // NEVER swallow a failed save — the same rule the editor's autosave follows. A student who
      // keeps annotating a piece that stopped persisting loses the lesson.
      console.error('[inkwave:music] save failed:', err)
    })
  }, [])

  // ─── Import ────────────────────────────────────────────────────────────────

  const importFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length || !piece) return
    setBusy('Reading the score…')
    try {
      const pages: PiecePage[] = [...piece.pages]
      for (const file of Array.from(files)) {
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          const captured = await capturePdf(await file.arrayBuffer(), {
            onProgress: (d, t) => setBusy(`Reading page ${d} of ${t}…`),
          })
          for (const c of captured) pages.push({ ...c.page, image_ref: await putAsset(piece.id, c.blob) })
        } else {
          const c = await capturePage(file)
          pages.push({ ...c.page, image_ref: await putAsset(piece.id, c.blob) })
        }
      }
      const src = piece.source.type === 'photo' ? piece.source : { type: 'photo' as const, captured_via: 'image' as const }
      update({ ...piece, pages, source: { ...src, captured_via: 'image' } })
    } finally {
      setBusy(null)
    }
  }, [piece, update])

  const onAnnotations = useCallback((annotations: Annotation[]) => {
    if (piece) update({ ...piece, annotations })
  }, [piece, update])

  // The active document is not a score. Honest, non-destructive: the studio never mints a Piece OVER
  // a prose document. But if the writer has imported PHOTOS, it offers to turn one into a NEW score
  // (fromPhoto.ts) — a separate docType:'music' document, opened here on success. The essay is untouched.
  if (loadState === 'none' && !piece) {
    const photos = (mediaAssets ?? []).filter(a => a.kind === 'photo')
    return (
      <div className="mx-auto w-full max-w-3xl py-8 font-serif" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
        {photos.length > 0 ? (
          <PhotoToScore
            photos={photos}
            onCreated={p => { setPiece(p); setLoadState('ok') }}
          />
        ) : (
          <div className="text-center">
            <p style={{ fontSize: TYPE.body, color: 'var(--iw-ink, #302438)' }}>This document isn’t a score.</p>
            <p className="mt-2" style={{ fontSize: TYPE.label }}>
              To make one, import a <b>Photo</b> of a score with the media button on the toolbar, then come
              back here — you’ll be offered “make this a music score”. To write ABOUT a published score
              instead, use <b>Import a score</b> on the music bar (it attaches excerpts to this essay).
            </p>
          </div>
        )}
      </div>
    )
  }

  if (!piece) return <Centered>Opening…</Centered>

  return (
    <div className="mx-auto w-full max-w-3xl pb-32">
      <header className="mb-4">
        <input
          value={piece.title}
          onChange={e => update({ ...piece, title: e.target.value })}
          className="w-full bg-transparent font-serif outline-none"
          style={{ fontSize: TYPE.title, color: 'var(--iw-ink, #302438)' }}
          aria-label="Piece title"
        />
        <p className="font-serif" style={{ fontSize: TYPE.label, color: 'var(--iw-pill-fg, #78716c)' }}>
          {/* THE TRUE SENTENCE. There is no at-rest encryption in this build — see types.ts. What IS
              true is zero-retention: there is no server, so none of this ever leaves the device. */}
          Stored on your device — we never hold it.
        </p>
      </header>

      {demo && (
        <p
          className="mb-4 rounded-md p-2 font-serif iw-nightable"
          style={{ fontSize: TYPE.label, color: 'var(--iw-pill-fg, #78716c)', border: '1px dashed var(--iw-nightable-border, rgba(0,0,0,0.14))' }}
        >
          Demo — these pages are drawn by Inkwave, not photographed. Nothing here is a real score.
        </p>
      )}

      {!!piece.pages.length && (
        <nav className="mb-4 flex gap-1" role="tablist">
          {(['score', 'heatmap'] as const).map(s => (
            <button
              key={s}
              role="tab"
              aria-selected={screen === s}
              onClick={() => setScreen(s)}
              className="rounded-full px-3 py-1 font-serif"
              style={{
                fontSize: TYPE.label,
                background: screen === s ? 'var(--iw-light, #41425b)' : 'transparent',
                color: screen === s ? '#fff' : 'var(--iw-ink, #302438)',
                border: '1px solid var(--iw-nightable-border, rgba(0,0,0,0.12))',
              }}
            >
              {s === 'score' ? 'Score' : 'What needs work'}
            </button>
          ))}
        </nav>
      )}

      {!piece.pages.length && !busy && (
        <ImportPrompt onFiles={importFiles} />
      )}

      {busy && <Centered>{busy}</Centered>}

      {screen === 'heatmap' && <HeatmapScreen piece={piece} onChange={update} />}

      {screen === 'score' && piece.pages.map((pg, i) => (
        <section key={i} className="mb-8">
          <h2 className="mb-1 font-serif" style={{ fontSize: TYPE.label, color: 'var(--iw-pill-fg, #78716c)' }}>
            Page {i + 1} · {pg.systems.length} system{pg.systems.length === 1 ? '' : 's'}
            {pg.systems.some(s => s.is_grand_stave) ? ' · grand staves kept together' : ''}
          </h2>
          <ScorePage
            piece={piece}
            page={pg}
            pageIndex={i}
            imageUrl={pg.image_ref ? urls[pg.image_ref] ?? null : null}
            tool={tool}
            colour={tool === 'sticky' ? STICKY_COLOURS[0] : colour}
            symbol={symbol}
            onChange={onAnnotations}
            onReflow={reflow => {
              const pages = piece.pages.map((p, j) => (j === i ? { ...p, reflow } : p))
              update({ ...piece, pages })
            }}
          />
          <label className="mt-2 flex items-center gap-2 font-serif" style={{ fontSize: TYPE.label, color: 'var(--iw-pill-fg, #78716c)' }}>
            <input
              type="checkbox"
              checked={pg.reflow?.enabled ?? false}
              onChange={e => {
                const reflow = { ...(pg.reflow ?? { default_gap: 0.06, gaps: {} }), enabled: e.target.checked }
                update({ ...piece, pages: piece.pages.map((p, j) => (j === i ? { ...p, reflow } : p)) })
              }}
            />
            Room to write
          </label>
        </section>
      ))}

      {!!piece.pages.length && screen === 'score' &&
        <Toolbar {...{ tool, setTool, colour, setColour, symbol, setSymbol, onFiles: importFiles }} />}
    </div>
  )
}

// ─── Toolbar ─────────────────────────────────────────────────────────────────
//
// A footer drop-up. `iw-touch-guard` is MANDATORY on every panel here: without it a tap outside the
// contenteditable blurs it on iOS, the keyboard retracts, and the docked bar slides down the screen
// mid-tap (CLAUDE.md, 2026-07-12).

function Toolbar({ tool, setTool, colour, setColour, symbol, setSymbol, onFiles }: {
  tool: Tool; setTool: (t: Tool) => void
  colour: string; setColour: (c: string) => void
  symbol: string; setSymbol: (s: string) => void
  onFiles: (f: FileList | null) => void
}) {
  const [palette, setPalette] = useState(false)
  const tools: Array<[Tool, string, string]> = [
    ['pan', '✋', 'Move around'],
    ['freehand', '✎', 'Draw'],
    ['highlight', '▭', 'Highlight'],
    ['sticky', '🗒', 'Sticky note'],
    ['symbol', SYMBOL_GLYPHS[symbol] ?? 'f', 'Musical symbol'],
  ]
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex justify-center p-3">
      <div
        className="iw-nightable iw-touch-guard flex items-center gap-1 rounded-full px-2 py-1 shadow-lg"
        style={{ background: 'var(--iw-paper, #fff)', border: '1px solid var(--iw-nightable-border, rgba(0,0,0,0.12))' }}
      >
        {tools.map(([t, glyph, label]) => (
          <button
            key={t}
            onClick={() => { setTool(t); if (t === 'symbol') setPalette(p => !p) }}
            aria-label={label}
            aria-pressed={tool === t}
            className="h-11 w-11 rounded-full font-serif"
            style={{
              fontSize: TYPE.heading,
              background: tool === t ? 'var(--iw-light, #41425b)' : 'transparent',
              color: tool === t ? '#fff' : 'var(--iw-ink, #302438)',
            }}
          >
            {glyph}
          </button>
        ))}
        <span className="mx-1 h-6 w-px" style={{ background: 'var(--iw-nightable-border, rgba(0,0,0,0.12))' }} />
        {INK_COLOURS.map(c => (
          <button
            key={c}
            onClick={() => setColour(c)}
            aria-label={`Ink ${c}`}
            className="h-7 w-7 rounded-full"
            style={{ background: c, outline: colour === c ? '2px solid var(--iw-ink, #302438)' : 'none', outlineOffset: 2 }}
          />
        ))}
        <label
          className="ml-1 flex h-11 cursor-pointer items-center rounded-full px-3 font-serif"
          style={{ fontSize: TYPE.label, color: 'var(--iw-ink, #302438)' }}
        >
          + page
          {/* NO `accept` LIST ON TOUCH: unregistered UTIs grey out every file in the iOS picker
              (CLAUDE.md, iOS invariants). */}
          <input type="file" multiple className="hidden" onChange={e => onFiles(e.target.files)} />
        </label>

        {palette && tool === 'symbol' && (
          <div
            className="iw-nightable iw-touch-guard absolute bottom-16 left-1/2 grid -translate-x-1/2 grid-cols-6 gap-1 rounded-lg p-2 shadow-lg"
            style={{ background: 'var(--iw-paper, #fff)', border: '1px solid var(--iw-nightable-border, rgba(0,0,0,0.12))' }}
          >
            {SYMBOL_ORDER.map(s => (
              <button
                key={s}
                onClick={() => { setSymbol(s); setPalette(false) }}
                aria-label={s}
                className="h-10 w-10 rounded font-serif italic"
                style={{ fontSize: TYPE.body, color: 'var(--iw-ink, #302438)', fontWeight: 700 }}
              >
                {SYMBOL_GLYPHS[s]}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Photo → score (the creation flow) ───────────────────────────────────────
//
// The writer imported a photo of a score (the media button) and opened the studio on that document.
// It is not itself a score, so here is the turn: pick a photo, and Inkwave runs it through the
// capture→detect→reflow pipeline and creates a NEW music document from it. Its own busy/error state
// so a slow capture (a big phone photo is tens of ms of canvas work) shows progress, and a refusal
// (missing bytes, an unreadable image) is the writer's to see — never a silent blank score.

function PhotoToScore({ photos, onCreated }: {
  photos: MediaAsset[]
  onCreated: (piece: Piece) => void
}) {
  const [converting, setConverting] = useState<string | null>(null) // the asset id being converted
  const [error, setError] = useState<string | null>(null)

  async function convert(asset: MediaAsset) {
    setConverting(asset.id)
    setError(null)
    const res = await createPieceFromPhoto(asset)
    setConverting(null)
    if (!res.ok) { setError(res.reason); return }
    onCreated(res.piece)
  }

  return (
    <div>
      <p className="text-center" style={{ fontSize: TYPE.body, color: 'var(--iw-ink, #302438)' }}>
        Turn a photo into a score
      </p>
      <p className="mt-1 mb-5 text-center" style={{ fontSize: TYPE.label }}>
        Inkwave finds the systems and makes room to write. Your essay stays as it is — the score becomes
        its own document.
      </p>

      <ul className="flex flex-col gap-2">
        {photos.map(asset => (
          <li
            key={asset.id}
            className="iw-nightable flex items-center gap-3 rounded-lg p-3"
            style={{ border: '1px solid var(--iw-nightable-border, rgba(0,0,0,0.12))' }}
          >
            <span aria-hidden="true" style={{ fontSize: TYPE.heading, color: 'var(--iw-light, #41425b)' }}>❐</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate" style={{ fontSize: TYPE.label, color: 'var(--iw-ink, #302438)' }}>
                {asset.name}
              </span>
              <span className="block" style={{ fontSize: TYPE.meta }}>{mb(asset.size)}</span>
            </span>
            <button
              type="button"
              onClick={() => convert(asset)}
              disabled={converting !== null}
              className="rounded-full px-4 disabled:opacity-50"
              style={{
                minHeight: 44,
                fontSize: TYPE.label,
                color: '#fff',
                background: 'var(--iw-light, #41425b)',
              }}
            >
              {converting === asset.id ? 'Reading the score…' : 'Make this a music score'}
            </button>
          </li>
        ))}
      </ul>

      {error && (
        // The failure is the writer's to see, not the console's — the storage rule from 15 July.
        <p className="mt-4 text-center" style={{ fontSize: TYPE.label, color: '#b45309' }}>{error}</p>
      )}
    </div>
  )
}

// ─── Bits ────────────────────────────────────────────────────────────────────

function ImportPrompt({ onFiles }: { onFiles: (f: FileList | null) => void }) {
  return (
    <label
      className="iw-nightable flex cursor-pointer flex-col items-center rounded-lg p-10 text-center font-serif"
      style={{ border: '1px dashed var(--iw-nightable-border, rgba(0,0,0,0.2))', color: 'var(--iw-pill-fg, #78716c)' }}
    >
      <span style={{ fontSize: TYPE.body, color: 'var(--iw-ink, #302438)' }}>Photograph or import your score</span>
      <span className="mt-1" style={{ fontSize: TYPE.label }}>Images or a PDF. Inkwave finds the systems and makes room to write.</span>
      {/* `capture` asks the phone for the camera directly (§A1's "camera capture"); on a desktop it
          is ignored and this stays an ordinary file picker. */}
      <input type="file" multiple capture="environment" className="hidden" onChange={e => onFiles(e.target.files)} />
    </label>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-10 text-center font-serif" style={{ fontSize: TYPE.label, color: 'var(--iw-pill-fg, #78716c)' }}>
      {children}
    </p>
  )
}
