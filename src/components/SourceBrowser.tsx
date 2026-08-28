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
import { locateAll, markRuns, type ReaderMark, type MarkKind, type Located } from '../reader/marks'
import { v4 as uuidv4 } from 'uuid'
import type { LocatorKind } from '../citations/locator'
import {
  applyDockRoom, dockHandlePos, dockPanelPos, dockResize, dockRoom, NO_DOCK_ROOM,
  readStoredDockSide, readStoredOrientation, resolveOrientation, writeStoredDockSide,
  writeStoredOrientation, WIDE_QUERY, type DockOrientation,
} from './dockLayout'
import { isTouchDevice } from '../editor/Scroll'
import { tabDocId } from '../storage/tabDoc'

const INK = '#5c2d8a'

// Reader-mode faces (Peter, 2026-08-28: "an option to change the font in the second mode to a
// number of preset sexy fonts"). Drawn from the app's own certified set — these are already
// fetched for the editor, so choosing one costs no new download and they sit beside the writing
// rather than against it. Reader mode only: LIVE mode is the publisher's page and its typography
// is theirs.
// The PDF viewer's own palette, so a highlight means the same colour in both readers.
const MARK_COLORS = ['#ffe066', '#a0e8a0', '#8ec5ff', '#ffb3c6']
const NOTE_COLORS = ['#ffe066', '#a0e8a0', '#8ec5ff', '#ffb3c6', '#7f1d1d', '#1e3a8a']

const READER_FONTS: Array<{ label: string; css: string }> = [
  { label: 'Garamond', css: "'EB Garamond', Georgia, serif" },
  { label: 'Fell',     css: "'IM Fell DW Pica', Georgia, serif" },
  { label: 'Spectral', css: "'Spectral', Georgia, serif" },
  { label: 'Lora',     css: "'Lora', Georgia, serif" },
  { label: 'Crimson',  css: "'Crimson Pro', Georgia, serif" },
  { label: 'Carlito',  css: "'Carlito', system-ui, sans-serif" },
  { label: 'Atkinson', css: "'Atkinson Hyperlegible', system-ui, sans-serif" },
]

// ⚠ SEARCH GOES THROUGH THE READER, NOT THE LIVE FRAME — and it has to be DuckDuckGo's HTML
// endpoint, not Google. Peter asked for Google ("effectively search google") and then hit the wall:
// "having trouble using the google thingo". MEASURED, both ways, because this is exactly the kind of
// thing that should not be guessed:
//   • FRAMING: google.com, duckduckgo.com, html.duckduckgo.com and bing all send X-Frame-Options or
//     frame-ancestors 'self'. NO search engine can be shown in the live frame. That is not something
//     any code here can change.
//   • READING: google.com/search fetched server-side returns ONE block and the words "click here" —
//     its results need JavaScript, so there is nothing to extract. html.duckduckgo.com/html returns
//     31 blocks and 123 real result links.
// So: Google satisfies neither path, and DuckDuckGo's no-JS endpoint satisfies the reader path
// completely. Searching switches to Reader mode, where it works, rather than to Live mode, where it
// can only ever show a refusal.
export const SEARCH_URL = 'https://html.duckduckgo.com/html/?q='

/** True when this address can only be read, never framed — searches, and the engines themselves. */
export function mustUseReader(url: string): boolean {
  return /(^|\/\/)([\w-]+\.)*(duckduckgo|google|bing)\.[a-z.]+\//i.test(url)
}

/** A typed address → a URL. Bare hosts get https://; anything that is plainly a SEARCH (spaces, or
 *  no dot) goes to the search endpoint, because a reader who types words expects to find something
 *  rather than an error. */
export function addressToUrl(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  if (/^https?:\/\//i.test(t)) return t
  const looksLikeHost = /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(t) && !/\s/.test(t)
  if (looksLikeHost) return `https://${t}`
  return SEARCH_URL + encodeURIComponent(t)
}

/** DuckDuckGo wraps every result in a redirect (`/l/?uddg=<encoded>`). Unwrap it, so clicking a
 *  result goes to the SITE — otherwise every navigation from a search lands on a redirector, which
 *  the reader then has nothing to extract from. */
export function unwrapRedirect(url: string): string {
  try {
    const u = new URL(url)
    if (/(^|\.)duckduckgo\.com$/i.test(u.hostname) && u.pathname.startsWith('/l/')) {
      const target = u.searchParams.get('uddg')
      if (target && /^https?:\/\//i.test(target)) return target
    }
  } catch { /* not a URL we can improve */ }
  return url
}

/** Hosts known to refuse framing, so the FALLBACK can say so before showing an empty rectangle. */
// Hosts known to send X-Frame-Options / frame-ancestors. NOT a security control and never
// exhaustive — the deadline below is what catches the general case; this just skips the wait for
// the ones we have already met (Peter hit abc.net.au and youtube.com within a minute of each other).
const KNOWN_NO_FRAME = [/(^|\.)jstor\.org$/i, /(^|\.)sciencedirect\.com$/i, /(^|\.)tandfonline\.com$/i,
  /(^|\.)springer\.com$/i, /(^|\.)wiley\.com$/i, /(^|\.)x\.com$/i, /(^|\.)twitter\.com$/i,
  /(^|\.)youtube\.com$/i, /(^|\.)google\.[a-z.]+$/i, /(^|\.)abc\.net\.au$/i, /(^|\.)facebook\.com$/i,
  /(^|\.)instagram\.com$/i, /(^|\.)linkedin\.com$/i, /(^|\.)reddit\.com$/i]

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

/** Paint the mark runs over a block's text. Splitting happens on PLAIN-TEXT offsets, so the block's
 *  own runs (links, emphasis) are walked in step and a mark that starts mid-link still paints. */
function markedStyle(ms: Located[]): React.CSSProperties | undefined {
  if (!ms.length) return undefined
  const hl = ms.find((m) => m.kind === 'highlight')
  const note = ms.find((m) => m.kind === 'note')
  return {
    background: hl ? hl.color : undefined,
    borderBottom: note ? `2px solid ${note.color}` : undefined,
    borderRadius: hl ? 2 : undefined,
  }
}

function Runs({ runs, onNavigate, marks, onEraseMark }: {
  runs: Run[]; onNavigate?: (url: string) => void; marks?: Located[]; onEraseMark?: (id: string) => void
}) {
  if (marks && marks.length) {
    // Walk the runs and the mark boundaries together on one plain-text cursor.
    const total = runs.reduce((n, r) => n + r.text.length, 0)
    const segs = markRuns(total, marks)
    const out: React.ReactNode[] = []
    let cur = 0
    for (const r of runs) {
      const rStart = cur, rEnd = cur + r.text.length
      cur = rEnd
      for (const g of segs) {
        const from = Math.max(g.from, rStart), to = Math.min(g.to, rEnd)
        if (to <= from) continue
        const piece = { ...r, text: r.text.slice(from - rStart, to - rStart) }
        const st = markedStyle(g.marks)
        out.push(
          <span key={`${rStart}-${from}`} style={st}
            onClick={g.marks.length && onEraseMark ? () => onEraseMark(g.marks[0].id) : undefined}
            title={g.marks.find((m) => m.kind === 'note')?.body || undefined}>
            <Runs runs={[piece]} onNavigate={onNavigate} />
          </span>,
        )
      }
    }
    return <>{out}</>
  }
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
  const [addr, setAddr] = useState(url)
  useEffect(() => { setAddr(here) }, [here])

  const docKey = (() => { try { return tabDocId() ?? 'global' } catch { return 'global' } })()
  // ── MARKUP (Peter: "roughly the same markup tools as for the pdfs … reproduce the same
  // ecosystem") ─────────────────────────────────────────────────────────────────────────────────
  // Highlights and sticky notes over the fetched text. Anchored by the TEXT they cover, not by an
  // offset — see reader/marks.ts for why that distinction is load-bearing on a page the publisher
  // can edit between visits.
  const [tool, setTool] = useState<MarkKind | 'erase' | null>(null)
  const [markColor, setMarkColor] = useState(MARK_COLORS[0])
  const [paletteOpen, setPaletteOpen] = useState<MarkKind | null>(null)
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heldRef = useRef(false)
  const [marks, setMarks] = useState<ReaderMark[]>([])
  const [font, setFont] = useState(() => {
    try { return localStorage.getItem('inkwave:readerFont') || READER_FONTS[0].css } catch { return READER_FONTS[0].css }
  })
  const marksStoreKey = `inkwave:readerMarks:${docKey}:${here}`
  useEffect(() => {
    try {
      const raw = localStorage.getItem(marksStoreKey)
      setMarks(raw ? (JSON.parse(raw) as ReaderMark[]) : [])
    } catch { setMarks([]) }
  }, [marksStoreKey])
  const writeMarks = (next: ReaderMark[]) => {
    setMarks(next)
    try { localStorage.setItem(marksStoreKey, JSON.stringify(next)) } catch { /* private / full */ }
  }
  const go = (raw: string) => {
    const next = unwrapRedirect(raw)
    if (!/^https?:\/\//i.test(next)) return
    // A search (or a search engine) can only ever be READ — see the note on SEARCH_URL. Switching
    // here rather than letting the live frame show a refusal is the difference between a browser
    // and a browser-shaped disappointment.
    if (mustUseReader(next)) setFramed(false)
    setStack((st) => [...st.slice(0, idx + 1), next])
    setIdx((i) => i + 1)
  }
  const [doc, setDoc] = useState<ReaderDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  // ⚠ THE MODE IS REMEMBERED (Peter, 2026-08-28: "clicking the link goes straight to the website no
  // delay"). Reader mode has to FETCH before it can show anything — perhaps a second — and once
  // someone is using this as a browser that second is the whole complaint. So the mode is sticky per
  // document: choose Live once and every link opens straight into the live site.
  const [framed, setFramed] = useState(() => {
    try { return localStorage.getItem('inkwave:readerLive') === '1' } catch { return false }
  })
  useEffect(() => { try { localStorage.setItem('inkwave:readerLive', framed ? '1' : '0') } catch { /* private */ } }, [framed])
  // ── PAGE WIDTH IN LIVE MODE (Peter, 2026-08-28: "it's not using the whole space") ────────────
  // The iframe's width IS the CSS viewport the site lays out for, so "not using the whole space" is
  // not something we can fix by stretching anything — it is the site's own responsive layout at
  // whatever width we hand it. Britannica at ~900px picks its DESKTOP layout, right rail and all,
  // and leaves the rail empty; the same site at ~500px picks its phone layout and fills the width.
  // So this is a CHOICE, and it belongs to the reader:
  //   auto   — the panel's real width, 1:1 (what it did before)
  //   narrow — lay out at 520px and scale UP: the phone layout, big text, no empty rails
  //   wide   — lay out at 1400px and scale DOWN: the full desktop layout, smaller text
  // Implemented by sizing the iframe to the chosen viewport and transform-scaling it to fit, which
  // is the only way to give a cross-origin document a viewport it did not ask for.
  const [pageWidth, setPageWidth] = useState<'auto' | 'narrow' | 'wide'>(() => {
    try { return (localStorage.getItem('inkwave:readerPageWidth') as 'auto' | 'narrow' | 'wide') || 'auto' } catch { return 'auto' }
  })
  const frameHostRef = useRef<HTMLDivElement>(null)
  const [hostBox, setHostBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = frameHostRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setHostBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setHostBox({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [framed])
  const frameGeom = (() => {
    const w = hostBox.w || 900, h = hostBox.h || 600
    if (pageWidth === 'auto' || w === 0) return { w, h, scale: 1 }
    const target = pageWidth === 'narrow' ? 520 : 1400
    const scale = w / target
    return { w: target, h: h / scale, scale }
  })()

  const [frameRefused, setFrameRefused] = useState(false)
  const frameLoadedRef = useRef(false)
  useEffect(() => {
    if (!framed) { setFrameRefused(false); return }
    frameLoadedRef.current = false
    setFrameRefused(likelyRefusesFraming(here))
    // 2.5s, not 7: a refused frame loads Chrome's error page almost instantly, so the deadline only
    // has to outlast a slow first byte. Peter sat on that grey face for seven seconds twice.
    const t = setTimeout(() => { if (!frameLoadedRef.current) setFrameRefused(true) }, 2500)
    return () => clearTimeout(t)
  }, [framed, here])
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

  // Blocks as plain text, for anchoring. `list` blocks join their items — a list is one block for
  // marking purposes, which is the same granularity the extractor produced.
  const blockTexts = useMemo(
    () => (doc?.blocks ?? []).map((b) => ('text' in b ? b.text : b.items.map((i) => i.map((r) => r.text).join('')).join('\n'))),
    [doc],
  )
  const located = useMemo(() => locateAll(marks, blockTexts), [marks, blockTexts])
  const byBlock = useMemo(() => {
    const m = new Map<number, Located[]>()
    for (const l of located.placed) { const a = m.get(l.block) ?? []; a.push(l); m.set(l.block, a) }
    return m
  }, [located])

  const headings = useMemo(
    () => (doc?.blocks ?? []).filter((b): b is Extract<ReaderBlock, { kind: 'heading' }> => b.kind === 'heading'),
    [doc],
  )

  const eraseMark = (id: string) => { if (tool === 'erase') writeMarks(marks.filter((m) => m.id !== id)) }

  /** One shape for every header action — that is what "symmetric" means here. */
  const btn = (glyph: string, title: string, onPress: () => void, lit: boolean) => (
    <button type="button" title={title} aria-label={title} onClick={onPress}
      style={{ width: 24, height: 24, flexShrink: 0, borderRadius: 6, display: 'flex', alignItems: 'center',
        justifyContent: 'center', cursor: 'pointer', fontSize: '13px', lineHeight: 1,
        border: `1px solid ${lit ? INK : 'var(--iw-nightable-border, #d6cfe0)'}`,
        background: lit ? `${INK}14` : 'transparent', color: INK }}>{glyph}</button>
  )

  /** below → side-right → side-left → below. Two controls' worth of state on one button. */
  const cycleDock = () => {
    if (orientation !== 'side') { setStoredOrient('side'); writeStoredOrientation('side'); setDockSide('right'); writeStoredDockSide('right'); return }
    if (dockSide === 'right') { setDockSide('left'); writeStoredDockSide('left'); return }
    setStoredOrient('bottom'); writeStoredOrientation('bottom')
  }

  const citeHeading = (text: string) => { onCite?.(locatorForHeading(text)); setSel(null) }

  /** Turn the live selection into a mark. The BLOCK is found by the selected text, not by walking
   *  the DOM — the same identification the mark is stored under, so creating and re-finding can
   *  never disagree about what a mark covers. */
  const markSelection = (kind: MarkKind) => {
    const s2 = window.getSelection()
    if (!s2 || s2.isCollapsed) return
    const text = s2.toString().replace(/\s+/g, ' ').trim()
    if (text.length < 2) return
    let block = -1, start = -1
    for (let i = 0; i < blockTexts.length; i++) {
      const at = blockTexts[i].indexOf(text)
      if (at >= 0) { block = i; start = at; break }
    }
    if (block < 0) return  // the selection spans blocks — refuse rather than mark the wrong words
    const m: ReaderMark = {
      id: uuidv4(), kind, color: markColor, block, start, text,
      body: kind === 'note' ? '' : undefined, createdAt: new Date().toISOString(),
    }
    writeMarks([...marks, m])
    s2.removeAllRanges()
    setSel(null)
  }

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
          <span style={{ color: INK, fontWeight: 600, whiteSpace: 'nowrap', maxWidth: '30%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {doc?.title || title || hostOf(here)}
          </span>
          {/* ADDRESS BAR (Peter, 2026-08-28: "we should be able to search the web by url"). It is
              an address bar in the ordinary sense: a URL goes there, a bare host gets https://, and
              words with no dot go to GOOGLE (Peter named it) — a reader who types
              words expects to find something, not an error. */}
          <input value={addr} onChange={(e) => setAddr(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              const next = addressToUrl(addr)
              if (next) { go(next); (e.currentTarget as HTMLInputElement).blur() }
            }}
            placeholder="address or search"
            spellCheck={false}
            className="iw-nightable"
            style={{ flex: 1, minWidth: 80, height: 22, fontSize: '11px', padding: '0 7px', borderRadius: 999,
              border: '1px solid var(--iw-nightable-border, rgba(92,45,138,0.28))', background: 'transparent',
              color: 'inherit', outline: 'none', fontFamily: 'system-ui, sans-serif' }} />
          {/* FOUR SYMMETRIC BUTTONS (Peter, 2026-08-28: "this could be reduced down to a button.
              Four symmetric buttons"). "open in a tab ↗" was a wide underlined link sitting among
              icons; it is an action like the others and now looks like one. The dock button CYCLES
              (below → right → left) so the two separate dock controls collapse into one, which is
              what makes four the right number rather than a number things were squeezed into. */}
          {btn(framed ? '⌂' : '⛶', framed ? 'Reader view — selectable and citable' : 'Live page — the real site', () => setFramed((f) => !f), framed)}
          {btn('▤', `Dock: ${orientation === 'side' ? (dockSide === 'left' ? 'left' : 'right') : 'below'} — click to move`, cycleDock, false)}
          {btn('↗', 'Open in a browser tab', () => window.open(here, '_blank', 'noopener,noreferrer'), false)}
          {btn('✕', 'Close (Esc)', onClose, false)}
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Section list — the fastest way to cite a section is to not have to find it first. */}
          {/* ☰ SITS OVER THE NAVIGATOR (Peter, 2026-08-28: "this button needs to be over the
              navigator"), not adrift in the header — a control that hides a column belongs at the
              top of that column, where what it acts on is unambiguous. When the column is hidden it
              becomes a thin re-open tab in its place, so the action stays reversible in situ. */}
          {!framed && headings.length > 1 && !showNav && (
            <button type="button" title="Show the section list" onClick={toggleNav}
              style={{ width: 22, flexShrink: 0, border: 'none', borderRight: '1px solid #e7e5e4', background: 'transparent', color: '#a8a29e', cursor: 'pointer', fontSize: '13px' }}>☰</button>
          )}
          {!framed && showNav && headings.length > 1 && (
            <nav className="hidden md:flex flex-col overflow-hidden border-r border-stone-200" style={{ width: 220, fontSize: '12px' }}>
              <div className="flex items-center gap-1 px-2 py-1 border-b border-stone-100" style={{ flexShrink: 0 }}>
                <button type="button" title="Hide the section list" onClick={toggleNav}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: INK, fontSize: '13px', padding: '0 2px' }}>☰</button>
                <span className="text-stone-400" style={{ fontSize: '11px' }}>Sections</span>
              </div>
              <div className="overflow-y-auto py-1">
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
              </div>
            </nav>
          )}

          {/* ⚠ NO PADDING (AND NO SCROLLER) IN LIVE MODE (2026-08-28, Peter: "nevertheless it has
              this weird white space around it"). The reading column's px-8/py-6 is right for OUR
              typography and wrong for a real web page, which brings its own margins and its own
              scrollbar — so the site rendered inside a cream frame with a second scroller around
              it. The iframe fills the pane edge to edge and scrolls itself. */}
          <div ref={bodyRef} data-iw-selectable=""
            className={`flex-1 min-w-0 ${framed ? 'overflow-hidden' : 'overflow-y-auto px-8 py-6'}`}
            style={framed ? undefined : { fontFamily: font, fontSize: '17px', lineHeight: 1.62, color: '#2c2a28' }}>
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
            {framed && frameRefused && (
              // ⚠ SAY IT, DON'T SHOW CHROME'S GREY FACE (2026-08-28, Peter: "it's not working for
              // this abc website" — iview.abc.net.au sends X-Frame-Options and the panel showed the
              // browser's "refused to connect" error, which reads as OUR bug). A refused frame
              // fires no error event, so the detector is a deadline; generous, because a slow site
              // called "refused" would be the worse lie.
              <div className="flex flex-col items-center justify-center gap-3 h-full text-center px-8" style={{ fontSize: '14px', color: '#57534e' }}>
                <div style={{ color: INK, fontSize: '15px' }}>{hostOf(here)} won’t open inside another page.</div>
                <div style={{ maxWidth: 460, lineHeight: 1.5 }}>
                  That’s a header the publisher sends with the page, and nothing here can override it.
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setFramed(false)}
                    className="rounded-full px-3 py-1.5" style={{ border: `1px solid ${INK}55`, color: INK, fontSize: '13px' }}>
                    Read it here instead
                  </button>
                  <a href={here} target="_blank" rel="noreferrer noopener" className="rounded-full px-3 py-1.5 text-white"
                    style={{ background: `linear-gradient(135deg, #7a4fb0, ${INK})`, fontSize: '13px' }}>Open in a tab ↗</a>
                </div>
              </div>
            )}
            {framed && !frameRefused && (
              // Live page: readable, but the browser keeps its text out of our reach — so the
              // selection actions are absent here rather than present and silently inert.
              <div ref={frameHostRef} style={{ width: '100%', height: '100%', overflow: 'hidden', background: '#fff' }}>
                <iframe src={here} title={doc?.title || here} onLoad={() => { frameLoadedRef.current = true }}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                  // NO referrerPolicy override: many image CDNs use the referer for hotlink
                  // protection, and stripping it is a plausible cause of the missing pictures Peter
                  // saw. The default (strict-origin-when-cross-origin) sends the origin only —
                  // enough for those checks, and it leaks no path.
                  style={{ display: 'block', border: 'none', background: '#fff',
                    width: frameGeom.w, height: frameGeom.h,
                    transform: frameGeom.scale === 1 ? undefined : `scale(${frameGeom.scale})`,
                    transformOrigin: '0 0' }} />
              </div>
            )}
            {doc && !framed && doc.blocks.map((b, i) => {
              if (b.kind === 'heading') {
                const Tag = (`h${Math.min(4, Math.max(1, b.level))}`) as 'h1'
                return (
                  <Tag key={i} id={`iw-rd-${b.id}`} className="group"
                    style={{ fontSize: b.level <= 1 ? '1.5em' : b.level === 2 ? '1.22em' : '1.06em', fontWeight: 600, margin: '1.4em 0 0.5em', color: '#1c1a19' }}>
                    <Runs onNavigate={go} runs={b.runs} marks={byBlock.get(i)} onEraseMark={eraseMark} />
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
              return <p key={i} style={{ margin: '0.85em 0' }}><Runs onNavigate={go} runs={b.runs} marks={byBlock.get(i)} onEraseMark={eraseMark} /></p>
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

        {/* ── THE MARKUP BAR (Peter, 2026-08-28: "a tab at the bottom with roughly the same markup
            tools as for the pdfs … reproduce the same ecosystem") ────────────────────────────────
            Same three tools, same gesture (click arms, HOLD opens the colours), same palette, so a
            highlight means the same thing in both readers. READER MODE ONLY: a live page is the
            publisher's document and the browser seals it off from us — we cannot mark what we
            cannot read, and offering a tool that silently does nothing is worse than not offering
            it, so the bar renders the reason instead. */}
        {!framed && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-t border-stone-200 flex-wrap"
            style={{ fontSize: '12px', background: 'var(--iw-panel-bg, #faf8fc)' }}>
            {([
              { kind: 'highlight' as const, label: '▮', title: 'Highlight — select text, then click · hold for colours', palette: MARK_COLORS },
              { kind: 'note' as const, label: '🗒', title: 'Sticky note — select text, then click · hold for colours', palette: NOTE_COLORS },
            ]).map((t) => (
              <div key={t.kind} style={{ position: 'relative' }}>
                <button type="button" title={t.title}
                  onPointerDown={() => { holdRef.current = setTimeout(() => { heldRef.current = true; setPaletteOpen(t.kind) }, 400) }}
                  onPointerUp={() => { if (holdRef.current) clearTimeout(holdRef.current) }}
                  onPointerLeave={() => { if (holdRef.current) clearTimeout(holdRef.current) }}
                  onClick={() => {
                    if (heldRef.current) { heldRef.current = false; return }
                    // Text already selected → mark it now. Nothing selected → arm the tool.
                    const sel2 = window.getSelection()
                    if (sel2 && !sel2.isCollapsed) { markSelection(t.kind); return }
                    setTool((cur) => (cur === t.kind ? null : t.kind))
                  }}
                  style={{ width: 26, height: 26, borderRadius: 6, cursor: 'pointer', fontSize: '0.9rem',
                    border: `1px solid ${tool === t.kind ? INK : '#d6cfe0'}`, background: tool === t.kind ? `${INK}14` : '#fff',
                    color: t.kind === 'highlight' ? '#c99a06' : INK }}>{t.label}</button>
                {paletteOpen === t.kind && (
                  <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} onMouseDown={() => setPaletteOpen(null)} />
                    <div className="iw-nightable" style={{ position: 'absolute', bottom: 32, left: 0, zIndex: 21, display: 'flex', gap: 6, padding: '7px 8px', borderRadius: 10, background: '#fff', border: `1px solid ${INK}44`, boxShadow: '0 4px 16px rgba(0,0,0,0.16)' }}>
                      {t.palette.map((c) => (
                        <button key={c} type="button" onMouseDown={(ev) => ev.preventDefault()}
                          onClick={() => { setMarkColor(c); setPaletteOpen(null) }}
                          style={{ width: 20, height: 20, borderRadius: '50%', background: c, cursor: 'pointer', border: markColor === c ? `2px solid ${INK}` : '1px solid rgba(0,0,0,0.15)' }} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            ))}
            <button type="button" title="Eraser — click a mark to remove it"
              onClick={() => setTool((cur) => (cur === 'erase' ? null : 'erase'))}
              style={{ width: 26, height: 26, borderRadius: 6, cursor: 'pointer', fontSize: '0.9rem',
                border: `1px solid ${tool === 'erase' ? INK : '#d6cfe0'}`, background: tool === 'erase' ? `${INK}14` : '#fff', color: '#d17ba5' }}>⌫</button>

            <span style={{ width: 1, height: 16, background: `${INK}22`, margin: '0 3px' }} />
            {/* Reading face — Peter's "preset sexy fonts". Reader mode only; a live page's
                typography is the publisher's. */}
            <select value={font} title="Reading font"
              onChange={(e) => { setFont(e.target.value); try { localStorage.setItem('inkwave:readerFont', e.target.value) } catch { /* private */ } }}
              className="iw-nightable"
              style={{ height: 26, borderRadius: 6, border: '1px solid #d6cfe0', background: '#fff', color: INK, fontSize: '0.76rem', padding: '0 4px', cursor: 'pointer' }}>
              {READER_FONTS.map((f) => <option key={f.css} value={f.css}>{f.label}</option>)}
            </select>

            {located.orphaned.length > 0 && (
              // A mark whose text the publisher has since changed. Said out loud rather than
              // silently dropped OR silently re-placed over words the reader never marked.
              <span className="ml-auto text-stone-400" style={{ fontSize: '11px' }}
                title="These marks covered text that is no longer on the page — the publisher has edited it.">
                {located.orphaned.length} mark{located.orphaned.length === 1 ? '' : 's'} lost their place
              </span>
            )}
          </div>
        )}

        {/* LIVE MODE gets its own thin bar — just the width choice. It is not a fifth header button
            (Peter asked for four, symmetric) and it is not a markup tool, because there is nothing
            in a live page we are allowed to mark. */}
        {framed && !frameRefused && (
          <div className="flex items-center gap-2 px-2 py-1.5 border-t border-stone-200"
            style={{ fontSize: '11px', background: 'var(--iw-panel-bg, #faf8fc)', color: 'var(--iw-pill-fg, #78716c)' }}>
            <span>Page width</span>
            <select value={pageWidth} title="How wide a screen the site should lay out for"
              onChange={(e) => { const v = e.target.value as 'auto' | 'narrow' | 'wide'; setPageWidth(v); try { localStorage.setItem('inkwave:readerPageWidth', v) } catch { /* private */ } }}
              className="iw-nightable"
              style={{ height: 22, borderRadius: 6, border: '1px solid #d6cfe0', background: '#fff', color: INK, fontSize: '11px', padding: '0 4px', cursor: 'pointer' }}>
              <option value="auto">Fit the panel</option>
              <option value="narrow">Big text (phone layout)</option>
              <option value="wide">Wide (desktop layout)</option>
            </select>
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
