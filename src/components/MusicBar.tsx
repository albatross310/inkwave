// ─── The music bar — the second-bar layer the toolbar's ♪ slot opens ─────────
//
// Peter, 2026-07-17: music is "a LAYER over the editor … no /music doesn't survive. it should all be
// in panels." So this bar (the thin second row) holds the music module's entry points, and each one
// opens the real surface as a PANEL OVER THE EDITOR — never a route. `/music` is retired.
//
// OWNER SPLIT (CLAUDE.md coordination): the TOOLBAR lane owns the SHELL — the ♪ slot trigger, the
// mutual-exclusion with the style/review bars (`activeBar` holds ONE BarLayerId), and this bar's
// collapse animation, all in TiptapEditor. THIS lane (feat/music-layer) fills the bar's BODY and
// mounts the panels. The seam is the contract (`BarLayerId 'music'`); the two lanes never edit the
// same JSX.
//
// ─── LAZINESS IS STRUCTURAL, and it is the whole reason this file is light ───────────────────────
// This component is imported STATICALLY by TiptapEditor, so it must NOT statically import the heavy
// music surfaces (MusicStudio's detector, MusicPanel's OSMD — 338 kB gzip). It imports them through
// `lazy(() => import(...))`, whose specifiers are DYNAMIC — a chunk boundary, invisible to the
// editor's static graph. `music/chunk.test.ts` asserts exactly this: the editor statically reaches
// ONLY the tiny flag/typeScale leaves, and the two panels stay in SEPARATE chunks (the studio never
// ships OSMD, the MusicXML path never ships the reflow detector).
//
// NIGHT MODE (mandatory, CLAUDE.md): `iw-nightable` opts the surface into the themed palette; every
// custom colour is a token with a day fallback, never a bare hex. `iw-touch-guard` so a tap in the
// bar (or the panel) does not blur the editor and retract the iOS keyboard (the footer-menu rule).

import { lazy, Suspense, useState } from 'react'
import { createPortal } from 'react-dom'
import { musicDemo } from '../music/flag'
import { musicXmlDemo } from '../music/xmlFlag'
import { TYPE } from '../music/typeScale'
// TYPE-ONLY: erased at compile time, so it ships no bytes into the editor's static graph (chunk.test.ts
// skips `import type`). The value pipeline that turns a photo into a Piece lives in the lazy studio.
import type { MediaAsset } from '../media/types'

// ─── The lazy panels ─────────────────────────────────────────────────────────
// TWO separate `import()`s = two separate chunks. Merging them (a single wrapper module that
// statically imports both) would make every studio user download OSMD — the exact failure
// chunk.test.ts's "keeps the two paths in SEPARATE chunks" guards against.
const MusicStudio = lazy(() => import('../music/MusicStudio').then(m => ({ default: m.MusicStudio })))
const MusicPanel = lazy(() => import('../music/MusicPanel').then(m => ({ default: m.MusicPanel })))

type View = 'studio' | 'musicxml'

interface MusicBarProps {
  phone?: boolean
  /** The document the writer has open. The score studio opens THIS document's Piece; the MusicXML
   *  panel attaches excerpts to it. Passed in (not read from localStorage here) so the bar has no
   *  static dependency on `music/attach.ts` — which would leak into the editor's static graph. */
  documentId?: string | null
  /** The open document's imported media (`doc.media`). The studio offers "make this a music score"
   *  on any PHOTO here when the document is not itself a score — the photo→Piece creation flow. Data
   *  only, no import weight; the conversion pipeline is dynamic inside the studio. */
  mediaAssets?: readonly MediaAsset[]
}

/** A bar button: a pill on the ramp, ≥44px touch, that opens a panel. */
function BarButton({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 min-h-[44px] rounded-full border-[1.5px] whitespace-nowrap transition-colors hover:bg-stone-50"
      style={{
        fontSize: TYPE.label,
        borderColor: 'var(--iw-nightable-border, #e7e5e4)',
        color: 'var(--iw-ink, #5c2d8a)',
      }}
    >
      {label}
    </button>
  )
}

export function MusicBar({ phone, documentId, mediaAssets }: MusicBarProps): JSX.Element {
  const [view, setView] = useState<View | null>(null)

  return (
    <div
      className={`iw-nightable iw-touch-guard flex items-center ${phone ? 'px-1.5 gap-1.5' : 'px-4 gap-2'} py-2 border-b border-stone-200`}
    >
      <span
        className="italic mr-1 select-none"
        style={{ fontSize: TYPE.meta, color: 'var(--iw-pill-fg, #78716c)' }}
        aria-hidden="true"
      >
        ♪ music
      </span>

      {/* The photo path (§A1/§A2): capture/import a score, mark it up, the "what needs work" heatmap.
          Opens the Piece of the OPEN document — MusicStudio says so honestly when it is not a score. */}
      <BarButton label="Score studio" onClick={() => setView('studio')} />

      {/* The MusicXML path (§B): import a Sibelius/MuseScore/Dorico export, play it, and attach
          excerpts to the essay being written. This is build item #2 — the import lives HERE now,
          not behind the dead route. */}
      <BarButton label="Import a score" onClick={() => setView('musicxml')} />

      {/* NB §A4 reference tracks (YouTube/MP3 + tap-sync) are NOT BUILT (CLAUDE.md), so no button for
          them ships here. The bar carries only working actions — the moment the music module
          graduates to live, a greyed "coming soon" pill would be exactly the stub a live flag must
          not ship. It returns as a real button when its lane lands. */}

      {view && (
        <MusicPanelOverlay view={view} phone={phone} documentId={documentId} mediaAssets={mediaAssets} onClose={() => setView(null)} />
      )}
    </div>
  )
}

// ─── The panel over the editor ───────────────────────────────────────────────
// PORTALLED to document.body: the music bar row is clipped to 60px (`overflow:hidden`) by
// TiptapEditor's collapse animation, so the panel must escape that clip. A sibling of the editor,
// never a descendant, so it does not sit inside the editor's PM subtree.

function MusicPanelOverlay({ view, phone, documentId, mediaAssets, onClose }: {
  view: View; phone?: boolean; documentId?: string | null; mediaAssets?: readonly MediaAsset[]; onClose: () => void
}): JSX.Element | null {
  if (typeof document === 'undefined') return null // prerender guard — the editor is client-only

  const title = view === 'studio' ? 'Score studio' : 'Score'

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex justify-center"
      style={{ background: 'rgba(0,0,0,0.35)' }}
      // Tap the backdrop to dismiss — but a tap INSIDE the panel must not (stopPropagation on the card).
      onMouseDown={onClose}
    >
      <div
        className="iw-nightable iw-touch-guard flex flex-col w-full overflow-hidden shadow-xl"
        style={{
          maxWidth: phone ? '100%' : 900,
          maxHeight: phone ? '100%' : '92vh',
          marginTop: phone ? 0 : 24,
          borderRadius: phone ? 0 : 12,
          background: 'var(--iw-score-paper, #fcfaf6)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <header
          className="flex items-center justify-between px-4 py-2 border-b"
          style={{ borderColor: 'var(--iw-nightable-border, #e7e5e4)' }}
        >
          <span className="font-serif" style={{ fontSize: TYPE.label, color: 'var(--iw-ink, #5c2d8a)' }}>{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex items-center justify-center rounded-full hover:bg-stone-100"
            style={{ minWidth: 44, minHeight: 44, fontSize: TYPE.heading, color: 'var(--iw-pill-fg, #78716c)' }}
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-auto p-4">
          <Suspense fallback={<Loading />}>
            {view === 'studio'
              ? <MusicStudio demo={musicDemo()} documentId={documentId ?? null} mediaAssets={mediaAssets} />
              : <MusicPanel demo={musicXmlDemo()} />}
          </Suspense>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Loading(): JSX.Element {
  return (
    <p className="text-center font-serif py-10" style={{ fontSize: TYPE.label, color: 'var(--iw-pill-fg, #78716c)' }}>
      Opening your score…
    </p>
  )
}
