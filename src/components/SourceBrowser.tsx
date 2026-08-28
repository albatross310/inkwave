// THE IN-APP SOURCE READER — read the page a citation points at, and cite what you select in it.
//
// Peter, 2026-08-28: "let's build a browser inside our app like ChatGPT does", after being shown
// that an iframe can display a page but can never let us see a selection inside it. That is true of
// an iframe and only of an iframe. So the page is FETCHED (api/_reader-core.mjs — read its header
// for the privacy posture, which Peter authorised explicitly) and arrives as STRUCTURED BLOCKS,
// which are rendered as React elements here. Two consequences, both the point:
//   • the text is in OUR document, so `window.getSelection()` works and "highlight the heading and
//     cite it" is finally expressible;
//   • no HTML string exists anywhere in the path, so injection into an origin holding the writer's
//     thesis and signing session is unrepresentable rather than merely filtered.
//
// The iframe survives as the FALLBACK. Some pages defeat extraction (a JS-rendered app has no prose
// in its HTML) and some hosts refuse framing (JSTOR sends X-Frame-Options: DENY — checked). Between
// them the panel always has something to offer, and it SAYS which mode it is in rather than leaving
// the reader to guess why selection does or doesn't work.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReaderBlock, ReaderDoc, Run } from '../reader/types'
import { locatorForHeading } from '../reader/types'
import type { LocatorKind } from '../citations/locator'
import {
  applyDockRoom, dockHandlePos, dockPanelPos, dockResize, dockRoom, NO_DOCK_ROOM,
  readStoredDockSide, readStoredOrientation, resolveOrientation, writeStoredDockSide,
  writeStoredOrientation, WIDE_QUERY, type DockOrientation,
} from './dockLayout'
import { isTouchDevice } from '../editor/Scroll'
import { tabDocId } from '../storage/tabDoc'

const INK = '#5c2d8a'

/** Hosts known to refuse framing, so the FALLBACK can say so before showing an empty rectangle. */
const KNOWN_NO_FRAME = [/(^|\.)jstor\.org$/i, /(^|\.)sciencedirect\.com$/i, /(^|\.)tandfonline\.com$/i,
  /(^|\.)springer\.com$/i, /(^|\.)wiley\.com$/i, /(^|\.)x\.com$/i, /(^|\.)twitter\.com$/i]

function hostOf(url: string): string {
  try { return new URL(url).host } catch { return '' }
}
export function likelyRefusesFraming(url: string): boolean {
  const h = hostOf(url)
  return !!h && KNOWN_NO_FRAME.some((re) => re.test(h))
}

const ERRORS: Record<string, string> = {
  'blocked host': 'That address points somewhere Inkwave won’t fetch.',
  'bad url': 'That doesn’t look like a web address.',
  'not html': 'That link isn’t a web page (it may be a PDF — attach it to the source instead).',
  'too large': 'That page is unusually large and wasn’t fetched.',
  'no readable text': 'No article text could be found on that page.',
  rate: 'Too many pages fetched just now — try again in a moment.',
}

function Runs({ runs, onNavigate }: { runs: Run[]; onNavigate?: (url: string) => void }) {
  return (
    <>
      {runs.map((r, i) => {
        let node: React.ReactNode = r.text
        if (r.code) node = <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.92em' }}>{node}</code>
        if (r.em) node = <em>{node}</em>
        if (r.strong) node = <strong>{node}</strong>
        // href is validated on BOTH sides (the server refuses anything but http/s, and so does this)
        // — one rule in two places is how a hole opens, so neither trusts the other.
        if (r.href && /^https?:\/\//i.test(r.href)) {
          const href = r.href
          node = (
            <a href={href} rel="noreferrer noopener" style={{ color: INK, textDecoration: 'underline' }}
              // Plain click = follow it HERE. ⌘/Ctrl/middle-click keeps the browser's own meaning
              // (a real tab), because a panel that swallows every modifier is not a browser either.
              onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); onNavigate?.(href) }}>
              {node}
            </a>
          )
        }
        return <span key={i}>{node}</span>
      })}
    </>
  )
}

export function SourceBrowser({ url, title, onClose, onCite, onQuote }: {
  url: string
  title?: string | null
  onClose: () => void
  /** Cite a part of the source — a section number from a heading, or whatever was selected. */
  onCite?: (loc: { kind: LocatorKind; value: string }) => void
  /** Use the selection as the citation's pinpoint sentence. */
  onQuote?: (quote: string) => void
}) {
  // ── IN-PANEL NAVIGATION (Peter, 2026-08-28: "can we make it a fully functioning browser … so you
  // can navigate to new tabs and so on") ────────────────────────────────────────────────────────
  // A link in the reader loads INSIDE the reader, with real back/forward, instead of throwing the
  // writer out to a new tab. The stack is the panel's own history — deliberately not the browser's,
  // because this is a panel over a document the writer must not lose their place in.
  const [stack, setStack] = useState<string[]>([url])
  const [idx, setIdx] = useState(0)
  useEffect(() => { setStack([url]); setIdx(0) }, [url])
  const here = stack[idx] ?? url
  const go = (next: string) => {
    if (!/^https?:\/\//i.test(next)) return
    setStack((st) => [...st.slice(0, idx + 1), next])
    setIdx((i) => i + 1)
  }
  const [doc, setDoc] = useState<ReaderDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [framed, setFramed] = useState(false)   // LIVE PAGE mode — the real site in an iframe
  const [sel, setSel] = useState<{ text: string; x: number; y: number } | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  // ── THE DOCK — the PDF panel's rules, not a copy of them (components/dockLayout.ts) ──────────
  // Peter: "can you get it to open in the side or below with same width and placing as the pdf
  // reader?" Shared preferences too, so moving one moves both.
  const [width, setWidth] = useState(() => Math.round((typeof window !== 'undefined' ? window.innerWidth : 1280) * 0.5))
  const [height, setHeight] = useState(() => Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.5))
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ axis: 'x' | 'y'; start: number; size: number } | null>(null)
  const [storedOrient, setStoredOrient] = useState<'bottom' | 'side'>(readStoredOrientation)
  const [dockSide, setDockSide] = useState(readStoredDockSide)
  const [isWide, setIsWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(WIDE_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY)
    const h = (e: MediaQueryListEvent) => setIsWide(e.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])
  const isPhone = isTouchDevice()
  const orientation: DockOrientation = resolveOrientation(isPhone, isWide, storedOrient)

  // The section list and the privacy footer are both dismissible, and both remember PER DOCUMENT
  // (Peter, 2026-08-28: "You need an x to get rid of this — and save per document", "a button to
  // hide the menu"). Per document rather than per origin because which sources you are reading, and
  // how much room you want for them, is a property of the piece you are writing.
  const docKey = (() => { try { return tabDocId() ?? 'global' } catch { return 'global' } })()
  const [showNav, setShowNav] = useState(() => {
    try { return localStorage.getItem(`inkwave:readerNav:${docKey}`) !== '0' } catch { return true }
  })
  const [showNotice, setShowNotice] = useState(() => {
    try { return localStorage.getItem(`inkwave:readerNotice:${docKey}`) !== '0' } catch { return true }
  })
  const toggleNav = () => setShowNav((v) => {
    const n = !v
    try { localStorage.setItem(`inkwave:readerNav:${docKey}`, n ? '1' : '0') } catch { /* private */ }
    return n
  })
  const dismissNotice = () => {
    setShowNotice(false)
    try { localStorage.setItem(`inkwave:readerNotice:${docKey}`, '0') } catch { /* private */ }
  }

  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const delta = (d.axis === 'x' ? e.clientX : e.clientY) - d.start
      // The panel grows toward the editor, so a LEFT dock and a BOTTOM dock read the drag in
      // opposite senses from a right dock — same arithmetic, one sign.
      const sign = d.axis === 'x' ? (dockSide === 'left' ? 1 : -1) : -1
      const next = dockResize(d.axis, d.size, delta * sign)
      if (d.axis === 'x') setWidth(next); else setHeight(next)
    }
    const up = () => { drag.current = null; setDragging(false) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [dragging, dockSide])

  // Carve the room out of the editor — the SAME four CSS variables the PDF panel writes, so the
  // editor surface and every floating pill already know how to get out of the way.
  useEffect(() => {
    applyDockRoom(dockRoom({ open: true, fullscreen: false, orientation, dockSide, width, height }))
    return () => applyDockRoom(NO_DOCK_ROOM)
  }, [orientation, dockSide, width, height])

  useEffect(() => {
    let live = true
    setDoc(null); setError(null)
    fetch(`/api/reader?url=${encodeURIComponent(here)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({ error: 'fetch failed' }))
        if (!live) return
        if (!r.ok || j.error) { setError(ERRORS[j.error] ?? 'That page couldn’t be read here.'); return }
        setDoc(j as ReaderDoc)
      })
      .catch(() => { if (live) setError('That page couldn’t be reached.') })
    return () => { live = false }
  }, [here])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // THE SELECTION. Read on pointerup inside the reader body only — a selection made in the writer's
  // own document must never be mistaken for one made in the source.
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const read = () => {
      const s = window.getSelection()
      if (!s || s.isCollapsed || s.rangeCount === 0) { setSel(null); return }
      const range = s.getRangeAt(0)
      if (!el.contains(range.commonAncestorContainer)) { setSel(null); return }
      const text = s.toString().replace(/\s+/g, ' ').trim()
      if (text.length < 2) { setSel(null); return }
      const r = range.getBoundingClientRect()
      setSel({ text, x: r.left + r.width / 2, y: r.top })
    }
    const t = () => window.setTimeout(read, 0) // let the browser finish the selection first
    el.addEventListener('pointerup', t)
    el.addEventListener('keyup', t)
    return () => { el.removeEventListener('pointerup', t); el.removeEventListener('keyup', t) }
  }, [doc])

  const headings = useMemo(
    () => (doc?.blocks ?? []).filter((b): b is Extract<ReaderBlock, { kind: 'heading' }> => b.kind === 'heading'),
    [doc],
  )

  const citeHeading = (text: string) => { onCite?.(locatorForHeading(text)); setSel(null) }

  return createPortal(
    <div className="iw-nightable iw-touch-guard flex flex-col bg-white"
      style={{ position: 'fixed', zIndex: 80, ...dockPanelPos({ orientation, dockSide, width, height }) }}
      onMouseDown={(e) => e.stopPropagation()}>
      {/* Resize handle on the edge facing the editor — the same rule and the same 10px grab strip
          the PDF panel uses (components/dockLayout.ts). */}
      {orientation !== 'top' && (
        <div title="Drag to resize"
          onPointerDown={(e) => {
            e.preventDefault()
            const axis = orientation === 'side' ? 'x' : 'y'
            drag.current = { axis, start: axis === 'x' ? e.clientX : e.clientY, size: axis === 'x' ? width : height }
            setDragging(true)
          }}
          style={{ position: 'absolute', zIndex: 2, background: dragging ? `${INK}22` : 'transparent', ...dockHandlePos(orientation, dockSide) }} />
      )}
      <div className="flex flex-col flex-1 min-h-0">

        <div className="flex items-center gap-2 px-3 py-2 border-b border-stone-200" style={{ fontSize: '13px' }}>
          <button type="button" title="Back" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}
            style={{ background: 'transparent', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', color: idx === 0 ? '#d6d3d1' : INK, fontSize: '15px', padding: '0 2px' }}>←</button>
          <button type="button" title="Forward" disabled={idx >= stack.length - 1} onClick={() => setIdx((i) => Math.min(stack.length - 1, i + 1))}
            style={{ background: 'transparent', border: 'none', cursor: idx >= stack.length - 1 ? 'default' : 'pointer', color: idx >= stack.length - 1 ? '#d6d3d1' : INK, fontSize: '15px', padding: '0 2px' }}>→</button>
          <span style={{ color: INK, fontWeight: 600, whiteSpace: 'nowrap', maxWidth: '38%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc?.title || title || hostOf(here)}</span>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-stone-400" style={{ fontSize: '11px', flex: 1 }}>{hostOf(here)}</span>
          {/* READER ⇄ LIVE PAGE. Two honest modes rather than one that pretends: Reader is the
              article in OUR document (so it can be selected and cited); Live is the real site with
              its own CSS, images and navigation, which the browser keeps sealed off from us — so
              nothing in it can be selected INTO a citation. The footer says which you are in. */}
          <button type="button" title={framed ? 'Reader view (selectable, citable)' : 'Live page (full site, not selectable)'}
            onClick={() => setFramed((f) => !f)}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: framed ? INK : '#a8a29e', fontSize: '13px', padding: '0 3px' }}>
            {framed ? '⌂' : '⛶'}
          </button>
          <a href={here} target="_blank" rel="noreferrer noopener" className="underline whitespace-nowrap" style={{ color: INK, fontSize: '12px' }}>
            open in a tab ↗
          </a>
          {!framed && headings.length > 1 && (
            <button type="button" title={showNav ? 'Hide the section list' : 'Show the section list'}
              onClick={toggleNav}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: showNav ? INK : '#a8a29e', fontSize: '13px', padding: '0 3px' }}>☰</button>
          )}
          {/* Same two controls, same preferences, as the PDF panel — move one and both follow. */}
          {isWide && !isPhone && (
            <button type="button" title={orientation === 'side' ? 'Dock below' : 'Dock to the side'}
              onClick={() => setStoredOrient((o) => { const n = o === 'side' ? 'bottom' : 'side'; writeStoredOrientation(n); return n })}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: INK, fontSize: '13px', padding: '0 3px' }}>
              {orientation === 'side' ? '▤' : '▥'}
            </button>
          )}
          {orientation === 'side' && (
            <button type="button" title={`Move to the ${dockSide === 'left' ? 'right' : 'left'}`}
              onClick={() => setDockSide((d) => { const n = d === 'left' ? 'right' : 'left'; writeStoredDockSide(n); return n })}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: INK, fontSize: '13px', padding: '0 3px' }}>
              {dockSide === 'left' ? '→' : '←'}
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#78716c', fontSize: '20px', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Section list — the fastest way to cite a section is to not have to find it first. */}
          {!framed && showNav && headings.length > 1 && (
            <nav className="hidden md:block overflow-y-auto border-r border-stone-200 py-2" style={{ width: 220, fontSize: '12px' }}>
              {headings.map((h) => (
                <button key={h.id} type="button"
                  onClick={() => document.getElementById(`iw-rd-${h.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="w-full text-left px-3 py-1 hover:bg-stone-50 flex items-center gap-1 group"
                  style={{ color: '#57534e', paddingLeft: 8 + Math.min(3, Math.max(0, h.level - 1)) * 10 }}>
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap flex-1">{h.text}</span>
                  {onCite && (
                    <span role="button" title={`Cite this section`}
                      onClick={(e) => { e.stopPropagation(); citeHeading(h.text) }}
                      className="opacity-0 group-hover:opacity-100 px-1 flex-shrink-0"
                      style={{ color: INK, fontWeight: 700 }}>§</span>
                  )}
                </button>
              ))}
            </nav>
          )}

          {/* ⚠ NO PADDING (AND NO SCROLLER) IN LIVE MODE (2026-08-28, Peter: "nevertheless it has
              this weird white space around it"). The reading column's px-8/py-6 is right for OUR
              typography and wrong for a real web page, which brings its own margins and its own
              scrollbar — so the site rendered inside a cream frame with a second scroller around
              it. The iframe fills the pane edge to edge and scrolls itself. */}
          <div ref={bodyRef} data-iw-selectable=""
            className={`flex-1 min-w-0 ${framed ? 'overflow-hidden' : 'overflow-y-auto px-8 py-6'}`}
            style={framed ? undefined : { fontFamily: "'EB Garamond', Georgia, serif", fontSize: '17px', lineHeight: 1.62, color: '#2c2a28' }}>
            {error && !framed && (
              <div className="flex flex-col items-center justify-center gap-3 h-full text-center" style={{ fontSize: '14px', color: '#57534e' }}>
                <div style={{ color: INK, fontSize: '15px' }}>{error}</div>
                {!likelyRefusesFraming(here) && (
                  <button type="button" onClick={() => setFramed(true)}
                    className="rounded-full px-3 py-1.5" style={{ border: `1px solid ${INK}55`, color: INK, fontSize: '13px' }}>
                    Try showing the live page instead
                  </button>
                )}
                <a href={here} target="_blank" rel="noreferrer noopener" className="rounded-full px-3 py-1.5 text-white"
                  style={{ background: `linear-gradient(135deg, #7a4fb0, ${INK})`, fontSize: '13px' }}>Open it in a tab ↗</a>
              </div>
            )}
            {!error && !doc && !framed && (
              <div className="flex items-center justify-center h-full" style={{ color: '#a8a29e', fontSize: '13px' }}>reading…</div>
            )}
            {framed && (
              // Live page: readable, but the browser keeps its text out of our reach — so the
              // selection actions are absent here rather than present and silently inert.
              <iframe src={here} title={doc?.title || here} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                referrerPolicy="no-referrer" style={{ display: 'block', width: '100%', height: '100%', border: 'none', background: '#fff' }} />
            )}
            {doc && !framed && doc.blocks.map((b, i) => {
              if (b.kind === 'heading') {
                const Tag = (`h${Math.min(4, Math.max(1, b.level))}`) as 'h1'
                return (
                  <Tag key={i} id={`iw-rd-${b.id}`} className="group"
                    style={{ fontSize: b.level <= 1 ? '1.5em' : b.level === 2 ? '1.22em' : '1.06em', fontWeight: 600, margin: '1.4em 0 0.5em', color: '#1c1a19' }}>
                    <Runs onNavigate={go} runs={b.runs} />
                    {onCite && (
                      <button type="button" title="Cite this section" onClick={() => citeHeading(b.text)}
                        className="opacity-0 group-hover:opacity-100"
                        style={{ marginLeft: '0.5em', fontSize: '0.6em', color: INK, border: `1px solid ${INK}44`, borderRadius: 6, padding: '2px 7px', background: 'transparent', cursor: 'pointer', verticalAlign: 'middle' }}>
                        cite §
                      </button>
                    )}
                  </Tag>
                )
              }
              if (b.kind === 'list') {
                const L = b.ordered ? 'ol' : 'ul'
                return (
                  <L key={i} style={{ margin: '0.7em 0 0.7em 1.4em', listStyle: b.ordered ? 'decimal' : 'disc' }}>
                    {b.items.map((it, j) => <li key={j} style={{ margin: '0.25em 0' }}><Runs onNavigate={go} runs={it} /></li>)}
                  </L>
                )
              }
              if (b.kind === 'quote') {
                return <blockquote key={i} style={{ margin: '0.9em 0', paddingLeft: '1em', borderLeft: `3px solid ${INK}33`, color: '#4b4844' }}><Runs onNavigate={go} runs={b.runs} /></blockquote>
              }
              if (b.kind === 'code') {
                return <pre key={i} style={{ margin: '0.9em 0', padding: '0.7em', background: '#00000008', borderRadius: 6, overflowX: 'auto', fontSize: '0.88em' }}><Runs onNavigate={go} runs={b.runs} /></pre>
              }
              return <p key={i} style={{ margin: '0.85em 0' }}><Runs onNavigate={go} runs={b.runs} /></p>
            })}
          </div>
        </div>

        {/* Floating actions over a selection — the whole reason the page is fetched rather than framed. */}
        {sel && !framed && (onCite || onQuote) && (
          <div className="iw-nightable fixed z-[401] flex items-center gap-1 bg-white rounded-full shadow-lg px-1.5 py-1"
            style={{ left: sel.x, top: Math.max(8, sel.y - 42), transform: 'translateX(-50%)', border: `1px solid ${INK}44`, fontSize: '12px' }}
            onMouseDown={(e) => e.preventDefault()}>
            {onQuote && (
              <button type="button" onClick={() => { onQuote(sel.text); setSel(null) }}
                className="rounded-full px-2.5 py-1" style={{ color: INK, background: 'transparent', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                use as cited sentence
              </button>
            )}
            {onCite && (
              <button type="button" onClick={() => { onCite(locatorForHeading(sel.text)); setSel(null) }}
                className="rounded-full px-2.5 py-1" style={{ color: INK, background: 'transparent', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                cite as locator
              </button>
            )}
          </div>
        )}

        {/* ⚠ DISMISSIBLE, NOT DELETED. The framed case's line is the one that explains why selecting
            text does nothing there, so it is worth keeping available — the × remembers per document
            and the ☰/mode change brings it back for a source where it matters. */}
        {showNotice && (
          <div className="px-3 py-1.5 border-t border-stone-200 text-stone-400 flex items-start gap-2" style={{ fontSize: '11px' }}>
            <span style={{ flex: 1 }}>{framed
              ? 'Live page — your browser keeps it separate from Inkwave, so text selected here can’t be picked up.'
              : 'Article text, fetched for you. Inkwave keeps no log and no copy of what you read — but it does see the address for the moment it takes to fetch.'}</span>
            <button type="button" onClick={dismissNotice} title="Hide this note" aria-label="Hide this note"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#a8a29e', fontSize: '14px', lineHeight: 1, padding: '0 2px', flexShrink: 0 }}>×</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
