// Rendered notation (build spec §B2/§B3) — OpenSheetMusicDisplay → SVG.
//
// ─── ENGINE CHOICE: OSMD, not Verovio (§C3 left it open; here is the evidence) ───────────────
// Measured, not assumed (see the module report for how):
//
//                        OSMD 2.0.0            Verovio 6.2.0
//   bundled, gzipped     323 kB                2.2 MB          — 7x, in an app that hand-rolls its
//                                                                PWA and charts to save bytes
//   licence              BSD-3-Clause          LGPL-3.0-or-later — permissive vs a copyleft whose
//                                                                  relinking clause is a real
//                                                                  question for a bundled SPA
//   cursor               native Cursor class   none — build it from a timemap yourself
//   bar-range render     drawFrom/UpToMeasureNumber   manual
//   CSP                  pure JS/SVG, no change  inlines 6.7 MB of wasm; needs 'wasm-unsafe-eval'
//
// Note the spec calls OSMD "MIT" (§0, §C1). It is BSD-3-Clause (npm metadata and the LICENSE file:
// "Copyright 2019 PhonicScore"). Both are permissive, so the spec's CONCLUSION holds — no licence to
// negotiate — but the label is wrong and the attribution requirement is real.
//
// Verovio engraves more beautifully. It is not worth 7x the bytes, a copyleft licence and writing a
// cursor, for a module whose whole point is a cheap probe on a shared engine. The parse/addressing
// layer (music/parse.ts, music/score.ts) is deliberately engine-independent, so this decision is
// reversible without touching excerpts, citations or annotations.
//
// ─── This file is only ever reached through a dynamic import ─────────────────────────────────
// Importing OSMD costs 323 kB gzip. NOTHING may import this module statically from the editor's
// tree — `chunk.test.ts` asserts against the real build manifest that it lands in its own chunk and
// that the editor's entry does not pull it in.

import { useEffect, useRef, useState } from 'react'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { resolveScoreColors } from './theme'
import { type_ } from './typeScale'

export interface ScoreViewProps {
  /** The MusicXML to render. For an excerpt this is the MASTER's XML — never a copy (§B6). */
  xml: string
  /** Render only this bar range, 1-based over the measure list (an excerpt — §B6). */
  fromMeasureNumber?: number
  toMeasureNumber?: number
  /** 0-based measure index to draw the cursor at, or null to hide it. Driven by the player (§B3). */
  cursorMeasureIndex?: number | null
  /** Show the title/composer block. Off for an inline excerpt. */
  showTitle?: boolean
  zoom?: number
  onError?: (message: string) => void
  onReady?: (osmd: OpenSheetMusicDisplay) => void
}

/** The live `<html data-theme>` value, so a theme change can force a re-render. */
function useThemeKey(): string {
  const [theme, setTheme] = useState(() =>
    typeof document !== 'undefined' ? document.documentElement.dataset.theme ?? 'day' : 'day')
  useEffect(() => {
    // OSMD bakes concrete colours into the SVG at draw time (see theme.ts), so unlike a var()-styled
    // chart it CANNOT restyle itself when the theme switches — it has to be redrawn. Watching the
    // attribute is what makes the score follow the Settings toggle instead of staying in day
    // colours until the next reload.
    const target = document.documentElement
    const observer = new MutationObserver(() => setTheme(target.dataset.theme ?? 'day'))
    observer.observe(target, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return theme
}

export function ScoreView({
  xml,
  fromMeasureNumber,
  toMeasureNumber,
  cursorMeasureIndex = null,
  showTitle = true,
  zoom = 1,
  onError,
  onReady,
}: ScoreViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null)
  const [loading, setLoading] = useState(true)
  const theme = useThemeKey()

  // ─── load + draw ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    setLoading(true)

    // Resolve colours against the HOST — the night palette is scoped to `.iw-nightable`, which is
    // on the container below, so an element outside it would silently read day values (theme.ts).
    const colours = resolveScoreColors(host)

    const osmd = new OpenSheetMusicDisplay(host, {
      autoResize: true,
      backend: 'svg',
      drawTitle: showTitle,
      drawComposer: showTitle,
      drawSubtitle: false,
      drawLyricist: false,
      // The engraving, in the theme's ink.
      defaultColorMusic: colours.music,
      defaultColorTitle: colours.title,
      // OSMD conflates these two: `drawFromMeasureNumber` sets BOTH MinMeasureToDrawIndex (n-1) and
      // MinMeasureToDrawNumber (n), then compensates by +1 at render if the score opens with an
      // implicit pickup. So it wants a 1-based COUNT over the measure list — which is what
      // ResolvedExcerpt.osmdFrom/osmdTo are, computed from OUR parse rather than from the writer's
      // printed string. See transclusion.ts.
      ...(fromMeasureNumber !== undefined ? { drawFromMeasureNumber: fromMeasureNumber } : {}),
      ...(toMeasureNumber !== undefined ? { drawUpToMeasureNumber: toMeasureNumber } : {}),
      cursorsOptions: [{ type: 0, color: colours.cursor, alpha: 0.45, follow: true }],
    })
    osmdRef.current = osmd
    osmd.zoom = zoom

    osmd.load(xml)
      .then(() => {
        if (cancelled) return
        osmd.render()
        setLoading(false)
        onReady?.(osmd)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoading(false)
        // Never fail to an empty box: an empty score view looks exactly like a score with no notes.
        onError?.(err instanceof Error ? err.message : 'This score could not be displayed.')
      })

    return () => {
      cancelled = true
      try { osmd.clear() } catch { /* never constructed */ }
      osmdRef.current = null
    }
    // `theme` is a dependency ON PURPOSE — a theme switch must redraw with the new colours.
  }, [xml, fromMeasureNumber, toMeasureNumber, showTitle, zoom, theme, onError, onReady])

  // ─── cursor ──────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const osmd = osmdRef.current
    if (!osmd || loading) return
    const cursor = osmd.cursor
    if (!cursor) return

    if (cursorMeasureIndex === null) { cursor.hide(); return }

    // Step the cursor to the target bar. OSMD's cursor is an iterator, so reaching a bar means
    // resetting and advancing — cheap at these sizes, and it keeps ONE definition of "where the
    // cursor is" (the player's, on the audio clock) rather than letting the engine keep its own.
    cursor.reset()
    cursor.show()
    let guard = 0
    const MAX_STEPS = 10000
    while (!cursor.iterator.EndReached && guard++ < MAX_STEPS) {
      if (cursor.iterator.CurrentMeasureIndex >= cursorMeasureIndex) break
      cursor.next()
    }
    cursor.update()
  }, [cursorMeasureIndex, loading])

  return (
    // `iw-nightable` is MANDATORY and load-bearing twice over: it themes the surrounding chrome, AND
    // it is the scope the night colour tokens are declared under — without it resolveScoreColors
    // reads day values and the notation renders black on a charcoal page (theme.ts, CLAUDE.md).
    <div className="iw-nightable" style={{ background: 'var(--iw-score-paper, #ffffff)' }}>
      {loading && (
        <p className="text-center font-serif py-4" style={{ color: 'var(--iw-pill-fg, #78716c)', ...type_('body') }}>
          Engraving the score…
        </p>
      )}
      <div ref={hostRef} data-testid="osmd-host" />
    </div>
  )
}

export default ScoreView
